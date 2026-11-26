"""Tests for the bundled Unitalk video_gen plugin (videos through the Unitalk LiteLLM gateway).

Invariants only — the family catalog is data that changes as the gateway changes, so tests pick
families by their declared shape (start-frame field, duration units) rather than pinning ids.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import hermes_yaml as yaml

import agent.video_gen_provider as video_base
import plugins.video_gen.unitalk as unitalk_plugin

REPO_ROOT = Path(__file__).resolve().parents[3]
IMAGE = "https://example.com/start.png"


@pytest.fixture(autouse=True)
def _isolation(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("UNITALK_API_KEY", "sk-test")
    monkeypatch.setattr(unitalk_plugin, "_listing_cache", {})
    monkeypatch.setattr(unitalk_plugin.UnitalkVideoGenProvider, "_poll_interval_s", 0)
    yield tmp_path


def _select(home: Path, model: str) -> None:
    (home / "config.yaml").write_text(
        yaml.safe_dump({"video_gen": {"provider": "unitalk", "model": model}}), encoding="utf-8")


def _family_where(predicate) -> str:
    return next(fid for fid, meta in unitalk_plugin.FAMILIES.items() if predicate(meta))


def _generate(monkeypatch, **kwargs) -> tuple[dict, dict]:
    """Run generate against a fake gateway that, like the real one, answers status polls with a
    re-encoded id that cannot itself be polled."""
    captured: dict = {"polled": []}

    class _Videos:
        def create(self, **create_kwargs):
            captured["create"] = create_kwargs
            return SimpleNamespace(id="video_original", status="queued", error=None, data=None)

        def retrieve(self, video_id):
            captured["polled"].append(video_id)
            if video_id != "video_original":
                raise RuntimeError("FAL_AI_API_KEY is not set")
            done = len(captured["polled"]) > 1
            return SimpleNamespace(id="video_reencoded", status="completed" if done else "in_progress",
                                   error=None, data=None)

        def download_content(self, video_id):
            captured["downloaded"] = video_id
            return SimpleNamespace(read=lambda: b"\x00\x00mp4")

    class _Client:
        def __init__(self, api_key=None, base_url=None, http_client=None):
            captured["api_key"], captured["base_url"] = api_key, base_url
            self.videos = _Videos()

    fake_openai = MagicMock()
    fake_openai.OpenAI = _Client
    monkeypatch.setattr(video_base, "save_bytes_video", lambda raw, prefix="video", **_: Path(f"/tmp/{prefix}.mp4"))
    with patch.dict("sys.modules", {"openai": fake_openai}):
        result = unitalk_plugin.UnitalkVideoGenProvider().generate(prompt="a paper boat on a stream", **kwargs)
    return result, captured


def test_bundled_backend_is_discovered_as_unitalk() -> None:
    from hermes_cli.plugins import _ensure_plugins_discovered
    from agent.video_gen_registry import get_provider

    _ensure_plugins_discovered(force=True)
    provider = get_provider("unitalk")

    assert provider is not None
    assert provider.display_name == "Unitalk"


def test_availability_follows_the_unitalk_key(monkeypatch) -> None:
    provider = unitalk_plugin.UnitalkVideoGenProvider()
    assert provider.is_available()

    monkeypatch.delenv("UNITALK_API_KEY")
    assert not provider.is_available()


def test_polling_and_download_use_the_id_create_returned(_isolation, monkeypatch) -> None:
    result, captured = _generate(monkeypatch)

    assert result["success"], result
    assert set(captured["polled"]) == {"video_original"}
    assert captured["downloaded"] == "video_original"
    assert captured["base_url"] == unitalk_plugin.GATEWAY_BASE_URL
    assert captured["api_key"] == "sk-test"


@pytest.mark.parametrize("family_id", list(unitalk_plugin.FAMILIES))
def test_an_image_routes_to_the_familys_image_endpoint_under_its_start_frame_field(
        _isolation, monkeypatch, family_id) -> None:
    _select(_isolation, family_id)
    family = unitalk_plugin.FAMILIES[family_id]

    text_result, text_call = _generate(monkeypatch, model=family_id)
    image_result, image_call = _generate(monkeypatch, model=family_id, image_url=IMAGE)

    assert text_call["create"]["model"] == family["text_endpoint"]
    assert IMAGE not in (text_call["create"].get("extra_body") or {}).values()
    assert image_call["create"]["model"] == family["image_endpoint"]
    extra = image_call["create"]["extra_body"]
    assert extra[family["image_key"]] == IMAGE
    assert set(extra) & {"image_url", "start_image_url"} == {family["image_key"]}
    assert (text_result["modality"], image_result["modality"]) == ("text", "image")


def test_an_uploaded_local_image_reaches_the_gateway_inline(_isolation, monkeypatch) -> None:
    """Under a local terminal backend the tool passes an uploaded image's path; the gateway can't read it."""
    upload = _isolation / "upload.png"
    upload.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    family_id = _family_where(lambda m: m["image_key"] != "image_url")

    result, call = _generate(monkeypatch, model=family_id, image_url=str(upload))

    assert result["success"], result
    sent = call["create"]["extra_body"][unitalk_plugin.FAMILIES[family_id]["image_key"]]
    assert sent.startswith("data:image/png;base64,")
    assert str(upload) not in str(call["create"])


def test_requests_fit_the_endpoint_schema(_isolation, monkeypatch) -> None:
    suffixed = _family_where(lambda m: m["duration_suffix"])
    _, call = _generate(monkeypatch, model=suffixed, duration=5, resolution="4k", aspect_ratio="16:9")
    family = unitalk_plugin.FAMILIES[suffixed]
    snapped = call["create"]["seconds"]
    assert int(snapped) in family["duration_enum"]
    assert call["create"]["extra_body"]["duration"] == f"{snapped}{family['duration_suffix']}"
    assert call["create"]["size"] in family["resolutions"]

    follows_image = _family_where(lambda m: not m["image_keeps_aspect"])
    _, call = _generate(monkeypatch, model=follows_image, image_url=IMAGE, aspect_ratio="16:9")
    assert "aspect_ratio" not in call["create"]["extra_body"]


def test_a_duration_is_always_requested_because_the_gateway_bills_the_request(_isolation, monkeypatch) -> None:
    for family_id in unitalk_plugin.FAMILIES:
        _, call = _generate(monkeypatch, model=family_id)
        assert int(call["create"]["seconds"]) > 0


def test_another_backends_model_in_the_shared_key_falls_back_to_the_default(_isolation, monkeypatch) -> None:
    _select(_isolation, "pixverse-v6")

    _, call = _generate(monkeypatch, model="pixverse-v6")

    assert call["create"]["model"] == unitalk_plugin.FAMILIES[unitalk_plugin.DEFAULT_MODEL]["text_endpoint"]


def test_picker_hides_families_the_gateway_no_longer_lists(monkeypatch) -> None:
    kept = next(iter(unitalk_plugin.FAMILIES.values()))
    listed = frozenset({kept["text_endpoint"], kept["image_endpoint"], "unrelated/chat"})
    monkeypatch.setattr(unitalk_plugin, "_gateway_model_ids", lambda key: listed)

    rows = unitalk_plugin.UnitalkVideoGenProvider().list_models()

    assert [row["id"] for row in rows] == [next(iter(unitalk_plugin.FAMILIES))]
    assert rows[0]["modalities"] == ["text", "image"]


def test_picker_keeps_every_family_when_the_listing_is_unreachable(monkeypatch) -> None:
    monkeypatch.setattr(unitalk_plugin, "_gateway_model_ids", lambda key: None)
    provider = unitalk_plugin.UnitalkVideoGenProvider()

    ids = {row["id"] for row in provider.list_models()}

    assert ids == set(unitalk_plugin.FAMILIES)
    assert provider.default_model() in ids


def test_template_default_model_is_offered_by_the_backend_it_selects() -> None:
    template = yaml.safe_load((REPO_ROOT / "cli-config.yaml.example").read_text(encoding="utf-8"))

    assert template["video_gen"]["provider"] == unitalk_plugin.UnitalkVideoGenProvider().name
    assert template["video_gen"]["model"] in unitalk_plugin.FAMILIES
