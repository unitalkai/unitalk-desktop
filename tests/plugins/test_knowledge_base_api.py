from __future__ import annotations

import base64
import hashlib
import importlib.util
import io
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
STORAGE_HOST = "blob.example"


def _load_plugin():
    spec = importlib.util.spec_from_file_location(
        "hermes_knowledge_base_api_test", PLUGIN_DIR / "dashboard" / "plugin_api.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _segment(value: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


def make_token(exp_offset: int = 300, **claims) -> str:
    payload = {"sub": "user_1", "exp": int(time.time()) + exp_offset, "o": {"id": "org_1"}, **claims}
    return f"{_segment({'alg': 'RS256'})}.{_segment(payload)}.signature"


class FakeConvex:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.results: dict[tuple[str, str], object] = {}
        self.errors: dict[tuple[str, str], tuple[int, dict]] = {}
        self.storage_status = 200

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == STORAGE_HOST:
            self.calls.append(
                {
                    "method": "PUT",
                    "path": "storage",
                    "url": str(request.url),
                    "body": request.content,
                    "headers": request.headers,
                }
            )
            return httpx.Response(self.storage_status)
        assert str(request.url).startswith(SITE)
        key = (request.method, request.url.path)
        body = json.loads(request.content) if request.content else None
        self.calls.append(
            {
                "method": request.method,
                "path": request.url.path,
                "params": dict(request.url.params),
                "json": body,
                "headers": request.headers,
            }
        )
        if key in self.errors:
            status, payload = self.errors[key]
            return httpx.Response(status, json=payload)
        return httpx.Response(200, json=self.results.get(key, {"ok": True}))

    def paths(self) -> list[str]:
        return [f"{call['method']} {call['path']}" for call in self.calls]

    def call(self, method: str, path: str) -> dict:
        return next(call for call in self.calls if call["method"] == method and call["path"] == path)


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    for name in ("KB_CONVEX_SITE_URL", "LITELLM_KEY_ID", "UNITALK_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    return tmp_path


@pytest.fixture
def plugin(home):
    return _load_plugin()


@pytest.fixture
def configured(plugin, monkeypatch):
    monkeypatch.setenv("KB_CONVEX_SITE_URL", SITE + "/")
    return plugin


@pytest.fixture
def convex(configured):
    fake = FakeConvex()
    configured._transport = httpx.MockTransport(fake.handler)
    return fake


def _client(plugin) -> TestClient:
    app = FastAPI()
    app.include_router(plugin.router, prefix=PREFIX)
    return TestClient(app)


def _signed_in(plugin, token: str | None = None) -> TestClient:
    client = _client(plugin)
    response = client.put(f"{PREFIX}/session", json={"token": token or make_token()})
    assert response.status_code == 200
    return client


def test_config_reports_unconfigured_without_session(plugin):
    response = _client(plugin).get(f"{PREFIX}/config")

    assert response.status_code == 200
    assert response.json() == {"configured": False, "session": False, "sessionMode": None}


def test_routes_return_428_when_not_configured(plugin):
    client = _signed_in(plugin)

    response = client.get(f"{PREFIX}/bases")

    assert response.status_code == 428
    assert response.json() == {"detail": "kb_not_configured"}


def test_routes_return_428_without_any_auth(convex, configured):
    response = _client(configured).get(f"{PREFIX}/bases")

    assert response.status_code == 428
    assert response.json() == {"detail": "kb_session_required"}
    assert convex.calls == []


def test_session_token_is_persisted_privately_and_never_echoed(convex, configured, home):
    token = make_token()
    client = _signed_in(configured, token)

    config = client.get(f"{PREFIX}/config")
    assert config.json() == {"configured": True, "session": True, "sessionMode": "token"}
    assert token not in config.text

    stored = home / "plugin-data" / "knowledge-base" / "session.json"
    assert json.loads(stored.read_text())["token"] == token
    if os.name == "posix":
        assert stat.S_IMODE(stored.stat().st_mode) == 0o600


def test_persisted_session_is_shared_with_a_fresh_process(convex, configured):
    token = make_token()
    _signed_in(configured, token)
    configured.auth._sessions.clear()

    convex.results[("GET", "/kb/bases")] = {"owned": [], "shared": []}
    assert _client(configured).get(f"{PREFIX}/bases").status_code == 200
    assert convex.call("GET", "/kb/bases")["headers"]["authorization"] == f"Bearer {token}"


def test_delete_session_clears_memory_and_storage(convex, configured, home):
    client = _signed_in(configured)

    assert client.delete(f"{PREFIX}/session").json() == {"ok": True}
    assert not (home / "plugin-data" / "knowledge-base" / "session.json").exists()
    assert client.get(f"{PREFIX}/config").json()["session"] is False
    assert client.get(f"{PREFIX}/bases").json() == {"detail": "kb_session_required"}


@pytest.mark.parametrize("token", ["not-a-jwt", make_token(exp_offset=-10), f"a.{_segment({'sub': 'u'})}.c"])
def test_put_session_rejects_bad_or_expired_tokens(configured, token):
    response = _client(configured).put(f"{PREFIX}/session", json={"token": token})

    assert response.status_code == 400
    assert response.json() == {"detail": "invalid_session_token"}


def test_expired_stored_session_requires_a_new_one(convex, configured, monkeypatch):
    client = _signed_in(configured, make_token(exp_offset=60))
    monkeypatch.setattr(configured.auth, "_now", lambda: int(time.time()) + 120)

    assert client.get(f"{PREFIX}/bases").json() == {"detail": "kb_session_required"}


def test_litellm_key_id_wins_over_api_key_and_session(convex, configured, monkeypatch):
    monkeypatch.setenv("LITELLM_KEY_ID", "key-id-1")
    monkeypatch.setenv("UNITALK_API_KEY", "api-key-1")
    client = _signed_in(configured)

    client.get(f"{PREFIX}/bases")

    headers = convex.call("GET", "/kb/bases")["headers"]
    assert headers["x-litellm-key"] == "key-id-1"
    assert "authorization" not in headers


def test_unitalk_api_key_is_used_when_key_id_is_missing(convex, configured, monkeypatch):
    monkeypatch.setenv("UNITALK_API_KEY", "api-key-1")

    response = _client(configured).get(f"{PREFIX}/bases")

    assert response.status_code == 200
    assert convex.call("GET", "/kb/bases")["headers"]["x-litellm-key"] == "api-key-1"


def test_settings_are_read_through_the_secret_scope(convex, configured):
    from agent.secret_scope import reset_secret_scope, set_secret_scope

    token = set_secret_scope({"KB_CONVEX_SITE_URL": SITE, "LITELLM_KEY_ID": "scoped-key"})
    try:
        response = _client(configured).get(f"{PREFIX}/bases")
    finally:
        reset_secret_scope(token)

    assert response.status_code == 200
    assert convex.call("GET", "/kb/bases")["headers"]["x-litellm-key"] == "scoped-key"


def test_base_routes_map_to_the_contract(convex, configured):
    convex.results[("GET", "/kb/bases")] = {"owned": [{"id": "b1", "name": "Docs"}], "shared": [{"id": "b2"}]}
    convex.results[("POST", "/kb/bases")] = {"id": "b3"}
    client = _signed_in(configured)

    assert client.get(f"{PREFIX}/bases").json() == {"owned": [{"id": "b1", "name": "Docs"}], "shared": [{"id": "b2"}]}
    assert client.post(f"{PREFIX}/bases", json={"name": " New ", "description": " "}).json() == {"id": "b3"}
    assert client.patch(f"{PREFIX}/bases/b1", json={"name": "Renamed"}).json() == {"ok": True}
    assert client.delete(f"{PREFIX}/bases/b1").json() == {"ok": True}

    assert convex.call("POST", "/kb/bases")["json"] == {"name": "New"}
    assert convex.call("POST", "/kb/bases/update")["json"] == {"id": "b1", "name": "Renamed"}
    assert convex.call("POST", "/kb/bases/delete")["json"] == {"id": "b1"}


def test_file_routes_map_to_the_contract(convex, configured):
    convex.results[("GET", "/kb/files")] = {"files": [{"id": "f1", "status": "ready"}]}
    convex.results[("GET", "/kb/files/download")] = {"url": "https://bucket.example/get?sig=1"}
    convex.results[("POST", "/kb/search")] = {"chunks": [{"index": 1, "text": "hello"}]}
    client = _signed_in(configured)

    assert client.get(f"{PREFIX}/bases/b1/files").json() == {"files": [{"id": "f1", "status": "ready"}]}
    assert client.post(f"{PREFIX}/files/f1/retry").json() == {"ok": True}
    assert client.post(f"{PREFIX}/files/remove", json={"ids": ["f1", "f2"]}).json() == {"ok": True}
    assert client.get(f"{PREFIX}/files/f1/download").json() == {"url": "https://bucket.example/get?sig=1"}
    search = client.post(f"{PREFIX}/search", json={"query": " q ", "baseIds": ["b1"], "limit": 5})
    assert search.json() == {"chunks": [{"index": 1, "text": "hello"}]}

    assert convex.call("GET", "/kb/files")["params"] == {"baseId": "b1"}
    assert convex.call("POST", "/kb/files/retry")["json"] == {"fileId": "f1"}
    assert convex.call("POST", "/kb/files/delete")["json"] == {"ids": ["f1", "f2"]}
    assert convex.call("GET", "/kb/files/download")["params"] == {"fileId": "f1"}
    assert convex.call("POST", "/kb/search")["json"] == {"query": "q", "baseIds": ["b1"], "limit": 5}


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("patch", "/bases/bad%20id", {"name": "x"}),
        ("delete", "/bases/bad.id", None),
        ("get", "/bases/bad.id/files", None),
        ("post", "/files/bad.id/retry", None),
        ("get", "/files/bad.id/download", None),
        ("post", "/files/remove", {"ids": ["ok", "bad id"]}),
        ("post", "/search", {"query": "q", "baseIds": ["bad/id"]}),
    ],
)
def test_ids_are_validated_before_auth(plugin, method, path, body):
    client = _client(plugin)
    kwargs = {"json": body} if body is not None else {}

    response = getattr(client, method)(f"{PREFIX}{path}", **kwargs)

    assert response.status_code == 400
    assert response.json() == {"detail": "invalid_id"}


