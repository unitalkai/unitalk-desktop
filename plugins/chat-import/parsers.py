from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Literal

Role = Literal["user", "assistant"]
ReadText = Callable[[str], str]


@dataclass(frozen=True)
class ImportedMessage:
    id: str
    role: Role
    content: str
    created_at: float | None = None


@dataclass(frozen=True)
class ImportedConversation:
    id: str
    provider: str
    title: str
    created_at: float | None = None
    messages: list[ImportedMessage] = field(default_factory=list)


def _iso_ms(value: Any) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value).timestamp() * 1000
    except ValueError:
        return None


def _find(file_names: list[str], suffix: str) -> str | None:
    return next((name for name in file_names if name.endswith(suffix)), None)


class ClaudeParser:
    provider_id = "claude"
    provider_name = "Claude"

    def detect(self, file_names: list[str]) -> bool:
        return any(f.endswith("conversations.json") for f in file_names) and not any(
            f.endswith("user.json") or f.endswith("export_manifest.json") or f.endswith("chat.html")
            for f in file_names
        )

    def parse(self, read_text: ReadText, file_names: list[str]) -> list[ImportedConversation]:
        file_name = _find(file_names, "conversations.json")
        if not file_name:
            raise ValueError("Could not find conversations.json in archive")

        data = json.loads(read_text(file_name))
        if not isinstance(data, list):
            raise ValueError("Invalid Claude export: conversations.json is not an array")

        return [
            ImportedConversation(
                id=conv.get("uuid"),
                provider=self.provider_id,
                title=conv.get("name") or "Untitled",
                created_at=_iso_ms(conv.get("created_at")),
                messages=[
                    ImportedMessage(
                        id=msg.get("uuid"),
                        role=self._map_role(msg.get("sender")),
                        content=self._extract_content(msg),
                        created_at=_iso_ms(msg.get("created_at")),
                    )
                    for msg in conv["chat_messages"]
                ],
            )
            for conv in data
            if conv.get("chat_messages")
        ]

    def _map_role(self, sender: Any) -> Role:
        return "user" if sender == "human" else "assistant"

    def _extract_content(self, msg: dict[str, Any]) -> str:
        text = msg.get("text") or ""

        for attachment in msg.get("attachments") or []:
            if attachment.get("extracted_content"):
                name = attachment.get("file_name") or "file"
                text += f"\n\n[Attachment: {name}]\n{attachment['extracted_content']}"

        if not text and msg.get("content"):
            text = "\n\n".join(
                block["text"] for block in msg["content"] if block.get("type") == "text" and block.get("text")
            )

        return text or ""


class GrokParser:
    provider_id = "grok"
    provider_name = "Grok"

    def detect(self, file_names: list[str]) -> bool:
        return any(f.endswith("prod-grok-backend.json") for f in file_names)

    def parse(self, read_text: ReadText, file_names: list[str]) -> list[ImportedConversation]:
        target = _find(file_names, "prod-grok-backend.json")
        if not target:
            raise ValueError("Could not find prod-grok-backend.json in archive")

        data = json.loads(read_text(target))
        if not isinstance(data, dict) or not isinstance(data.get("conversations"), list):
            raise ValueError("Invalid Grok export: missing conversations array")

        return [
            ImportedConversation(
                id=entry["conversation"].get("id"),
                provider=self.provider_id,
                title=entry["conversation"].get("title") or "Untitled",
                created_at=_iso_ms(entry["conversation"].get("create_time")),
                messages=[
                    ImportedMessage(
                        id=r["response"].get("_id"),
                        role=self._map_role(r["response"].get("sender") or ""),
                        content=r["response"].get("message") or "",
                        created_at=_iso_ms(r["response"].get("create_time")),
                    )
                    for r in entry["responses"]
                ],
            )
            for entry in data["conversations"]
            if entry.get("responses")
        ]

    def _map_role(self, sender: str) -> Role:
        return "user" if sender.lower() == "human" else "assistant"


class ChatGPTParser:
    provider_id = "chatgpt"
    provider_name = "ChatGPT"

    def detect(self, file_names: list[str]) -> bool:
        return any(f.endswith("conversations.json") for f in file_names) and any(
            f.endswith("user.json") or f.endswith("chat.html") or f.endswith("model_comparisons.json")
            for f in file_names
        )

    def parse(self, read_text: ReadText, file_names: list[str]) -> list[ImportedConversation]:
        file_name = _find(file_names, "conversations.json")
        if not file_name:
            raise ValueError("Could not find conversations.json in archive")

        data = json.loads(read_text(file_name))
        if not isinstance(data, list):
            raise ValueError("Invalid ChatGPT export: conversations.json is not an array")

        conversations = []
        for conv in data:
            thread: list[ImportedMessage] = []
            mapping = conv.get("mapping") or {}
            current_node_id = conv.get("current_node")
            visited: set[str] = set()

            while current_node_id and current_node_id not in visited:
                visited.add(current_node_id)
                node = mapping.get(current_node_id)
                message = node.get("message") if node else None
                if message:
                    role = (message.get("author") or {}).get("role")
                    parts = (message.get("content") or {}).get("parts")

                    if role in ("user", "assistant") and isinstance(parts, list):
                        text = "\n\n".join(p for p in parts if isinstance(p, str))

                        if text.strip():
                            create_time = message.get("create_time")
                            thread.insert(
                                0,
                                ImportedMessage(
                                    id=message.get("id") or current_node_id,
                                    role=role,
                                    content=text,
                                    created_at=create_time * 1000 if create_time else None,
                                ),
                            )
                current_node_id = node.get("parent") if node else None

            create_time = conv.get("create_time")
            conversations.append(
                ImportedConversation(
                    id=conv.get("id") or conv.get("uuid") or str(random.random()),
                    provider=self.provider_id,
                    title=conv.get("title") or "Untitled",
                    created_at=create_time * 1000 if create_time else None,
                    messages=thread,
                )
            )

        return [conv for conv in conversations if conv.messages]


PARSERS = [ChatGPTParser(), GrokParser(), ClaudeParser()]


def detect_parser(file_names: list[str]) -> ChatGPTParser | GrokParser | ClaudeParser | None:
    return next((parser for parser in PARSERS if parser.detect(file_names)), None)


def is_claude_manifest(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    data_files = value.get("data_files")
    if not isinstance(data_files, list) or not data_files:
        return False
    return all(
        isinstance(entry, dict)
        and isinstance(entry.get("filename"), str)
        and len(entry["filename"]) > 0
        and isinstance(entry.get("category"), str)
        for entry in data_files
    )


def parse_claude_manifest(text: str) -> dict[str, Any]:
    try:
        parsed = json.loads(text)
    except ValueError:
        raise ValueError("Invalid Claude manifest: not valid JSON") from None

    if not is_claude_manifest(parsed):
        raise ValueError("Invalid Claude manifest: missing data_files array")

    return parsed


def conversations_data_file(manifest: dict[str, Any]) -> dict[str, Any] | None:
    by_category = next((f for f in manifest["data_files"] if f["category"] == "conversations"), None)
    if by_category:
        return by_category

    return next((f for f in manifest["data_files"] if f["filename"].lower().startswith("conversations-")), None)
