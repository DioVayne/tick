"""A small client for the Tick API (only what the triggers need)."""

from __future__ import annotations

from typing import Any

import aiohttp

TIMEOUT = aiohttp.ClientTimeout(total=20)


class TickError(Exception):
    """Tick could not be reached or gave an unexpected answer."""


class TickAuthError(TickError):
    """The key is wrong or was revoked in Tick."""


class TickUnknownTrigger(TickError):
    """Tick does not know this trigger id (the list has not reached Tick yet)."""


class TickNotEnabled(TickError):
    """This Tick does not have Home Assistant triggers switched on."""


def normalize_url(url: str) -> str:
    """'tick.example.com/' becomes 'https://tick.example.com'."""
    url = url.strip().rstrip("/")
    if "://" not in url:
        url = f"https://{url}"
    return url


class TickClient:
    """Talks to one Tick with a full key."""

    def __init__(self, session: aiohttp.ClientSession, url: str, api_key: str) -> None:
        self._session = session
        self._url = normalize_url(url)
        self._key = api_key.strip()

    @property
    def url(self) -> str:
        """The address of this Tick."""
        return self._url

    async def _request(self, method: str, path: str, json: Any = None) -> Any:
        try:
            async with self._session.request(
                method,
                f"{self._url}{path}",
                json=json,
                headers={"authorization": f"Bearer {self._key}", "accept": "application/json"},
                timeout=TIMEOUT,
            ) as res:
                if res.status in (401, 403):
                    raise TickAuthError(f"Tick refused the key ({res.status})")
                if res.status == 404 and path == "/api/hatrigger":
                    raise TickNotEnabled("Home Assistant triggers are not switched on in this Tick")
                if res.status == 404 and path == "/api/hatrigger/fire":
                    raise TickUnknownTrigger("Tick does not know this trigger yet")
                if res.status >= 400:
                    raise TickError(f"Tick answered {res.status} on {method} {path}")
                return await res.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError) as err:
            raise TickError(f"Could not reach Tick: {err}") from err

    async def async_state(self) -> dict[str, Any]:
        """The triggers Tick knows, and which tasks use them."""
        return await self._request("GET", "/api/hatrigger")

    async def async_put_triggers(self, triggers: list[dict[str, Any]]) -> dict[str, Any]:
        """Send the full list of triggers; Tick shows these names when you pick one for a task."""
        return await self._request("PUT", "/api/hatrigger/triggers", {"triggers": triggers})

    async def async_fire(self, trigger_id: str) -> dict[str, Any]:
        """A trigger went off: Tick notifies each open task that waits for it (once)."""
        return await self._request("POST", "/api/hatrigger/fire", {"id": trigger_id})