def test_upload_rejects_bad_base_id_before_auth(plugin):
    response = _client(plugin).post(
        f"{PREFIX}/bases/bad.id/files", files={"file": ("a.txt", b"hi", "text/plain")}
    )

    assert response.status_code == 400


def test_convex_401_becomes_428_session_invalid(convex, configured):
    convex.errors[("GET", "/kb/bases")] = (401, {"error": "bad token", "code": "unauthorized"})

    response = _signed_in(configured).get(f"{PREFIX}/bases")

    assert response.status_code == 428
    body = response.json()
    assert body["detail"] == "kb_session_invalid"
    assert body["step"] == "convex_request" and body["requestId"].startswith("hermes_")


@pytest.mark.parametrize(
    ("status", "code", "expected"),
    [(404, "not_found", 404), (400, "invalid", 400), (403, "forbidden", 422), (502, "upstream", 502)],
)
def test_other_convex_errors_pass_status_and_code(convex, configured, status, code, expected):
    convex.errors[("POST", "/kb/bases/delete")] = (status, {"error": "nope", "code": code})

    response = _signed_in(configured).delete(f"{PREFIX}/bases/b1")

    assert response.status_code == expected
    assert response.json()["detail"] == code


def test_unreachable_convex_is_a_502(configured):
    def boom(request):
        raise httpx.ConnectError("down", request=request)

    configured._transport = httpx.MockTransport(boom)

    response = _signed_in(configured).get(f"{PREFIX}/bases")

    assert response.status_code == 502
    body = response.json()
    assert body["detail"] == "upstream" and body["step"] == "convex_request"


