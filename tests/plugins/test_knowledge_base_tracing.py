"""Failures name the step that broke (Hermes or Convex side), carry a request id and are logged."""

from __future__ import annotations

import base64
import importlib.util
import json
import logging
import sys
import time
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PLUGIN_DIR = Path(__file__).resolve().parents[2] / "plugins" / "knowledge-base"
PREFIX = "/api/plugins/knowledge-base"
SITE = "https://kb-test.convex.site"
FAPI = "https://clerk.example.test"
CLIENT_TOKEN = "client-jwt-secret"
CREDS = {"sessionId": "sess_abc123", "clientToken": CLIENT_TOKEN, "frontendApi": FAPI, "organizationId": "org_9"}
LOGGER = "plugins.knowledge_base"


def _load_plugin():
    spec = importlib.util.spec_from_file_location(
        "hermes_knowledge_base_tracing_test", PLUGIN_DIR / "dashboard" / "plugin_api.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _segment(value: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


def make_jwt(ttl: int = 60) -> str:
    return f"{_segment({'alg': 'RS256'})}.{_segment({'sub': 'user_1', 'exp': int(time.time()) + ttl})}.sig"


def _events(caplog, level=logging.WARNING) -> list[dict]:
    return [
        json.loads(record.getMessage().removeprefix("kb.error "))
        for record in caplog.records
        if record.name == LOGGER and record.levelno == level and record.getMessage().startswith("kb.error ")
    ]


@pytest.fixture
def plugin(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    for name in ("LITELLM_KEY_ID", "UNITALK_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("KB_CONVEX_SITE_URL", SITE)
    module = _load_plugin()
    module.auth._sessions.clear()
    return module


@pytest.fixture
def clerk(plugin, monkeypatch):
    state = {"fail": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if state["fail"]:
            raise httpx.ConnectError("clerk down", request=request)
        return httpx.Response(200, json={"jwt": make_jwt()})

    monkeypatch.setattr(plugin.auth, "_clerk_transport", httpx.MockTransport(handler))
    return state


@pytest.fixture
def convex(plugin, monkeypatch):
    state: dict = {"calls": [], "reply": None}

    def handler(request: httpx.Request) -> httpx.Response:
        state["calls"].append(request)
        if request.url.host == "blob.example":
            return httpx.Response(500)
        if state["reply"] is not None:
            return state["reply"](request)
        return httpx.Response(200, json={"owned": [], "shared": []})

    monkeypatch.setattr(plugin, "_transport", httpx.MockTransport(handler))
    return state


@pytest.fixture
def client(plugin, clerk):
    app = FastAPI()
    app.include_router(plugin.router, prefix=PREFIX)
    test_client = TestClient(app)
    assert test_client.put(f"{PREFIX}/session", json={"credentials": CREDS}).status_code == 200
    return test_client


def test_each_request_sends_a_request_id(client, convex):
    client.get(f"{PREFIX}/bases")

    [call] = convex["calls"]
    assert call.headers["x-kb-request-id"].startswith("hermes_")


def test_a_convex_step_failure_is_returned_and_logged_with_the_same_request_id(client, convex, caplog):
    def failing_search(request: httpx.Request) -> httpx.Response:
        sent = request.headers["x-kb-request-id"]
        body = {
            "error": "Knowledge base service error",
            "code": "upstream",
            "requestId": sent,  # Convex reuses the id Hermes sent
            "step": "search_embed",
            "service": "embeddings",
        }
        return httpx.Response(502, json=body, headers={"x-kb-request-id": sent})

    convex["reply"] = failing_search
    with caplog.at_level(logging.INFO, logger=LOGGER):
        response = client.post(f"{PREFIX}/search", json={"query": "q"})

    sent = convex["calls"][-1].headers["x-kb-request-id"]
    assert response.status_code == 502
    assert response.json() == {
        "detail": "upstream",
        "step": "search_embed",
        "service": "embeddings",
        "requestId": sent,
    }
    [event] = _events(caplog)
    assert event["route"] == "POST /kb/search"
    assert event["step"] == "search_embed" and event["service"] == "embeddings"
    assert event["requestId"] == sent and event["status"] == 502


def test_unreachable_convex_is_tagged_convex_request(client, convex, caplog):
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    convex["reply"] = down
    with caplog.at_level(logging.INFO, logger=LOGGER):
        body = client.get(f"{PREFIX}/bases").json()

    assert body["detail"] == "upstream" and body["step"] == "convex_request"
    [event] = _events(caplog)
    assert event["step"] == "convex_request" and "ConnectError" in event["message"]


def test_expected_client_errors_are_logged_below_warning(client, convex, caplog):
    convex["reply"] = lambda request: httpx.Response(404, json={"error": "gone", "code": "not_found"})

    with caplog.at_level(logging.INFO, logger=LOGGER):
        assert client.delete(f"{PREFIX}/bases/b1").status_code == 404

    assert _events(caplog) == []
    assert _events(caplog, logging.INFO)[0]["code"] == "not_found"


def test_a_clerk_outage_is_logged_as_clerk_mint_without_secrets(client, clerk, convex, plugin, monkeypatch, caplog):
    clerk["fail"] = True
    monkeypatch.setattr(plugin.auth, "_now", lambda: int(time.time()) + 600)  # cached token expired

    with caplog.at_level(logging.INFO, logger=LOGGER):
        response = client.get(f"{PREFIX}/bases")

    assert response.status_code == 428
    assert response.json()["step"] == "clerk_mint"
    events = _events(caplog)
    mint = next(event for event in events if event.get("reason") == "clerk_unreachable")
    assert mint["step"] == "clerk_mint" and mint["sessionId"] == "sess_abc123"
    assert mint["usingCachedToken"] is False
    assert CLIENT_TOKEN not in caplog.text


def test_a_storage_upload_failure_is_blob_upload_and_never_logs_the_upload_url(client, convex, caplog):
    def create(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/kb/files":
            target = {
                "method": "PUT",
                "url": "https://blob.example/?pathname=kb/x&token=upload-secret",
                "headers": {"authorization": "Bearer upload-secret"},
            }
            return httpx.Response(200, json={"fileId": "f1", "upload": target, "partUploads": []})
        return httpx.Response(200, json={"ok": True})

    convex["reply"] = create
    with caplog.at_level(logging.INFO, logger=LOGGER):
        response = client.post(f"{PREFIX}/bases/b1/files", files={"file": ("a.txt", b"hello", "text/plain")})

    assert response.status_code == 502
    assert response.json() == {"detail": "upload_failed", "step": "blob_upload"}
    [event] = _events(caplog)
    assert event["step"] == "blob_upload" and event["route"] == "PUT blob (5 bytes)"
    assert "upload-secret" not in caplog.text
