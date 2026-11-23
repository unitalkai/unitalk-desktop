"""Tests for the bundled Unitalk image_gen plugin (images through the Unitalk LiteLLM gateway).

Invariants only — the verified model list is data that changes as the gateway changes, so no
test pins a specific model id beyond the relationships between catalog, picker and template.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import hermes_yaml as yaml

import plugins.image_gen.unitalk as unitalk_plugin

REPO_ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(autouse=True)
def _isolation(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("UNITALK_API_KEY", "sk-test")
    monkeypatch.setattr(unitalk_plugin, "_listing_cache", {})
    yield tmp_path


def _write_image_gen(home: Path, section: dict) -> None:
    (home / "config.yaml").write_text(yaml.safe_dump({"image_gen": section}), encoding="utf-8")


def _generate_capturing(monkeypatch, **generate_kwargs) -> tuple[dict, dict]:
    captured: dict = {}

    class _FakeImages:
        def generate(self, **kwargs):
            captured["request"] = kwargs
            return SimpleNamespace(data=[SimpleNamespace(b64_json=None, url="https://v3b.fal.media/x.png")],
                                   usage=None)

    class _FakeClient:
        def __init__(self, api_key=None, base_url=None):
            captured["api_key"], captured["base_url"] = api_key, base_url
            self.images = _FakeImages()

    fake_openai = MagicMock()
    fake_openai.OpenAI = _FakeClient
    monkeypatch.setattr(unitalk_plugin, "materialize_image", lambda b64, url, **kw: (url, None))
    with patch.dict("sys.modules", {"openai": fake_openai}):
        result = unitalk_plugin.UnitalkImageGenProvider().generate(prompt="a red bicycle", **generate_kwargs)
    return result, captured


def test_bundled_backend_is_discovered_as_unitalk() -> None:
    from tools.image_generation_tool import _get_plugin_provider

    provider = _get_plugin_provider("unitalk", force=True)

    assert provider is not None
    assert provider.display_name == "Unitalk"


def test_availability_follows_the_unitalk_key(monkeypatch) -> None:
    provider = unitalk_plugin.UnitalkImageGenProvider()
    assert provider.is_available()

    monkeypatch.delenv("UNITALK_API_KEY")
    assert not provider.is_available()


def test_picker_hides_models_the_gateway_no_longer_lists(monkeypatch) -> None:
    verified = list(unitalk_plugin.MODELS)
    kept = set(verified[: len(verified) // 2] or verified[:1])
    monkeypatch.setattr(unitalk_plugin, "_gateway_model_ids", lambda key: frozenset(kept | {"unrelated/chat"}))

    ids = {row["id"] for row in unitalk_plugin.UnitalkImageGenProvider().list_models()}

    assert ids == kept


def test_picker_keeps_the_verified_catalog_when_the_listing_is_unreachable(monkeypatch) -> None:
    monkeypatch.setattr(unitalk_plugin, "_gateway_model_ids", lambda key: None)
    provider = unitalk_plugin.UnitalkImageGenProvider()

    rows = provider.list_models()

    assert {row["id"] for row in rows} == set(unitalk_plugin.MODELS)
    assert provider.default_model() in {row["id"] for row in rows}
    assert all(row["display"] for row in rows)


def test_generate_sends_the_picked_model_to_the_gateway_with_the_unitalk_key(_isolation, monkeypatch) -> None:
    picked = next(mid for mid in unitalk_plugin.MODELS if mid != unitalk_plugin.DEFAULT_MODEL)
    _write_image_gen(_isolation, {"provider": "unitalk", "model": picked})

    result, captured = _generate_capturing(monkeypatch, aspect_ratio="square")

    assert result["success"], result
    assert captured["base_url"] == unitalk_plugin.GATEWAY_BASE_URL
    assert captured["api_key"] == "sk-test"
    assert captured["request"]["model"] == picked
    assert result["provider"] == "unitalk"


def test_another_backends_model_in_the_shared_key_falls_back_to_the_default(_isolation, monkeypatch) -> None:
    _write_image_gen(_isolation, {"provider": "unitalk", "model": "fal-ai/flux-2/klein/9b"})

    _, captured = _generate_capturing(monkeypatch)

    assert captured["request"]["model"] == unitalk_plugin.DEFAULT_MODEL


def test_image_editing_is_refused_without_calling_the_gateway(monkeypatch) -> None:
    result, captured = _generate_capturing(monkeypatch, image_url="https://example.com/a.png")

    assert not result["success"]
    assert result["error_type"] == "modality_unsupported"
    assert "request" not in captured


def test_template_default_model_is_offered_by_the_backend_it_selects() -> None:
    template = yaml.safe_load((REPO_ROOT / "cli-config.yaml.example").read_text(encoding="utf-8"))

    assert template["image_gen"]["provider"] == unitalk_plugin.UnitalkImageGenProvider().name
    assert template["image_gen"]["model"] in unitalk_plugin.MODELS