def _target(name: str) -> dict:
    return {
        "method": "PUT",
        "url": f"https://{STORAGE_HOST}/?pathname={name}",
        "headers": {"authorization": f"Bearer client-token-{name}", "x-api-version": "11"},
    }


def _create_result(parts: int = 0) -> dict:
    return {
        "fileId": "file_1",
        "upload": _target("original"),
        "partUploads": [_target(f"part{i}") for i in range(parts)],
    }


def test_upload_creates_puts_and_completes(convex, configured):
    convex.results[("POST", "/kb/files")] = _create_result()
    data = b"# notes\nhello"

    response = _signed_in(configured).post(
        f"{PREFIX}/bases/b1/files", files={"file": ("notes.md", data, "application/octet-stream")}
    )

    assert response.status_code == 200
    assert response.json() == {"duplicate": False, "fileId": "file_1", "parts": 0}
    assert convex.paths() == ["POST /kb/files", "PUT storage", "POST /kb/files/complete"]
    assert convex.call("POST", "/kb/files")["json"] == {
        "baseId": "b1",
        "name": "notes.md",
        "contentType": "text/markdown",
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    put = convex.call("PUT", "storage")
    assert put["body"] == data
    assert put["headers"]["content-type"] == "text/markdown"
    # Only the storage headers the backend handed out go to storage, never the Unitalk session.
    assert put["headers"]["authorization"] == "Bearer client-token-original"
    assert put["headers"]["x-api-version"] == "11"
    assert "x-litellm-key" not in put["headers"]
    assert convex.call("POST", "/kb/files/complete")["json"] == {"fileId": "file_1"}


def test_upload_completes_with_the_session_pushed_during_the_upload(convex, configured):
    # Session tokens live about a minute; the desktop pushes a new one every 40s. A slow storage
    # upload must not finish (POST /kb/files/complete) with the token it started with.
    convex.results[("POST", "/kb/files")] = _create_result()
    first, second = make_token(jti="first"), make_token(jti="second")
    client = _signed_in(configured, first)
    original = convex.handler

    def rotate_during_upload(request):
        if request.url.host == STORAGE_HOST:
            configured.auth.store_session(second)
        return original(request)

    configured._transport = httpx.MockTransport(rotate_during_upload)

    response = client.post(f"{PREFIX}/bases/b1/files", files={"file": ("a.txt", b"slow", "text/plain")})

    assert response.status_code == 200
    assert convex.call("POST", "/kb/files")["headers"]["authorization"] == f"Bearer {first}"
    assert convex.call("POST", "/kb/files/complete")["headers"]["authorization"] == f"Bearer {second}"


def test_upload_duplicate_returns_existing_file(convex, configured):
    convex.errors[("POST", "/kb/files")] = (409, {"error": "exists", "code": "duplicate", "fileId": "file_old"})

    response = _signed_in(configured).post(
        f"{PREFIX}/bases/b1/files", files={"file": ("a.txt", b"same", "text/plain")}
    )

    assert response.status_code == 200
    assert response.json() == {"duplicate": True, "fileId": "file_old"}
    assert convex.paths() == ["POST /kb/files"]


def test_upload_size_limits(convex, configured, monkeypatch):
    monkeypatch.setattr(configured.file_rules, "OTHER_MAX_BYTES", 4)
    monkeypatch.setattr(configured.file_rules, "PDF_MAX_BYTES", 8)
    client = _signed_in(configured)

    too_big = client.post(f"{PREFIX}/bases/b1/files", files={"file": ("a.txt", b"12345", "text/plain")})
    assert too_big.status_code == 413
    assert too_big.json() == {"detail": "too_large"}

    convex.results[("POST", "/kb/files")] = _create_result()
    monkeypatch.setattr(configured.pdf_parts, "layout", lambda data: configured.pdf_parts.PdfLayout(None, []))
    pdf_ok = client.post(f"{PREFIX}/bases/b1/files", files={"file": ("a.pdf", b"12345", "application/pdf")})
    assert pdf_ok.status_code == 200

    empty = client.post(f"{PREFIX}/bases/b1/files", files={"file": ("a.txt", b"", "text/plain")})
    assert empty.status_code == 400


def test_upload_propagates_convex_413(convex, configured):
    convex.errors[("POST", "/kb/files")] = (413, {"error": "split", "code": "split_required"})

    response = _signed_in(configured).post(
        f"{PREFIX}/bases/b1/files", files={"file": ("a.txt", b"x", "text/plain")}
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "split_required"


def test_upload_sends_pdf_parts(convex, configured, monkeypatch):
    pdf_parts = configured.pdf_parts
    parts = [pdf_parts.PdfPart(1, 100, b"part-a"), pdf_parts.PdfPart(101, 150, b"part-b")]
    monkeypatch.setattr(pdf_parts, "layout", lambda data: pdf_parts.PdfLayout(150, parts))
    convex.results[("POST", "/kb/files")] = _create_result(parts=2)

    response = _signed_in(configured).post(
        f"{PREFIX}/bases/b1/files", files={"file": ("big.pdf", b"%PDF-original", "application/pdf")}
    )

    assert response.json() == {"duplicate": False, "fileId": "file_1", "parts": 2}
    created = convex.call("POST", "/kb/files")["json"]
    assert created["pageCount"] == 150
    assert created["parts"] == [{"fromPage": 1, "toPage": 100}, {"fromPage": 101, "toPage": 150}]
    puts = [call for call in convex.calls if call["path"] == "storage"]
    assert [call["url"] for call in puts] == [
        f"https://{STORAGE_HOST}/?pathname=original",
        f"https://{STORAGE_HOST}/?pathname=part0",
        f"https://{STORAGE_HOST}/?pathname=part1",
    ]
    assert [call["body"] for call in puts] == [b"%PDF-original", b"part-a", b"part-b"]
    assert all(call["headers"]["content-type"] == "application/pdf" for call in puts)
    assert [call["headers"]["authorization"] for call in puts] == [
        "Bearer client-token-original",
        "Bearer client-token-part0",
        "Bearer client-token-part1",
    ]
    assert convex.paths()[-1] == "POST /kb/files/complete"


def test_failed_storage_upload_discards_the_file(convex, configured):
    convex.results[("POST", "/kb/files")] = _create_result()
    convex.storage_status = 403

    response = _signed_in(configured).post(
        f"{PREFIX}/bases/b1/files", files={"file": ("a.txt", b"x", "text/plain")}
    )

    assert response.status_code == 502
    assert response.json() == {"detail": "upload_failed", "step": "blob_upload"}
    assert convex.paths() == ["POST /kb/files", "PUT storage", "POST /kb/files/delete"]
    assert convex.call("POST", "/kb/files/delete")["json"] == {"ids": ["file_1"]}


def test_failed_complete_discards_the_file(convex, configured):
    convex.results[("POST", "/kb/files")] = _create_result()
    convex.errors[("POST", "/kb/files/complete")] = (400, {"error": "incomplete", "code": "invalid"})

    response = _signed_in(configured).post(
        f"{PREFIX}/bases/b1/files", files={"file": ("a.txt", b"x", "text/plain")}
    )

    assert response.status_code == 400
    assert convex.paths() == ["POST /kb/files", "PUT storage", "POST /kb/files/complete", "POST /kb/files/delete"]


def test_part_ranges_cover_consecutive_hundred_page_parts(plugin):
    assert plugin.pdf_parts.part_ranges(100) == []
    assert plugin.pdf_parts.part_ranges(101) == [(1, 100), (101, 101)]
    assert plugin.pdf_parts.part_ranges(250) == [(1, 100), (101, 200), (201, 250)]


def test_pdf_layout_splits_real_pdf_when_pypdf_is_available(plugin):
    pypdf = pytest.importorskip("pypdf")
    writer = pypdf.PdfWriter()
    for _ in range(205):
        writer.add_blank_page(width=72, height=72)
    buffer = io.BytesIO()
    writer.write(buffer)

    layout = plugin.pdf_parts.layout(buffer.getvalue())

    assert layout.page_count == 205
    assert [(part.from_page, part.to_page) for part in layout.parts] == [(1, 100), (101, 200), (201, 205)]
    assert [len(pypdf.PdfReader(io.BytesIO(part.data)).pages) for part in layout.parts] == [100, 100, 5]


def test_pdf_layout_without_pypdf_sends_no_parts(plugin, monkeypatch):
    monkeypatch.setattr(plugin.pdf_parts, "_pypdf", lambda: None)

    assert plugin.pdf_parts.layout(b"%PDF") == plugin.pdf_parts.PdfLayout(None, [])
