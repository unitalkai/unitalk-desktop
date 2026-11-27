"""Which knowledge bases the agent may search, chosen in the chat composer's Knowledge menu.

Stored per Hermes profile (the plugin data dir lives under HERMES_HOME), like an assistant's
knowledge bases in unitalk.ai, and within it per scope (``<user>:<org or personal>``, see
``auth.current_scope``): personal and organization bases have different ids, so switching the
active organization switches to that organization's own selection.

``None`` means the user never chose in this scope: every base is searchable. An empty list means
the user turned every base off.
"""

from __future__ import annotations

import re
from typing import Any

PLUGIN_NAME = "knowledge-base"
SELECTION_FILE = "active_bases.json"
MAX_ACTIVE_BASES = 100
MAX_SCOPES = 50
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def _path():
    from plugins.plugin_storage import plugin_data_dir

    return plugin_data_dir(PLUGIN_NAME) / SELECTION_FILE


def normalize(base_ids: Any) -> list[str] | None:
    """Validate a selection; raise ValueError when malformed. Keeps order, drops duplicates."""
    if base_ids is None:
        return None
    if not isinstance(base_ids, list) or len(base_ids) > MAX_ACTIVE_BASES:
        raise ValueError("invalid_base_ids")
    seen: list[str] = []
    for value in base_ids:
        if not isinstance(value, str) or not _ID_RE.match(value):
            raise ValueError("invalid_base_ids")
        if value not in seen:
            seen.append(value)
    return seen


def _scopes() -> dict[str, Any]:
    from utils import read_json_or_empty

    data = read_json_or_empty(_path())
    scopes = data.get("scopes") if isinstance(data, dict) else None
    return dict(scopes) if isinstance(scopes, dict) else {}


def active_base_ids(scope: str) -> list[str] | None:
    try:
        return normalize(_scopes().get(scope))
    except ValueError:
        return None


def set_active_base_ids(scope: str, base_ids: Any) -> list[str] | None:
    value = normalize(base_ids)
    scopes = _scopes()
    scopes.pop(scope, None)
    if value is not None:
        scopes[scope] = value  # re-inserted last: the most recently used scopes are kept
    while len(scopes) > MAX_SCOPES:
        scopes.pop(next(iter(scopes)))
    from utils import atomic_json_write

    atomic_json_write(_path(), {"scopes": scopes})
    return value
