"""Common base: every trigger is a device of its own, named after the trigger."""

from __future__ import annotations

from homeassistant.config_entries import ConfigSubentry
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity import Entity

from . import TickData
from .const import DOMAIN


class TickTriggerEntity(Entity):
    """An entity that belongs to one trigger."""

    _attr_has_entity_name = True

    def __init__(self, data: TickData, subentry: ConfigSubentry, key: str) -> None:
        self._data = data
        self._subentry_id = subentry.subentry_id
        self._attr_unique_id = f"{subentry.subentry_id}_{key}"
        self._attr_translation_key = key
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, subentry.subentry_id)},
            name=subentry.title,
            manufacturer="Tick",
            model="Home Assistant trigger",
            entry_type=DeviceEntryType.SERVICE,
            configuration_url=data.client.url,
        )
