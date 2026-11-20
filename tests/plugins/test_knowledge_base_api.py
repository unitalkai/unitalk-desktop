from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PLUGIN_FILE = (
    Path(__file__).resolve().parents[2]
    / "plugins"
    / "knowledge-base"
    / "dashboard"
    / "plugin_api.py"
)
PREFIX = "/api/plugins/knowledge-base"


def _load_plugin():
    spec = importlib.util.spec_from_file_location("hermes_knowledge_base_api_test", PLUGIN_FILE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def plugin():
    return _load_plugin()


def _client(plugin) -> TestClient:
    app = FastAPI()
    app.include_router(plugin.router, prefix=PREFIX)
    return TestClient(app)


def test_config_reports_unconfigured_without_qdrant_url(plugin, monkeypatch):
    monkeypatch.setattr(plugin, "get_env_value_prefer_dotenv", lambda name: None)

    response = _client(plugin).get(f"{PREFIX}/config")

    assert response.status_code == 200
    assert response.json() == {"configured": False}


def test_config_reports_configured_with_qdrant_url(plugin, monkeypatch):
    values = {"QDRANT_URL": "https://qdrant.example", "QDRANT_API_KEY": "secret"}
    monkeypatch.setattr(plugin, "get_env_value_prefer_dotenv", values.get)

    response = _client(plugin).get(f"{PREFIX}/config")

    assert response.json() == {"configured": True}
    assert "secret" not in response.text


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/bases"),
        ("post", "/bases"),
        ("delete", "/bases/kb1"),
        ("get", "/bases/kb1/files"),
        ("post", "/bases/kb1/files"),
        ("delete", "/bases/kb1/files/f1"),
        ("post", "/bases/kb1/search"),
    ],
)
def test_unbuilt_routes_answer_not_implemented(plugin, method, path):
    response = getattr(_client(plugin), method)(f"{PREFIX}{path}")

    assert response.status_code == 501
