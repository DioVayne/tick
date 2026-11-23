"""Tick: triggers from Home Assistant that you pick for a task in Tick.

You add triggers here with a clear name ("Sam comes home", "Sunset"), each optionally watching one entity
for a state ("person.sam" becomes "home"), with optional conditions (only after it stayed so for a while,
only between two times). The integration sends the list of names to Tick. In Tick you pick one or more of
them for a task; the first one that goes off gives one notification.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN, Platform
from homeassistant.core import CALLBACK_TYPE, Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.util import dt as dt_util

from .api import TickAuthError, TickClient, TickError, TickNotEnabled, TickUnknownTrigger
from .const import (
    CONF_AFTER,
    CONF_API_KEY,
    CONF_BEFORE,
    CONF_ENTITY_ID,
    CONF_FOR,
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

# One lock per config entry, across reloads: sending the list never overlaps, so an older list can never arrive last.
_SYNC_LOCKS: dict[str, asyncio.Lock] = {}


def _triggers(entry: ConfigEntry) -> list[ConfigSubentry]:
    return list(entry.get_subentries_of_type(SUBENTRY_TRIGGER))


def _parse_time(value: Any) -> time | None:
    return dt_util.parse_time(value) if isinstance(value, str) and value else None


def in_window(now: time, after: time | None, before: time | None) -> bool:
    """Is `now` between after and before? Over midnight (22:00–06:00) works too; without both, always."""
    if after and before:
        return after <= now < before if after <= before else now >= after or now < before
    if after:
        return now >= after
    if before:
        return now < before
    return True


@dataclass
class TickData:
    """What the platforms of one config entry share."""

    hass: HomeAssistant
    entry: ConfigEntry
    client: TickClient
    last: dict[str, datetime | None] = field(default_factory=dict)

    async def async_sync(self) -> None:
        """Send the current list of triggers to Tick (read at the moment of sending, never overlapping)."""
        lock = _SYNC_LOCKS.setdefault(self.entry.entry_id, asyncio.Lock())
        async with lock:
            await self.client.async_put_triggers(
                [
                    {"id": sub.subentry_id, "name": sub.title, "entity": sub.data.get(CONF_ENTITY_ID)}
                    for sub in _triggers(self.entry)
                ]
            )

    async def async_fire(self, subentry_id: str) -> None:
        """Tell Tick that this trigger went off. Tick does not know it yet: send the list once and try again."""
        name = self.entry.subentries[subentry_id].title if subentry_id in self.entry.subentries else subentry_id
        try:
            try:
                result = await self.client.async_fire(subentry_id)
            except TickUnknownTrigger:
                await self.async_sync()
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


def _watch(hass: HomeAssistant, entry: TickConfigEntry, data: TickData, sub: ConfigSubentry) -> None:
    """Watch the entity of one trigger, with its conditions."""
    entity_id = sub.data[CONF_ENTITY_ID]
    to = str(sub.data[CONF_TO_STATE])
    hold = int(sub.data.get(CONF_FOR) or 0)
    after = _parse_time(sub.data.get(CONF_AFTER))
    before = _parse_time(sub.data.get(CONF_BEFORE))
    waiting: list[CALLBACK_TYPE] = []

    def _cancel() -> None:
        while waiting:
            waiting.pop()()

    @callback
    def _go(_now: datetime | None = None) -> None:
        waiting.clear()
        # After waiting: is it still in the state? And are we inside the time window (at the moment it goes off)?
        current = hass.states.get(entity_id)
        if current is None or current.state != to:
            return
        if not in_window(dt_util.now().time(), after, before):
            return
        hass.async_create_task(data.async_fire(sub.subentry_id))

    @callback
    def _changed(event: Event[EventStateChangedData]) -> None:
        old, new = event.data["old_state"], event.data["new_state"]
        if new is None or new.state != to:
            _cancel()  # left the state: a running "for" wait stops
            return
        # Only a real change to the chosen state; not after a restart (unknown/unavailable) or an attribute change.
        if old is None or old.state == to or old.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            return
        _cancel()
        if hold:
            waiting.append(async_call_later(hass, hold, _go))
        else:
            _go()

    entry.async_on_unload(async_track_state_change_event(hass, [entity_id], _changed))
    entry.async_on_unload(_cancel)


async def async_setup_entry(hass: HomeAssistant, entry: TickConfigEntry) -> bool:
    """Connect to Tick, send the trigger names, and start watching the chosen entities."""
    client = TickClient(async_get_clientsession(hass), entry.data[CONF_URL], entry.data[CONF_API_KEY])
    data = TickData(hass, entry, client)
    try:
        await data.async_sync()
        state = await client.async_state()
    except TickAuthError as err:
        raise ConfigEntryAuthFailed(str(err)) from err
    except TickNotEnabled as err:
        raise ConfigEntryNotReady(str(err)) from err
    except TickError as err:
        raise ConfigEntryNotReady(str(err)) from err

    for trig in state.get("triggers", []):
        if trig.get("last"):
            data.last[trig["id"]] = dt_util.parse_datetime(trig["last"])
    entry.runtime_data = data

    for sub in _triggers(entry):
        if sub.data.get(CONF_ENTITY_ID) and sub.data.get(CONF_TO_STATE) is not None:
            _watch(hass, entry, data, sub)
        # A trigger without an entity goes off with its button (for example from your own automation).

    async def _heartbeat(_now: datetime) -> None:
        try:
            await client.async_state()
        except TickAuthError:
            entry.async_start_reauth(hass)
        except TickError as err:
            _LOGGER.debug("Tick: no sign of life sent: %s", err)

    entry.async_on_unload(async_track_time_interval(hass, _heartbeat, HEARTBEAT))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    # Adding, changing or removing a trigger: set up again, so Tick gets the new list and the new watchers run.
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_reload(hass: HomeAssistant, entry: TickConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: TickConfigEntry) -> bool:
    """Stop watching and remove the entities."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: TickConfigEntry) -> None:
    """The integration was removed: forget its lock."""
    _SYNC_LOCKS.pop(entry.entry_id, None)
