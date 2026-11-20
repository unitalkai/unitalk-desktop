from __future__ import annotations

import asyncio
import importlib.util
import io
import json
import sys
import time
import zipfile
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hermes_state import SessionDB

PLUGIN_DIR = Path(__file__).resolve().parents[2] / "plugins" / "chat-import"
PREFIX = "/api/plugins/chat-import"

CLAUDE_EXPORT = [
    {
        "chat_messages": [
            {"created_at": "2024-03-15T10:00:00Z", "sender": "human", "text": "Hello Claude", "uuid": "m1"},
            {"created_at": "2024-03-15T10:00:05Z", "sender": "assistant", "text": "Hello!", "uuid": "m2"},
        ],
        "created_at": "2024-03-15T10:00:00Z",
        "name": "Greeting Chat",
        "uuid": "conv-1",
    },
    {
        "chat_messages": [
            {"created_at": "2024-03-16T10:00:00Z", "sender": "human", "text": "Second", "uuid": "m3"},
        ],
        "created_at": "2024-03-16T10:00:00Z",
        "name": "Second Chat",
        "uuid": "conv-2",
    },
]


def _load(relative: str, name: str):
    spec = importlib.util.spec_from_file_location(name, PLUGIN_DIR / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _zip(files: dict[str, object]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in files.items():
            archive.writestr(name, json.dumps(payload))
    return buffer.getvalue()


@pytest.fixture
def plugin(tmp_path, monkeypatch):
    module = _load("dashboard/plugin_api.py", "hermes_chat_import_api_test")
    monkeypatch.setattr(module, "_open_db", lambda: SessionDB(db_path=tmp_path / "state.db"))
    return module


@pytest.fixture
def client(plugin) -> TestClient:
    app = FastAPI()
    app.include_router(plugin.router, prefix=PREFIX)
    return TestClient(app)


def _wait(client, job_id):
    for _ in range(200):
        job = client.get(f"{PREFIX}/jobs/{job_id}").json()
        if job["status"] != "importing":
            return job
        time.sleep(0.05)
    raise AssertionError("import job did not finish")


def test_preview_then_import_a_claude_export(client, tmp_path):
    data = _zip({"conversations.json": CLAUDE_EXPORT})

    preview = client.post(f"{PREFIX}/preview", files=[("files", ("claude.zip", data, "application/zip"))])

    assert preview.status_code == 200
    body = preview.json()
    assert body["provider"] == "claude"
    assert body["providerName"] == "Claude"
    assert body["conversations"] == [
        {"id": "conv-1", "title": "Greeting Chat", "messages": 2},
        {"id": "conv-2", "title": "Second Chat", "messages": 1},
    ]

    started = client.post(f"{PREFIX}/import", json={"uploadId": body["uploadId"], "ids": ["conv-1"]})
    job = _wait(client, started.json()["jobId"])

    assert job["status"] == "completed"
    assert job["total"] == 1
    assert job["completedIds"] == ["conv-1"]
    assert job["imported"] == ["conv-1"]

    again = _wait(client, client.post(f"{PREFIX}/import", json={"uploadId": body["uploadId"]}).json()["jobId"])

    assert again["skipped"] == ["conv-1"]
    assert again["imported"] == ["conv-2"]
    db = SessionDB(db_path=tmp_path / "state.db")
    try:
        assert db.get_session("conv-1")["title"] == "Greeting Chat"
    finally:
        db.close()


def test_preview_uses_the_claude_manifest_to_pick_the_data_zip(client):
    manifest = {"data_files": [
        {"filename": "memories-000.zip", "category": "memories", "export_url": "https://claude.ai/a"},
        {"filename": "conversations-000.zip", "category": "conversations", "export_url": "https://claude.ai/b"},
    ]}
    files = [
        ("files", ("manifest.json", json.dumps(manifest).encode(), "application/json")),
        ("files", ("memories-000.zip", _zip({"memories.json": []}), "application/zip")),
        ("files", ("conversations-000.zip", _zip({"conversations.json": CLAUDE_EXPORT}), "application/zip")),
    ]

    response = client.post(f"{PREFIX}/preview", files=files)

    assert response.status_code == 200
    assert response.json()["provider"] == "claude"


def test_preview_asks_for_the_missing_data_zip(client):
    manifest = {"data_files": [
        {"filename": "conversations-000.zip", "category": "conversations", "export_url": "https://claude.ai/b"},
    ]}

    response = client.post(
        f"{PREFIX}/preview", files=[("files", ("manifest.json", json.dumps(manifest).encode(), "application/json"))])

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "error": "data_file_required",
        "filename": "conversations-000.zip",
        "exportUrl": "https://claude.ai/b",
    }


@pytest.mark.parametrize(
    ("files", "detail"),
    [
        ([("files", ("notes.txt", b"hi", "text/plain"))],
         "Please select a ZIP export archive or a Claude JSON manifest file."),
        ([("files", ("x.zip", _zip({"random.txt": "x"}), "application/zip"))],
         "Unsupported export archive format. Supported providers: ChatGPT, Claude, Grok."),
        ([("files", ("x.zip", _zip({"conversations.json": []}), "application/zip"))],
         "No valid conversations found in the export archive."),
        ([("files", ("x.zip", b"not a zip", "application/zip"))],
         "Please select a ZIP export archive or a Claude JSON manifest file."),
    ],
)
def test_preview_rejects_bad_uploads(client, files, detail):
    response = client.post(f"{PREFIX}/preview", files=files)

    assert response.status_code == 400
    assert response.json()["detail"] == detail


def test_preview_rejects_uploads_over_the_limit(client, plugin, monkeypatch):
    monkeypatch.setattr(plugin.archive, "MAX_UPLOAD_BYTES", 10)

    response = client.post(
        f"{PREFIX}/preview", files=[("files", ("x.zip", _zip({"conversations.json": CLAUDE_EXPORT}), "application/zip"))])

    assert response.status_code == 413


def test_unknown_upload_and_job(client):
    assert client.post(f"{PREFIX}/import", json={"uploadId": "missing"}).status_code == 404
    assert client.get(f"{PREFIX}/jobs/missing").status_code == 404


def test_unitalk_sync_requires_a_session(client):
    assert client.post(f"{PREFIX}/unitalk/sync").status_code == 401


def test_unitalk_sync_requires_the_convex_url(client, plugin, monkeypatch):
    monkeypatch.setattr(plugin, "get_env_value_prefer_dotenv", lambda name: "")

    response = client.post(f"{PREFIX}/unitalk/sync", headers={"X-Unitalk-Session": "token"})

    assert response.status_code == 503


def test_unitalk_sync_forwards_the_session_to_convex(client, plugin, monkeypatch):
    calls = []

    async def fake_sync(convex_url, token):
        calls.append((convex_url, token))
        return {"success": True, "syncedThreads": 3, "errors": []}

    monkeypatch.setattr(plugin, "get_env_value_prefer_dotenv", lambda name: "https://example.convex.cloud")
    monkeypatch.setattr(plugin.unitalk_source, "sync_my_chats", fake_sync)

    response = client.post(f"{PREFIX}/unitalk/sync", headers={"X-Unitalk-Session": "token"})

    assert response.status_code == 200
    assert response.json() == {"success": True, "syncedThreads": 3, "errors": []}
    assert calls == [("https://example.convex.cloud", "token")]


def _sync(plugin, handler):
    transport = httpx.MockTransport(handler)
    return asyncio.run(plugin.unitalk_source.sync_my_chats("https://example.convex.cloud/", "token", transport=transport))


def test_sync_my_chats_calls_the_convex_action(plugin):
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"status": "success", "value": {"success": True, "syncedThreads": 1}})

    assert _sync(plugin, handler) == {"success": True, "syncedThreads": 1}
    assert seen == {
        "url": "https://example.convex.cloud/api/action",
        "auth": "Bearer token",
        "body": {"path": "hermesChatSync:syncMyChatsToHermes", "args": {}, "format": "json"},
    }


@pytest.mark.parametrize(
    ("response", "status_code"),
    [
        (httpx.Response(400, json={"status": "error", "errorMessage": "Uncaught Error: Unauthorized"}), 401),
        (httpx.Response(401, json={}), 401),
        (httpx.Response(500, json={"status": "error", "errorMessage": "boom"}), 502),
        (httpx.Response(200, text="not json"), 502),
    ],
)
def test_sync_my_chats_maps_convex_errors(plugin, response, status_code):
    with pytest.raises(plugin.unitalk_source.UnitalkSyncError) as error:
        _sync(plugin, lambda request: response)

    assert error.value.status_code == status_code
