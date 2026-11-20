from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

PLUGIN_DIR = Path(__file__).resolve().parents[2] / "plugins" / "chat-import"


def _load(relative: str, name: str):
    spec = importlib.util.spec_from_file_location(name, PLUGIN_DIR / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


parsers = _load("parsers.py", "hermes_chat_import_parsers_test")

REFERENCE_MANIFEST = {
    "instructions": "Download each file using the export_url.",
    "created_at": "2026-10-05T15:39:19.514493+00:00",
    "total_files": 3,
    "data_files": [
        {"batch_index": 0, "export_url": "https://claude.ai/export/x/download/aaa", "category": "light_metadata",
         "part": 0, "filename": "light_metadata-000.zip"},
        {"batch_index": 1, "export_url": "https://claude.ai/export/x/download/bbb", "category": "memories",
         "part": 0, "filename": "memories-000.zip"},
        {"batch_index": 2, "export_url": "https://claude.ai/export/x/download/ccc", "category": "conversations",
         "part": 0, "filename": "conversations-000.zip"},
    ],
    "version": "1.0",
}


def _reader(payload):
    return lambda _name: json.dumps(payload)


@pytest.mark.parametrize(
    ("file_names", "provider"),
    [
        (["conversations.json", "user.json", "chat.html"], "chatgpt"),
        (["conversations.json"], "claude"),
        (["prod-grok-backend.json"], "grok"),
    ],
)
def test_detects_each_export(file_names, provider):
    parser = parsers.detect_parser(file_names)

    assert parser is not None
    assert parser.provider_id == provider


def test_returns_none_for_unrecognized_formats():
    assert parsers.detect_parser(["random.txt", "data.csv"]) is None


def test_parses_claude_conversations():
    export = [
        {
            "chat_messages": [
                {"attachments": [], "content": [{"text": "Hello Claude", "type": "text"}],
                 "created_at": "2024-03-15T10:00:00.000Z", "files": [], "sender": "human",
                 "text": "Hello Claude", "uuid": "msg-1"},
                {"attachments": [], "content": [{"text": "Hello! How can I help you today?", "type": "text"}],
                 "created_at": "2024-03-15T10:00:05.000Z", "files": [], "sender": "assistant",
                 "text": "Hello! How can I help you today?", "uuid": "msg-2"},
            ],
            "created_at": "2024-03-15T10:00:00.000Z",
            "name": "Greeting Chat",
            "updated_at": "2024-03-15T10:00:05.000Z",
            "uuid": "conv-1",
        }
    ]

    result = parsers.detect_parser(["conversations.json"]).parse(_reader(export), ["conversations.json"])

    assert len(result) == 1
    assert result[0].id == "conv-1"
    assert result[0].title == "Greeting Chat"
    assert [(m.role, m.content) for m in result[0].messages] == [
        ("user", "Hello Claude"),
        ("assistant", "Hello! How can I help you today?"),
    ]
    assert result[0].created_at == 1710496800000


def test_claude_appends_attachment_text_and_falls_back_to_content_blocks():
    export = [
        {
            "chat_messages": [
                {"attachments": [{"file_name": "notes.txt", "extracted_content": "line"}], "content": [],
                 "created_at": "2024-03-15T10:00:00Z", "sender": "human", "text": "See file", "uuid": "m1"},
                {"attachments": [], "content": [{"type": "text", "text": "a"}, {"type": "tool_use"},
                                                {"type": "text", "text": "b"}],
                 "created_at": "2024-03-15T10:00:01Z", "sender": "assistant", "text": "", "uuid": "m2"},
            ],
            "created_at": "2024-03-15T10:00:00Z",
            "name": "",
            "uuid": "conv-2",
        },
        {"chat_messages": [], "created_at": "2024-03-15T10:00:00Z", "name": "Empty", "uuid": "conv-3"},
    ]

    result = parsers.ClaudeParser().parse(_reader(export), ["conversations.json"])

    assert [c.id for c in result] == ["conv-2"]
    assert result[0].title == "Untitled"
    assert result[0].messages[0].content == "See file\n\n[Attachment: notes.txt]\nline"
    assert result[0].messages[1].content == "a\n\nb"


def test_parses_chatgpt_conversation_tree():
    export = [
        {
            "create_time": 1710500000,
            "current_node": "node-2",
            "id": "chat-1",
            "mapping": {
                "node-1": {"id": "node-1", "message": {"author": {"role": "user"},
                           "content": {"parts": ["What is React?"]}, "create_time": 1710500000, "id": "msg-1"},
                           "parent": None},
                "node-2": {"id": "node-2", "message": {"author": {"role": "assistant"},
                           "content": {"parts": ["React is a JavaScript library for building UI."]},
                           "create_time": 1710500005, "id": "msg-2"}, "parent": "node-1"},
            },
            "title": "React Question",
        }
    ]
    names = ["conversations.json", "user.json"]

    result = parsers.detect_parser(names).parse(_reader(export), names)

    assert len(result) == 1
    assert result[0].id == "chat-1"
    assert result[0].title == "React Question"
    assert result[0].created_at == 1710500000000
    assert [(m.role, m.content) for m in result[0].messages] == [
        ("user", "What is React?"),
        ("assistant", "React is a JavaScript library for building UI."),
    ]


def test_chatgpt_skips_system_nodes_and_stops_on_cycles():
    export = [
        {
            "current_node": "b",
            "id": "chat-2",
            "mapping": {
                "a": {"message": {"author": {"role": "system"}, "content": {"parts": ["sys"]}}, "parent": "b"},
                "b": {"message": {"author": {"role": "user"}, "content": {"parts": ["hi", {"x": 1}]}}, "parent": "a"},
            },
        },
        {"current_node": "z", "id": "chat-3", "mapping": {}},
    ]

    result = parsers.ChatGPTParser().parse(_reader(export), ["conversations.json"])

    assert [c.id for c in result] == ["chat-2"]
    assert [(m.role, m.content) for m in result[0].messages] == [("user", "hi")]


def test_parses_grok_conversations():
    export = {
        "conversations": [
            {
                "conversation": {"create_time": "2024-03-15T12:00:00.000Z", "id": "grok-conv-1",
                                 "title": "Grok Math Chat"},
                "responses": [
                    {"response": {"_id": "grok-msg-1", "conversation_id": "grok-conv-1",
                                  "create_time": "2024-03-15T12:00:00.000Z", "message": "What is 2+2?",
                                  "sender": "human"}},
                    {"response": {"_id": "grok-msg-2", "conversation_id": "grok-conv-1",
                                  "create_time": "2024-03-15T12:00:01.000Z", "message": "2+2 = 4",
                                  "sender": "assistant"}},
                ],
            }
        ]
    }

    result = parsers.detect_parser(["prod-grok-backend.json"]).parse(_reader(export), ["prod-grok-backend.json"])

    assert len(result) == 1
    assert result[0].id == "grok-conv-1"
    assert result[0].title == "Grok Math Chat"
    assert [(m.role, m.content) for m in result[0].messages] == [("user", "What is 2+2?"), ("assistant", "2+2 = 4")]


@pytest.mark.parametrize(
    ("parser", "payload", "message"),
    [
        (parsers.ClaudeParser(), {}, "Invalid Claude export: conversations.json is not an array"),
        (parsers.ChatGPTParser(), {}, "Invalid ChatGPT export: conversations.json is not an array"),
        (parsers.GrokParser(), [], "Invalid Grok export: missing conversations array"),
    ],
)
def test_rejects_malformed_exports(parser, payload, message):
    names = ["conversations.json", "prod-grok-backend.json"]

    with pytest.raises(ValueError, match=message):
        parser.parse(_reader(payload), names)


def test_accepts_a_valid_claude_manifest():
    assert parsers.is_claude_manifest(REFERENCE_MANIFEST) is True


@pytest.mark.parametrize(
    "value",
    [
        None,
        "manifest",
        [{"filename": "a.zip", "category": "conversations"}],
        {"version": "1.0"},
        {"data_files": [{"export_url": "https://x"}]},
        {"data_files": [{"filename": "a.zip"}]},
    ],
)
def test_rejects_invalid_claude_manifests(value):
    assert parsers.is_claude_manifest(value) is False


def test_parse_claude_manifest_errors():
    with pytest.raises(ValueError, match="not valid JSON"):
        parsers.parse_claude_manifest("{nope")
    with pytest.raises(ValueError, match="missing data_files array"):
        parsers.parse_claude_manifest(json.dumps({"version": "1.0"}))


def test_finds_the_conversations_data_file():
    manifest = parsers.parse_claude_manifest(json.dumps(REFERENCE_MANIFEST))

    assert parsers.conversations_data_file(manifest)["filename"] == "conversations-000.zip"


def test_falls_back_to_the_conversations_filename():
    manifest = {"data_files": [{"filename": "Conversations-001.zip", "category": "other"}]}

    assert parsers.conversations_data_file(manifest)["filename"] == "Conversations-001.zip"
    assert parsers.conversations_data_file({"data_files": [{"filename": "m.zip", "category": "x"}]}) is None
