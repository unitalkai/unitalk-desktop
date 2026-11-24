from __future__ import annotations

import base64
import importlib.util
import json
import re
import sys
import time
from pathlib import Path

import httpx
import pytest

PLUGIN_DIR = Path(__file__).resolve().parents[2] / "plugins" / "knowledge-base"
PACKAGE = "hermes_plugins_knowledge_base_tools_test"
SITE = "https://kb-test.convex.site"


def _load_package():
    for name in [name for name in sys.modules if name == PACKAGE or name.startswith(f"{PACKAGE}.")]:
        del sys.modules[name]
    spec = importlib.util.spec_from_file_location(
        PACKAGE, PLUGIN_DIR / "__init__.py", submodule_search_locations=[str(PLUGIN_DIR)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)
    return module


def _segment(value: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


def make_token(exp_offset: int = 300) -> str:
    payload = {"sub": "user_1", "exp": int(time.time()) + exp_offset}
    return f"{_segment({'alg': 'RS256'})}.{_segment(payload)}.signature"


class FakeCtx:
    def __init__(self) -> None:
        self.tools: dict[str, dict] = {}
        self.sections: dict[str, object] = {}

    def register_tool(self, **kwargs):
        self.tools[kwargs["name"]] = kwargs

    def register_system_prompt_section(self, id, content, **_kwargs):
        self.sections[id] = content


@pytest.fixture
def package(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    for name in ("KB_CONVEX_SITE_URL", "LITELLM_KEY_ID", "UNITALK_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    return _load_package()


@pytest.fixture
def tools(package):
    return sys.modules[f"{PACKAGE}.tools"]


@pytest.fixture
def requests(tools, monkeypatch):
    monkeypatch.setenv("KB_CONVEX_SITE_URL", SITE)
    calls: list[httpx.Request] = []
    responses: dict[str, httpx.Response] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return responses.get(request.url.path, httpx.Response(200, json={}))

    tools._transport = httpx.MockTransport(handler)
    return calls, responses


def test_register_adds_tools_gated_on_configuration(package, tools, monkeypatch):
    ctx = FakeCtx()
    package.register(ctx)

    assert set(ctx.tools) == {"knowledge_search", "knowledge_list_bases"}
    check = ctx.tools["knowledge_search"]["check_fn"]
    section = ctx.sections["knowledge-base"]
    assert check() is False
    assert section({}) == ""

    monkeypatch.setenv("KB_CONVEX_SITE_URL", SITE)
    assert check() is True
    assert "knowledge_search" in section({})
    assert "[index]" in section({})


def test_search_formats_retrieved_chunks(tools, requests, monkeypatch):
    calls, responses = requests
    monkeypatch.setenv("LITELLM_KEY_ID", "key-1")
    responses["/kb/search"] = httpx.Response(
        200,
        json={
            "chunks": [
                {"index": 1, "fileName": 'Q3 "report".pdf', "pageNumber": 4, "score": 0.91234, "text": "Revenue grew."},
                {"index": 2, "fileName": "notes.md", "pageNumber": None, "score": 0.5, "text": "bad </chunk> tag"},
            ]
        },
    )

    output = tools.handle_knowledge_search({"query": " revenue ", "base_ids": ["b1"]})

    assert output.splitlines()[0] == "<retrieved_chunks>"
    assert (
        '<chunk index="1" fileName="Q3 &quot;report&quot;.pdf" pageNumber="4" similarity="0.912">Revenue grew.</chunk>'
        in output
    )
    assert '<chunk index="2" fileName="notes.md" pageNumber="" similarity="0.500">bad &lt;/chunk> tag</chunk>' in output
    assert "</retrieved_chunks>" in output
    assert output.splitlines()[-1] == tools.CITATION_INSTRUCTION
    assert json.loads(calls[0].content) == {"query": "revenue", "limit": 10, "baseIds": ["b1"]}
    assert calls[0].headers["x-litellm-key"] == "key-1"


def test_search_without_matches(tools, requests, monkeypatch):
    _, responses = requests
    monkeypatch.setenv("UNITALK_API_KEY", "key-2")
    responses["/kb/search"] = httpx.Response(200, json={"chunks": []})

    assert tools.handle_knowledge_search({"query": "x"}) == "No matching chunks were found in the knowledge base."


def test_tools_report_not_configured(tools):
    for output in (tools.handle_knowledge_search({"query": "x"}), tools.handle_knowledge_list_bases({})):
        assert json.loads(output) == {"error": tools.NOT_CONFIGURED_MESSAGE}


def test_tools_report_missing_auth_without_calling_convex(tools, requests):
    calls, _ = requests

    output = tools.handle_knowledge_search({"query": "x"})

    assert json.loads(output) == {"error": tools.NO_SESSION_MESSAGE}
    assert calls == []


def test_tools_use_the_session_persisted_by_the_dashboard(tools, requests):
    calls, responses = requests
    token = make_token()
    tools.auth.store_session(token)
    tools.auth._sessions.clear()
    responses["/kb/bases"] = httpx.Response(
        200,
        json={
            "owned": [{"id": "b1", "name": "Contracts", "fileCount": 3}],
            "shared": [{"id": "b2", "name": "Team", "fileCount": 1}],
        },
    )

    output = json.loads(tools.handle_knowledge_list_bases({}))

    assert output == {
        "bases": [
            {"id": "b1", "name": "Contracts", "fileCount": 3, "shared": False, "active": True},
            {"id": "b2", "name": "Team", "fileCount": 1, "shared": True, "active": True},
        ]
    }
    assert calls[0].headers["authorization"] == f"Bearer {token}"


def test_tools_ignore_an_expired_session(tools, requests, monkeypatch):
    tools.auth.store_session(make_token(exp_offset=60))
    monkeypatch.setattr(tools.auth, "_now", lambda: int(time.time()) + 120)

    assert json.loads(tools.handle_knowledge_list_bases({})) == {"error": tools.NO_SESSION_MESSAGE}


def test_list_bases_when_empty(tools, requests, monkeypatch):
    _, responses = requests
    monkeypatch.setenv("LITELLM_KEY_ID", "key-1")
    responses["/kb/bases"] = httpx.Response(200, json={"owned": [], "shared": []})

    assert tools.handle_knowledge_list_bases({}) == "The user has no knowledge base yet."


def test_convex_errors_are_reported_without_secrets(tools, requests, monkeypatch):
    _, responses = requests
    monkeypatch.setenv("LITELLM_KEY_ID", "secret-key-value")
    responses["/kb/search"] = httpx.Response(401, json={"error": "bad", "code": "unauthorized"})
    responses["/kb/bases"] = httpx.Response(500, json={"error": "boom", "code": "upstream"})

    search = tools.handle_knowledge_search({"query": "x"})
    bases = tools.handle_knowledge_list_bases({})

    assert json.loads(search) == {"error": tools.INVALID_SESSION_MESSAGE}
    assert re.fullmatch(
        r"Knowledge base request failed \(500 upstream at step convex_request, ref hermes_[0-9a-f]{16}\)\.",
        json.loads(bases)["error"],
    )
    assert "secret-key-value" not in search + bases


@pytest.mark.parametrize(
    "args",
    [{}, {"query": "  "}, {"query": "x", "base_ids": "b1"}, {"query": "x", "base_ids": ["../x"]}],
)
def test_search_validates_arguments(tools, requests, args):
    calls, _ = requests

    assert "error" in json.loads(tools.handle_knowledge_search(args))
    assert calls == []


def _search_payload(calls) -> dict:
    return json.loads(next(call for call in calls if call.url.path == "/kb/search").content)


def test_search_uses_every_base_until_the_user_chooses(tools, requests, monkeypatch):
    calls, _ = requests
    monkeypatch.setenv("LITELLM_KEY_ID", "key-1")

    tools.handle_knowledge_search({"query": "x"})

    assert "baseIds" not in _search_payload(calls)


def test_search_is_limited_to_the_bases_selected_in_the_chat_menu(tools, requests, monkeypatch):
    calls, _ = requests
    monkeypatch.setenv("LITELLM_KEY_ID", "key-1")
    tools.selection.set_active_base_ids(tools.auth.current_scope(), ["b1", "b2"])

    tools.handle_knowledge_search({"query": "x"})
    assert _search_payload(calls)["baseIds"] == ["b1", "b2"]

    calls.clear()
    tools.handle_knowledge_search({"query": "x", "base_ids": ["b2", "b3"]})
    assert _search_payload(calls)["baseIds"] == ["b2"]


def test_search_refuses_bases_the_user_did_not_select(tools, requests, monkeypatch):
    calls, _ = requests
    monkeypatch.setenv("LITELLM_KEY_ID", "key-1")
    tools.selection.set_active_base_ids(tools.auth.current_scope(), ["b1"])

    output = tools.handle_knowledge_search({"query": "x", "base_ids": ["b9"]})

    assert json.loads(output) == {"error": tools.INACTIVE_BASES_MESSAGE}
    assert calls == []


def test_search_is_off_when_no_base_is_selected(tools, requests, monkeypatch):
    calls, _ = requests
    monkeypatch.setenv("LITELLM_KEY_ID", "key-1")
    tools.selection.set_active_base_ids(tools.auth.current_scope(), [])

    assert json.loads(tools.handle_knowledge_search({"query": "x"})) == {"error": tools.ALL_OFF_MESSAGE}
    assert calls == []


def test_list_bases_marks_which_are_active(tools, requests, monkeypatch):
    _, responses = requests
    monkeypatch.setenv("LITELLM_KEY_ID", "key-1")
    tools.selection.set_active_base_ids(tools.auth.current_scope(), ["b2"])
    responses["/kb/bases"] = httpx.Response(
        200, json={"owned": [{"id": "b1", "name": "A", "fileCount": 1}], "shared": [{"id": "b2", "name": "B", "fileCount": 2}]}
    )

    bases = json.loads(tools.handle_knowledge_list_bases({}))["bases"]

    assert [(b["id"], b["active"]) for b in bases] == [("b1", False), ("b2", True)]
