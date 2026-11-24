"""Desktop Clerk credentials (the plugin mints its own session tokens) and the active-bases selection."""

from __future__ import annotations

import base64
import importlib.util
import json
import os
import stat
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
CREDS = {"sessionId": "sess_abc123", "clientToken": "client-jwt-1", "frontendApi": FAPI, "organizationId": "org_9"}


def _load_plugin():
    spec = importlib.util.spec_from_file_location(
        "hermes_knowledge_base_session_test", PLUGIN_DIR / "dashboard" / "plugin_api.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _segment(value: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


def make_jwt(n: int, ttl: int = 60) -> str:
    payload = {"sub": "user_1", "exp": int(time.time()) + ttl, "n": n}
    return f"{_segment({'alg': 'RS256'})}.{_segment(payload)}.sig"


class FakeClerk:
    def __init__(self) -> None:
        self.calls: list[httpx.Request] = []
        self.status = 200
        self.ttl = 60
        self.rotate_to: str | None = None
        self.fail_network = False
        self.error_code = "session_not_found"

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.fail_network:
            raise httpx.ConnectError("down", request=request)
        self.calls.append(request)
        if self.status != 200:
            return httpx.Response(self.status, json={"errors": [{"code": self.error_code}]})
        headers = {"Authorization": f"Bearer {self.rotate_to}"} if self.rotate_to else {}
        return httpx.Response(200, json={"jwt": make_jwt(len(self.calls), self.ttl)}, headers=headers)


class FakeConvex:
    def __init__(self) -> None:
        self.calls: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if request.url.path == "/kb/bases":
            return httpx.Response(200, json={"owned": [], "shared": []})
        return httpx.Response(200, json={"ok": True})

    def bearer(self, index: int = -1) -> str:
        return self.calls[index].headers["authorization"].removeprefix("Bearer ")


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    for name in ("LITELLM_KEY_ID", "UNITALK_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("KB_CONVEX_SITE_URL", SITE)
    return tmp_path


@pytest.fixture
def plugin(home, monkeypatch):
    module = _load_plugin()
    module.auth._sessions.clear()
    return module


@pytest.fixture
def clerk(plugin, monkeypatch):
    fake = FakeClerk()
    monkeypatch.setattr(plugin.auth, "_clerk_transport", httpx.MockTransport(fake.handler))
    return fake


@pytest.fixture
def convex(plugin, monkeypatch):
    fake = FakeConvex()
    monkeypatch.setattr(plugin, "_transport", httpx.MockTransport(fake.handler))
    return fake


@pytest.fixture
def client(plugin):
    app = FastAPI()
    app.include_router(plugin.router, prefix=PREFIX)
    return TestClient(app)


def _push(client, **overrides):
    return client.put(f"{PREFIX}/session", json={"credentials": {**CREDS, **overrides}})


def _decode(jwt: str) -> dict:
    return json.loads(base64.urlsafe_b64decode(jwt.split(".")[1] + "=="))


def test_credentials_are_verified_with_clerk_and_stored_privately(client, clerk, home):
    response = _push(client)

    assert response.status_code == 200
    assert response.json()["mode"] == "credentials"
    assert "client-jwt-1" not in response.text
    [mint] = clerk.calls
    assert str(mint.url).startswith(f"{FAPI}/v1/client/sessions/sess_abc123/tokens")
    assert mint.url.params["_is_native"] == "1"
    assert mint.headers["authorization"] == "Bearer client-jwt-1"
    assert mint.content == b"organization_id=org_9"

    stored = home / "plugin-data" / "knowledge-base" / "session.json"
    data = json.loads(stored.read_text())
    assert data["kind"] == "clerk_client" and data["clientToken"] == "client-jwt-1"
    if os.name == "posix":
        assert stat.S_IMODE(stored.stat().st_mode) == 0o600

    config = client.get(f"{PREFIX}/config")
    assert config.json() == {"configured": True, "session": True, "sessionMode": "credentials"}
    assert "client-jwt-1" not in config.text


def test_each_request_uses_a_fresh_token_minted_from_clerk(client, clerk, convex, plugin, monkeypatch):
    _push(client)
    client.get(f"{PREFIX}/bases")
    assert _decode(convex.bearer())["n"] == 1  # cached token still fresh: no extra Clerk call
    assert len(clerk.calls) == 1

    # Minutes later (app idle or closed, nobody pushing): the next call mints a new token itself.
    monkeypatch.setattr(plugin.auth, "_now", lambda: int(time.time()) + 600)
    clerk.ttl = 660
    client.get(f"{PREFIX}/bases")

    assert len(clerk.calls) == 2
    assert _decode(convex.bearer())["n"] == 2


def test_pushing_the_same_credentials_again_does_not_call_clerk(client, clerk):
    _push(client)
    _push(client)
    assert len(clerk.calls) == 1

    _push(client, organizationId="org_other")  # org switch: new token for the new org
    assert len(clerk.calls) == 2
    assert clerk.calls[-1].content == b"organization_id=org_other"


def test_personal_account_is_requested_explicitly(client, clerk):
    _push(client, organizationId=None)

    # An empty organization_id asks Clerk for the personal account instead of the session's
    # last active organization.
    assert clerk.calls[0].content == b"organization_id="


def test_a_rotated_client_token_is_kept(client, clerk, home):
    clerk.rotate_to = "client-jwt-2"
    _push(client)

    data = json.loads((home / "plugin-data" / "knowledge-base" / "session.json").read_text())
    assert data["clientToken"] == "client-jwt-2"


def test_ended_session_is_cleared_and_reported(client, clerk, convex, plugin, monkeypatch, home):
    _push(client)
    clerk.status = 401  # user signed out / session revoked in Clerk
    monkeypatch.setattr(plugin.auth, "_now", lambda: int(time.time()) + 600)

    response = client.get(f"{PREFIX}/bases")

    assert response.status_code == 428
    assert response.json()["detail"] == "kb_session_invalid"
    assert response.json()["step"] == "clerk_mint"  # Clerk refused the token, Convex was never called
    assert convex.calls == []
    assert not (home / "plugin-data" / "knowledge-base" / "session.json").exists()
    assert client.get(f"{PREFIX}/bases").json() == {"detail": "kb_session_required"}


def test_pushing_credentials_of_an_ended_session_is_refused(client, clerk, home):
    clerk.status = 404

    response = _push(client)

    assert response.status_code == 428
    assert response.json() == {"detail": "kb_session_invalid"}
    assert not (home / "plugin-data" / "knowledge-base" / "session.json").exists()


def test_clerk_unreachable_keeps_the_last_token_while_it_is_valid(client, clerk, convex, plugin, monkeypatch):
    _push(client)
    clerk.fail_network = True
    # Inside the refresh window but not expired: the cached token is still usable.
    monkeypatch.setattr(plugin.auth, "_now", lambda: int(time.time()) + 45)

    assert client.get(f"{PREFIX}/bases").status_code == 200
    assert _decode(convex.bearer())["n"] == 1


def test_clerk_unreachable_on_push_is_a_502(client, clerk):
    clerk.fail_network = True

    response = _push(client)

    assert response.status_code == 502
    assert response.json() == {"detail": "clerk_unreachable"}


@pytest.mark.parametrize(
    "overrides,detail",
    [
        ({"frontendApi": "http://clerk.example.test"}, "invalid_frontend_api"),
        ({"frontendApi": "https://clerk.example.test/evil"}, "invalid_frontend_api"),
        ({"frontendApi": "https://clerk.example.test:8443"}, "invalid_frontend_api"),
        ({"frontendApi": "https://user@clerk.example.test"}, "invalid_frontend_api"),
        ({"sessionId": "../etc"}, "invalid_session_id"),
        ({"organizationId": "team 1"}, "invalid_organization_id"),
        ({"clientToken": "has space"}, "invalid_client_token"),
    ],
)
def test_malformed_credentials_are_rejected_without_calling_clerk(client, clerk, overrides, detail):
    response = _push(client, **overrides)

    assert response.status_code == 400
    assert response.json() == {"detail": detail}
    assert clerk.calls == []


def test_a_pushed_jwt_replaces_credentials_and_delete_clears_them(client, clerk, home):
    _push(client)
    assert client.delete(f"{PREFIX}/session").json() == {"ok": True}
    assert client.get(f"{PREFIX}/config").json()["sessionMode"] is None

    _push(client)
    assert client.put(f"{PREFIX}/session", json={"token": make_jwt(0)}).json()["mode"] == "token"
    assert client.get(f"{PREFIX}/config").json()["sessionMode"] == "token"


def test_session_body_needs_a_token_or_credentials(client):
    assert client.put(f"{PREFIX}/session", json={}).json() == {"detail": "invalid_session_token"}


def test_an_organization_the_user_left_does_not_end_the_session(client, clerk, convex, plugin, monkeypatch, home):
    _push(client)
    clerk.status, clerk.error_code = 404, "organization_not_found_or_unauthorized"
    monkeypatch.setattr(plugin.auth, "_now", lambda: int(time.time()) + 600)

    assert client.get(f"{PREFIX}/bases").json()["detail"] == "kb_session_invalid"
    assert (home / "plugin-data" / "knowledge-base" / "session.json").exists()  # session kept

    response = _push(client, organizationId="org_gone")
    assert response.status_code == 403
    assert response.json() == {"detail": "kb_organization_unavailable"}


def test_each_organization_keeps_its_own_selection(client, clerk):
    _push(client)  # org_9
    client.put(f"{PREFIX}/active-bases", json={"baseIds": ["org_base"]})

    _push(client, organizationId=None)  # switch to the personal account
    assert client.get(f"{PREFIX}/active-bases").json() == {"baseIds": None}
    client.put(f"{PREFIX}/active-bases", json={"baseIds": []})

    _push(client)  # back to org_9
    assert client.get(f"{PREFIX}/active-bases").json() == {"baseIds": ["org_base"]}
    _push(client, organizationId=None)
    assert client.get(f"{PREFIX}/active-bases").json() == {"baseIds": []}


def test_active_bases_default_to_all_and_round_trip(client, home):
    assert client.get(f"{PREFIX}/active-bases").json() == {"baseIds": None}

    assert client.put(f"{PREFIX}/active-bases", json={"baseIds": ["b1", "b2", "b1"]}).json() == {"baseIds": ["b1", "b2"]}
    assert client.get(f"{PREFIX}/active-bases").json() == {"baseIds": ["b1", "b2"]}

    assert client.put(f"{PREFIX}/active-bases", json={"baseIds": []}).json() == {"baseIds": []}
    assert client.put(f"{PREFIX}/active-bases", json={"baseIds": None}).json() == {"baseIds": None}
    assert client.get(f"{PREFIX}/active-bases").json() == {"baseIds": None}


def test_active_bases_reject_bad_ids(client):
    response = client.put(f"{PREFIX}/active-bases", json={"baseIds": ["ok", "../x"]})

    assert response.status_code == 400
    assert response.json() == {"detail": "invalid_base_ids"}
