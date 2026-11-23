"""A sensor per trigger: when it last went off (and reached Tick)."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import TickConfigEntry
from .const import CONF_ENTITY_ID, CONF_TO_STATE, SUBENTRY_TRIGGER, signal_fired
from .entity import TickTriggerEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: TickConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """One sensor per trigger."""
    for subentry in entry.get_subentries_of_type(SUBENTRY_TRIGGER):
        sensor = TickLastFiredSensor(entry.runtime_data, subentry, "last_fired")
        sensor.watch = (subentry.data.get(CONF_ENTITY_ID), subentry.data.get(CONF_TO_STATE))
        async_add_entities([sensor], config_subentry_id=subentry.subentry_id)


class TickLastFiredSensor(TickTriggerEntity, SensorEntity):
    """The last time this trigger went off."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:history"
    watch: tuple[str | None, str | None] = (None, None)

    @property
    def native_value(self) -> datetime | None:
        return self._data.last.get(self._subentry_id)

    @property
    def extra_state_attributes(self) -> dict[str, str | None]:
        entity_id, to_state = self.watch
        return {"entity_id": entity_id, "to_state": to_state}

    async def async_added_to_hass(self) -> None:
        @callback
        def _fired(subentry_id: str) -> None:
            if subentry_id == self._subentry_id:
                self.async_write_ha_state()

        self.async_on_remove(
            async_dispatcher_connect(self.hass, signal_fired(self._data.entry.entry_id), _fired)
        )
