"""Tick: triggers from Home Assistant that you pick for a task in Tick.

You add triggers here with a clear name ("Sam comes home", "Sunset"), each optionally watching one entity
for a state ("person.sam" becomes "home"). The integration sends the list of names to Tick. In Tick you pick
one or more of them for a task; the first one that goes off gives one notification.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging

from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN, Platform
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval
from homeassistant.util import dt as dt_util

from .api import TickAuthError, TickClient, TickError, TickNotEnabled
from .const import (
    CONF_API_KEY,
    CONF_ENTITY_ID,
    CONF_TO_STATE,
    CONF_URL,
    DOMAIN,
    EVENT_TRIGGER_FIRED,
    SUBENTRY_TRIGGER,
    signal_fired,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.BUTTON, Platform.SENSOR]

# Tick hides the triggers in the app when Home Assistant has been silent for weeks (integration removed, key revoked).
# A sign of life every few hours keeps them visible while this integration runs.
HEARTBEAT = timedelta(hours=6)


@dataclass
class TickData:
    """What the platforms of one config entry share."""

    hass: HomeAssistant
    entry: ConfigEntry
    client: TickClient
    last: dict[str, datetime | None] = field(default_factory=dict)

    async def async_fire(self, subentry_id: str) -> None:
        """Tell Tick that this trigger went off."""
        name = self.entry.subentries[subentry_id].title if subentry_id in self.entry.subentries else subentry_id
        try:
            result = await self.client.async_fire(subentry_id)
        except TickError as err:
            _LOGGER.warning("Tick: trigger %s could not be sent: %s", name, err)
            return
        self.last[subentry_id] = dt_util.utcnow()
        notified = result.get("notified", [])
        _LOGGER.debug("Tick: trigger %s went off, %d task(s) notified", name, len(notified))
        self.hass.bus.async_fire(
            EVENT_TRIGGER_FIRED, {"trigger": subentry_id, "name": name, "notified": len(notified)}
        )
        async_dispatcher_send(self.hass, signal_fired(self.entry.entry_id), subentry_id)


type TickConfigEntry = ConfigEntry[TickData]


def _triggers(entry: ConfigEntry) -> list[ConfigSubentry]:
    return list(entry.get_subentries_of_type(SUBENTRY_TRIGGER))


async def async_setup_entry(hass: HomeAssistant, entry: TickConfigEntry) -> bool:
    """Connect to Tick, send the trigger names, and start watching the chosen entities."""
    client = TickClient(async_get_clientsession(hass), entry.data[CONF_URL], entry.data[CONF_API_KEY])
    triggers = _triggers(entry)
    try:
        await client.async_put_triggers(
            [
                {"id": sub.subentry_id, "name": sub.title, "entity": sub.data.get(CONF_ENTITY_ID)}
                for sub in triggers
            ]
        )
        state = await client.async_state()
    except TickAuthError as err:
        raise ConfigEntryAuthFailed(str(err)) from err
    except TickNotEnabled as err:
        raise ConfigEntryNotReady(str(err)) from err
    except TickError as err:
        raise ConfigEntryNotReady(str(err)) from err

    data = TickData(hass, entry, client)
    for trig in state.get("triggers", []):
        if trig.get("last"):
            data.last[trig["id"]] = dt_util.parse_datetime(trig["last"])
    entry.runtime_data = data

    for sub in triggers:
        entity_id = sub.data.get(CONF_ENTITY_ID)
        to_state = sub.data.get(CONF_TO_STATE)
        if not entity_id or to_state is None:
            continue  # a trigger without an entity goes off with its button (for example from an automation)

        @callback
        def _changed(event: Event[EventStateChangedData], sub_id: str = sub.subentry_id, to: str = str(to_state)) -> None:
            old, new = event.data["old_state"], event.data["new_state"]
            # Only a real change to the chosen state; not after a restart (unknown/unavailable) or an attribute change.
            if old is None or new is None or new.state != to or old.state == to:
                return
            if old.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
                return
            hass.async_create_task(data.async_fire(sub_id))

        entry.async_on_unload(async_track_state_change_event(hass, [entity_id], _changed))

    async def _heartbeat(_now: datetime) -> None:
        try:
            await client.async_state()
        except TickAuthError:
            entry.async_start_reauth(hass)
        except TickError as err:
            _LOGGER.debug("Tick: no sign of life sent: %s", err)

    entry.async_on_unload(async_track_time_interval(hass, _heartbeat, HEARTBEAT))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    # Adding, changing or removing a trigger: set up again, so Tick gets the new list.
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_reload(hass: HomeAssistant, entry: TickConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: TickConfigEntry) -> bool:
    """Stop watching and remove the entities."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
