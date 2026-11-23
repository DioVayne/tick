"""A sensor per trigger: when it last went off (and reached Tick)."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import TickConfigEntry
from .const import CONF_AFTER, CONF_BEFORE, CONF_ENTITY_ID, CONF_FOR, CONF_TO_STATE, SUBENTRY_TRIGGER, signal_fired
from .entity import TickTriggerEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: TickConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """One sensor per trigger."""
    for subentry in entry.get_subentries_of_type(SUBENTRY_TRIGGER):
        sensor = TickLastFiredSensor(entry.runtime_data, subentry, "last_fired")
        sensor.watch = {
            "entity_id": subentry.data.get(CONF_ENTITY_ID),
            "to_state": subentry.data.get(CONF_TO_STATE),
            "for_seconds": subentry.data.get(CONF_FOR),
            "after": subentry.data.get(CONF_AFTER),
            "before": subentry.data.get(CONF_BEFORE),
        }
        async_add_entities([sensor], config_subentry_id=subentry.subentry_id)


class TickLastFiredSensor(TickTriggerEntity, SensorEntity):
    """The last time this trigger went off."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:history"
    watch: dict[str, str | int | None] = {}

    @property
    def native_value(self) -> datetime | None:
        return self._data.last.get(self._subentry_id)

    @property
    def extra_state_attributes(self) -> dict[str, str | int | None]:
        return {k: v for k, v in self.watch.items() if v}

    async def async_added_to_hass(self) -> None:
        @callback
        def _fired(subentry_id: str) -> None:
            if subentry_id == self._subentry_id:
                self.async_write_ha_state()

        self.async_on_remove(
            async_dispatcher_connect(self.hass, signal_fired(self._data.entry.entry_id), _fired)
        )
