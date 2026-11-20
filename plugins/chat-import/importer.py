from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ImportResult:
    imported: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)


def origin_for(conversation: Any) -> dict[str, str]:
    return {"tool": conversation.source, "path": "", "foreign_session_id": conversation.foreign_id}


def import_conversations(db: Any, conversations: list[Any], *, profile: str) -> ImportResult:
    raise NotImplementedError
