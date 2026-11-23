"""Connect a Tick, and add triggers to it."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from urllib.parse import urlparse

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    ConfigSubentryFlow,
    SubentryFlowResult,
)
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    DurationSelector,
    DurationSelectorConfig,
    EntitySelector,
    EntitySelectorConfig,
    StateSelector,
    StateSelectorConfig,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
    TimeSelector,
)

from .api import TickAuthError, TickClient, TickError, TickNotEnabled, normalize_url
from .const import (
    CONF_AFTER,
    CONF_API_KEY,
    CONF_BEFORE,
    CONF_ENTITY_ID,
    CONF_FOR,
    CONF_NAME,
    CONF_TO_STATE,
    CONF_URL,
    DOMAIN,
    SUBENTRY_TRIGGER,
)

KEY_SELECTOR = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))


def _seconds(duration: Any) -> int:
    """{hours, minutes, seconds} from the duration selector as seconds (0 = no wait)."""
    if not isinstance(duration, dict):
        return 0
    return int(duration.get("days", 0)) * 86400 + int(duration.get("hours", 0)) * 3600 + int(duration.get("minutes", 0)) * 60 + int(duration.get("seconds", 0))


def _duration(seconds: Any) -> dict[str, int] | None:
    if not seconds:
        return None
    s = int(seconds)
    return {"hours": s // 3600, "minutes": s % 3600 // 60, "seconds": s % 60}


def _conditions(user_input: dict[str, Any]) -> dict[str, Any]:
    """The optional conditions of the state step, without the empty ones."""
    out: dict[str, Any] = {}
    if hold := _seconds(user_input.get(CONF_FOR)):
        out[CONF_FOR] = hold
    for key in (CONF_AFTER, CONF_BEFORE):
        if user_input.get(key):
            out[key] = str(user_input[key])
    return out


async def _check(flow: ConfigFlow, url: str, key: str) -> str | None:
    """None when Tick accepts the key, else the error key for the form."""
    client = TickClient(async_get_clientsession(flow.hass), url, key)
    try:
        await client.async_state()
    except TickAuthError:
        return "invalid_auth"
    except TickNotEnabled:
        return "not_enabled"
    except TickError:
        return "cannot_connect"
    return None


class TickConfigFlow(ConfigFlow, domain=DOMAIN):
    """Connect Home Assistant to a Tick with a key made in Tick."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            url = normalize_url(user_input[CONF_URL])
            host = urlparse(url).hostname or url
            await self.async_set_unique_id(host)
            self._abort_if_unique_id_configured()
            error = await _check(self, url, user_input[CONF_API_KEY])
            if error is None:
                return self.async_create_entry(title=host, data={CONF_URL: url, CONF_API_KEY: user_input[CONF_API_KEY].strip()})
            errors["base"] = error
        schema = vol.Schema(
            {
                vol.Required(CONF_URL, default=(user_input or {}).get(CONF_URL, "")): TextSelector(
                    TextSelectorConfig(type=TextSelectorType.URL)
                ),
                vol.Required(CONF_API_KEY): KEY_SELECTOR,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Another address for this Tick (moved, or a new domain), and the key that goes with it."""
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            url = normalize_url(user_input[CONF_URL])
            host = urlparse(url).hostname or url
            error = await _check(self, url, user_input[CONF_API_KEY])
            if error is None:
                return self.async_update_reload_and_abort(
                    entry, unique_id=host, title=host,
                    data_updates={CONF_URL: url, CONF_API_KEY: user_input[CONF_API_KEY].strip()},
                )
            errors["base"] = error
        schema = vol.Schema(
            {
                vol.Required(CONF_URL, default=(user_input or {}).get(CONF_URL, entry.data[CONF_URL])): TextSelector(
                    TextSelectorConfig(type=TextSelectorType.URL)
                ),
                vol.Required(CONF_API_KEY): KEY_SELECTOR,
            }
        )
        return self.async_show_form(step_id="reconfigure", data_schema=schema, errors=errors)

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        """The key stopped working (revoked in Tick): ask for a new one."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        entry = self._get_reauth_entry()
        if user_input is not None:
            error = await _check(self, entry.data[CONF_URL], user_input[CONF_API_KEY])
            if error is None:
                return self.async_update_reload_and_abort(
                    entry, data_updates={CONF_API_KEY: user_input[CONF_API_KEY].strip()}
                )
            errors["base"] = error
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required(CONF_API_KEY): KEY_SELECTOR}),
            description_placeholders={"url": entry.data[CONF_URL]},
            errors=errors,
        )

    @classmethod
    @callback
    def async_get_supported_subentry_types(cls, config_entry: ConfigEntry) -> dict[str, type[ConfigSubentryFlow]]:
        """On the page of the Tick integration: "Add trigger"."""
        return {SUBENTRY_TRIGGER: TriggerFlow}


