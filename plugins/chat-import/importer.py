from __future__ import annotations

import math
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class ImportResult:
    imported: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)


def to_seconds(value: float | None) -> float | None:
    if value is None:
        return None
    return value / 1000 if value > 1e11 else value


def to_session(conversation: Any) -> dict[str, Any]:
    ordered = sorted(
        conversation.messages,
        key=lambda m: m.created_at if m.created_at is not None else math.inf,
    )

    started_at = to_seconds(conversation.created_at)
    if started_at is None:
        first = next((m.created_at for m in ordered if m.created_at is not None), None)
        started_at = to_seconds(first)
    if started_at is None:
        started_at = time.time()

    messages = []
    for message in ordered:
        item: dict[str, Any] = {"role": message.role, "content": message.content}
        timestamp = to_seconds(message.created_at)
        if timestamp is not None:
            item["timestamp"] = timestamp
        messages.append(item)

    return {
        "id": conversation.id,
        "source": conversation.provider,
        "title": conversation.title,
        "started_at": started_at,
        "messages": messages,
    }


def invisible_suffix_for(value: str) -> str:
    hash_value = 2166136261
    units = value.encode("utf-16-le")
    for i in range(0, len(units), 2):
        hash_value ^= units[i] | (units[i + 1] << 8)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    digits = ["\u200b", "\u200c", "\u200d"]
    suffix = ""
    n = hash_value
    while True:
        suffix = digits[n % 3] + suffix
        n //= 3
        if n == 0:
            return suffix


def _errors(result: dict[str, Any]) -> list[str]:
    return [e if isinstance(e, str) else (e or {}).get("error") or "unknown import error" for e in result.get("errors") or []]


def import_session(db: Any, session: dict[str, Any]) -> dict[str, Any]:
    try:
        return db.import_sessions([session])
    except sqlite3.IntegrityError:
        title = (session.get("title") or "") + invisible_suffix_for(session["id"])
        return db.import_sessions([{**session, "title": title}])


def import_conversations(
    db: Any,
    conversations: list[Any],
    *,
    on_progress: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> ImportResult:
    result = ImportResult()
    for conversation in conversations:
        if should_stop and should_stop():
            break
        try:
            outcome = import_session(db, to_session(conversation))
            errors = _errors(outcome)
            if not outcome.get("ok") or errors:
                raise ValueError(errors[0] if errors else "Import failed")
            if conversation.id in (outcome.get("skipped_ids") or []):
                result.skipped.append(conversation.id)
            else:
                result.imported.append(conversation.id)
            if on_progress:
                on_progress(conversation.id)
        except Exception as exc:
            result.failed[conversation.id] = str(exc)
    return result
