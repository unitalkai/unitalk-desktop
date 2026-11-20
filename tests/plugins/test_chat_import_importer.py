from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

from hermes_state import SessionDB

PLUGIN_DIR = Path(__file__).resolve().parents[2] / "plugins" / "chat-import"


def _load(relative: str, name: str):
    spec = importlib.util.spec_from_file_location(name, PLUGIN_DIR / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


parsers = _load("parsers.py", "hermes_chat_import_parsers_importer_test")
importer = _load("importer.py", "hermes_chat_import_importer_test")


def _conversation(conv_id="conv-1", title="Hello", created_at=1710500000000, messages=None):
    return parsers.ImportedConversation(
        id=conv_id,
        provider="chatgpt",
        title=title,
        created_at=created_at,
        messages=messages
        if messages is not None
        else [
            parsers.ImportedMessage(id="m2", role="assistant", content="Hi there", created_at=1710500005000),
            parsers.ImportedMessage(id="m1", role="user", content="Hi", created_at=1710500000000),
        ],
    )


@pytest.fixture
def db(tmp_path):
    database = SessionDB(db_path=tmp_path / "state.db")
    yield database
    database.close()


@pytest.mark.parametrize(("value", "expected"), [(None, None), (1710500000, 1710500000), (1710500000000, 1710500000)])
def test_to_seconds(value, expected):
    assert importer.to_seconds(value) == expected


def test_to_session_matches_the_hermes_import_contract():
    session = importer.to_session(_conversation())

    assert session == {
        "id": "conv-1",
        "source": "chatgpt",
        "title": "Hello",
        "started_at": 1710500000,
        "messages": [
            {"role": "user", "content": "Hi", "timestamp": 1710500000},
            {"role": "assistant", "content": "Hi there", "timestamp": 1710500005},
        ],
    }


def test_to_session_falls_back_to_the_first_message_time():
    conversation = _conversation(
        created_at=None,
        messages=[
            parsers.ImportedMessage(id="m0", role="user", content="no time"),
            parsers.ImportedMessage(id="m1", role="assistant", content="later", created_at=1710500009000),
        ],
    )

    session = importer.to_session(conversation)

    assert session["started_at"] == 1710500009
    assert session["messages"][-1] == {"role": "user", "content": "no time"}


def test_invisible_suffix_matches_hermes_chat_sync():
    suffix = importer.invisible_suffix_for("thread-1")

    assert suffix
    assert set(suffix) <= {"\u200b", "\u200c", "\u200d"}
    assert suffix == importer.invisible_suffix_for("thread-1")
    assert suffix != importer.invisible_suffix_for("thread-2")


def test_imports_then_skips_the_same_conversation(db):
    first = importer.import_conversations(db, [_conversation()])
    second = importer.import_conversations(db, [_conversation()])

    assert first.imported == ["conv-1"] and not first.failed
    assert second.skipped == ["conv-1"] and not second.failed
    assert db.get_session("conv-1")["source"] == "chatgpt"
    assert [m["content"] for m in db.get_messages("conv-1")] == ["Hi", "Hi there"]


def test_duplicate_titles_get_an_invisible_suffix(db):
    result = importer.import_conversations(db, [_conversation("conv-1"), _conversation("conv-2")])

    assert result.imported == ["conv-1", "conv-2"] and not result.failed
    assert db.get_session("conv-2")["title"] == "Hello" + importer.invisible_suffix_for("conv-2")


def test_reports_progress_and_failures(db):
    seen = []

    class RefusingDB:
        def import_sessions(self, sessions):
            if sessions[0]["id"] == "conv-bad":
                return {"ok": False, "imported": 0, "skipped": 0, "errors": [{"error": "refused"}]}
            return db.import_sessions(sessions)

    result = importer.import_conversations(
        RefusingDB(), [_conversation("conv-bad"), _conversation("conv-ok", title="Ok")], on_progress=seen.append)

    assert seen == ["conv-ok"]
    assert result.imported == ["conv-ok"]
    assert result.failed == {"conv-bad": "refused"}