class TriggerFlow(ConfigSubentryFlow):
    """A trigger: first a clear name and what to watch, then the state that sets it off."""

    def __init__(self) -> None:
        self._name = ""
        self._entity_id: str | None = None

    def _names_in_use(self, skip: str | None = None) -> set[str]:
        return {
            sub.title.casefold()
            for sub in self._get_entry().subentries.values()
            if sub.subentry_type == SUBENTRY_TRIGGER and sub.subentry_id != skip
        }

    def _first_schema(self, name: str, entity_id: str | None) -> vol.Schema:
        return vol.Schema(
            {
                vol.Required(CONF_NAME, default=name): TextSelector(),
                vol.Optional(CONF_ENTITY_ID, description={"suggested_value": entity_id}): EntitySelector(
                    EntitySelectorConfig()
                ),
            }
        )

    def _first(self, user_input: dict[str, Any], skip: str | None) -> dict[str, str]:
        """Check the name and remember the first step. Returns the errors for the form."""
        name = " ".join(str(user_input[CONF_NAME]).split())
        if not name or len(name) > 60:
            return {CONF_NAME: "name_length"}
        if name.casefold() in self._names_in_use(skip):
            return {CONF_NAME: "name_taken"}
        self._name = name
        self._entity_id = user_input.get(CONF_ENTITY_ID) or None
        return {}

    def _state_schema(self, current: dict[str, Any]) -> vol.Schema:
        return vol.Schema(
            {
                vol.Required(CONF_TO_STATE, description={"suggested_value": current.get(CONF_TO_STATE)}): StateSelector(
                    StateSelectorConfig(entity_id=self._entity_id)
                ),
                vol.Optional(CONF_FOR, description={"suggested_value": _duration(current.get(CONF_FOR))}): DurationSelector(
                    DurationSelectorConfig(enable_day=False)
                ),
                vol.Optional(CONF_AFTER, description={"suggested_value": current.get(CONF_AFTER)}): TimeSelector(),
                vol.Optional(CONF_BEFORE, description={"suggested_value": current.get(CONF_BEFORE)}): TimeSelector(),
            }
        )

    # Adding.
    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = self._first(user_input, None)
            if not errors:
                if self._entity_id is None:
                    return self.async_create_entry(title=self._name, data={})
                return await self.async_step_state()
        return self.async_show_form(
            step_id="user",
            data_schema=self._first_schema((user_input or {}).get(CONF_NAME, ""), (user_input or {}).get(CONF_ENTITY_ID)),
            errors=errors,
        )

    async def async_step_state(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        if user_input is not None:
            return self.async_create_entry(
                title=self._name,
                data={CONF_ENTITY_ID: self._entity_id, CONF_TO_STATE: str(user_input[CONF_TO_STATE]), **_conditions(user_input)},
            )
        return self.async_show_form(
            step_id="state",
            data_schema=self._state_schema({}),
            description_placeholders={"name": self._name, "entity": self._entity_id or ""},
        )

    # Changing (the id stays the same, so tasks in Tick keep their trigger).
    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        sub = self._get_reconfigure_subentry()
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = self._first(user_input, sub.subentry_id)
            if not errors:
                if self._entity_id is None:
                    return self.async_update_and_abort(self._get_entry(), sub, title=self._name, data={})
                return await self.async_step_reconfigure_state()
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=self._first_schema(sub.title, sub.data.get(CONF_ENTITY_ID)),
            errors=errors,
        )

    async def async_step_reconfigure_state(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        sub = self._get_reconfigure_subentry()
        if user_input is not None:
            return self.async_update_and_abort(
                self._get_entry(),
                sub,
                title=self._name,
                data={CONF_ENTITY_ID: self._entity_id, CONF_TO_STATE: str(user_input[CONF_TO_STATE]), **_conditions(user_input)},
            )
        # Same entity: everything as it was; another entity: its states differ, the conditions stay.
        same = sub.data.get(CONF_ENTITY_ID) == self._entity_id
        current = dict(sub.data) if same else {k: v for k, v in sub.data.items() if k in (CONF_FOR, CONF_AFTER, CONF_BEFORE)}
        return self.async_show_form(
            step_id="reconfigure_state",
            data_schema=self._state_schema(current),
            description_placeholders={"name": self._name, "entity": self._entity_id or ""},
        )
