"""Constants for the Tick integration."""

from __future__ import annotations

DOMAIN = "tick"

CONF_URL = "url"
CONF_API_KEY = "api_key"

# A trigger is a config subentry: a clear name, and optionally an entity and the state it must change to.
SUBENTRY_TRIGGER = "trigger"
CONF_NAME = "name"
CONF_ENTITY_ID = "entity_id"
CONF_TO_STATE = "to_state"

# Fired on the event bus after Tick handled a trigger: {trigger, name, notified}.
EVENT_TRIGGER_FIRED = "tick_trigger_fired"


def signal_fired(entry_id: str) -> str:
    """Dispatcher signal: a trigger of this config entry went off."""
    return f"{DOMAIN}_{entry_id}_fired"
