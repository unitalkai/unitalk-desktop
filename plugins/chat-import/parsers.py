from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

ExportFormat = Literal["chatgpt", "claude", "grok"]


@dataclass(frozen=True)
class ImportedMessage:
    role: Literal["user", "assistant"]
    content: str
    timestamp: float | None = None


@dataclass(frozen=True)
class ImportedConversation:
    source: ExportFormat
    foreign_id: str
    title: str
    started_at: float | None
    messages: list[ImportedMessage] = field(default_factory=list)


def detect_format(names: set[str]) -> ExportFormat | None:
    raise NotImplementedError


def parse_chatgpt(conversations: list[dict]) -> list[ImportedConversation]:
    raise NotImplementedError


def parse_claude(conversations: list[dict]) -> list[ImportedConversation]:
    raise NotImplementedError


def parse_grok(export: dict) -> list[ImportedConversation]:
    raise NotImplementedError
