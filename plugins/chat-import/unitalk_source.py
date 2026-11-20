from __future__ import annotations

from typing import Any

import httpx

SYNC_ACTION = "hermesChatSync:syncMyChatsToHermes"
SYNC_TIMEOUT_SECONDS = 600.0


class UnitalkSyncError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def sync_my_chats(convex_url: str, token: str, *, transport: httpx.AsyncBaseTransport | None = None) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=SYNC_TIMEOUT_SECONDS, transport=transport) as client:
        try:
            response = await client.post(
                f"{convex_url.rstrip('/')}/api/action",
                headers={"Authorization": f"Bearer {token}"},
                json={"path": SYNC_ACTION, "args": {}, "format": "json"},
            )
        except httpx.HTTPError:
            raise UnitalkSyncError(502, "Unitalk is unreachable") from None

    try:
        body = response.json()
    except ValueError:
        body = {}

    if response.status_code == 401 or "Unauthorized" in str(body.get("errorMessage", "")):
        raise UnitalkSyncError(401, "Unitalk session is not valid")
    if response.status_code >= 400 or body.get("status") != "success":
        raise UnitalkSyncError(502, "Unitalk chat sync failed")

    return body.get("value") or {}
