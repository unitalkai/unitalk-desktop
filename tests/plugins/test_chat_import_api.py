from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PLUGIN_DIR = Path(__file__).resolve().parents[2] / "plugins" / "chat-import"
PREFIX = "/api/plugins/chat-import"


def _load(relative: str, name: str):
    spec = importlib.util.spec_from_file_location(name, PLUGIN_DIR / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def client() -> TestClient:
    plugin = _load("dashboard/plugin_api.py", "hermes_chat_import_api_test")
    app = FastAPI()
    app.include_router(plugin.router, prefix=PREFIX)
    return TestClient(app)


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/preview"),
        ("post", "/import"),
        ("get", "/jobs/job1"),
    ],
)
def test_unbuilt_routes_answer_not_implemented(client, method, path):
    response = getattr(client, method)(f"{PREFIX}{path}")

    assert response.status_code == 501


def test_origin_keys_imports_by_source_and_foreign_id():
    parsers = _load("parsers.py", "hermes_chat_import_parsers_test")
    importer = _load("importer.py", "hermes_chat_import_importer_test")
    conversation = parsers.ImportedConversation(
        source="chatgpt", foreign_id="conv-1", title="Hello", started_at=None
    )

    assert importer.origin_for(conversation) == {
        "tool": "chatgpt",
        "path": "",
        "foreign_session_id": "conv-1",
    }
