"""A button per trigger: makes it go off now (to test it, or from your own automation)."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import TickConfigEntry
from .const import SUBENTRY_TRIGGER
from .entity import TickTriggerEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: TickConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """One button per trigger."""
    for subentry in entry.get_subentries_of_type(SUBENTRY_TRIGGER):
        async_add_entities(
            [TickFireButton(entry.runtime_data, subentry, "fire")],
            config_subentry_id=subentry.subentry_id,
        )


class TickFireButton(TickTriggerEntity, ButtonEntity):
    """Press = this trigger goes off now."""

    _attr_icon = "mdi:lightning-bolt"

    async def async_press(self) -> None:
        await self._data.async_fire(self._subentry_id)
