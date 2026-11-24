"""Unitalk image generation: image models served by the Unitalk LiteLLM gateway.

The gateway (``/v1/images/generations``, OpenAI-compatible) proxies FAL and other image backends
and bills the customer's own ``UNITALK_API_KEY``; Unitalk's FAL credential stays on the gateway.

The catalog is the set of gateway models verified to generate end to end, filtered by the
gateway's live ``/v1/models`` so a model the gateway drops leaves the picker. The gateway lists
more image models than it can serve, so its listing alone is never the catalog.
Selection: ``image_gen.unitalk.model`` → ``image_gen.model`` (the picker writes this) → default.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any, Optional

from agent.secret_scope import get_secret
from agent.image_gen_provider import DEFAULT_ASPECT_RATIO, resolve_aspect_ratio, success_response
from plugins.image_gen._common import (
    StaticImageGenProvider, catalog_rows, error_factory, import_openai, load_image_gen_config,
    materialize_image, openai_importable, prompt_required_error, record_token_usage, size_for)

logger = logging.getLogger(__name__)

GATEWAY_BASE_URL = "https://llmgateway.unitalk.ai/v1"
KEY_ENV = "UNITALK_API_KEY"
DEFAULT_MODEL = "fal_ai/fal-ai/nano-banana-pro"

MODELS: dict[str, dict[str, Any]] = {
    "fal_ai/fal-ai/nano-banana-pro": {
        "display": "Nano Banana Pro", "speed": "~18s", "strengths": "Default — reasoning depth, text rendering"},
    "google/nano-banana-2.1": {
        "display": "Nano Banana 2.1", "speed": "~17s", "strengths": "Fast general-purpose images"},
    "fal_ai/openai/gpt-image-2.6/flare/text-to-image": {
        "display": "GPT Image 2.6 Flare", "speed": "~16s", "strengths": "Everyday generation, prompt adherence"},
    "fal_ai/openai/gpt-image-2.6/sunburst/text-to-image": {
        "display": "GPT Image 2.6 Sunburst", "speed": "~34s", "strengths": "Precision generation, fine detail"},
    "fal_ai/fal-ai/bytedance/seedream/v4.5/text-to-image": {
        "display": "Seedream 4.5", "speed": "~10s", "strengths": "Photorealism, fast"},
    "ideogram/v4.5": {
        "display": "Ideogram 4.5", "speed": "~14s", "strengths": "Typography and text in images"},
}

_LISTING_TTL_S = 600
_listing_cache: dict[str, tuple[float, Optional[frozenset[str]]]] = {}


def _api_key() -> str:
    return (get_secret(KEY_ENV, "") or "").strip()


def _gateway_model_ids(api_key: str) -> Optional[frozenset[str]]:
    """Model ids the gateway lists for this key, cached per key; None when the listing is unreachable."""
    cached = _listing_cache.get(api_key)
    if cached and time.monotonic() - cached[0] < _LISTING_TTL_S:
        return cached[1]
    import requests

    try:
        response = requests.get(
            f"{GATEWAY_BASE_URL}/models", headers={"Authorization": f"Bearer {api_key}"}, timeout=8)
        response.raise_for_status()
        ids: Optional[frozenset[str]] = frozenset(
            str(row.get("id")) for row in response.json().get("data", []) if isinstance(row, dict))
    except Exception as exc:
        logger.debug("Unitalk gateway model listing failed: %s", exc)
        ids = None
    _listing_cache[api_key] = (time.monotonic(), ids)
    return ids


def _file_label(model_id: str) -> str:
    """Cache-file label: the display name when known (gateway ids often end in ``text-to-image``)."""
    name = MODELS.get(model_id, {}).get("display") or model_id.rsplit("/", 1)[-1]
    return re.sub(r"[^a-z0-9.]+", "-", name.lower()).strip("-") or "image"


def _resolve_model() -> str:
    """``image_gen.unitalk.model`` (any gateway id, sent verbatim) → ``image_gen.model`` when it is one
    of ours (the picker writes this shared key; it may hold another backend's id) → default."""
    cfg = load_image_gen_config()
    scoped = cfg.get("unitalk")
    pinned = scoped.get("model") if isinstance(scoped, dict) else None
    if isinstance(pinned, str) and pinned.strip():
        return pinned.strip()
    picked = cfg.get("model")
    return picked if isinstance(picked, str) and picked in MODELS else DEFAULT_MODEL


class UnitalkImageGenProvider(StaticImageGenProvider):
    """Unitalk gateway ``images.generate`` backend (text-to-image)."""

    provider_id = "unitalk"
    label = "Unitalk"
    models = MODELS
    default_model_id = DEFAULT_MODEL
    catalog_fields = ("display", "speed", "strengths")
    setup = dict(
        name="Unitalk", badge="paid",
        tag="Nano Banana, GPT Image, Seedream, Ideogram — billed to your Unitalk credits",
        key=KEY_ENV, prompt="Unitalk API key", url="https://unitalk.ai")

    def is_available(self) -> bool:
        return bool(_api_key()) and openai_importable()

    def list_models(self) -> list[dict[str, Any]]:
        listed = _gateway_model_ids(_api_key()) if _api_key() else None
        if listed is None:
            return catalog_rows(MODELS, self.catalog_fields)
        return catalog_rows({mid: meta for mid, meta in MODELS.items() if mid in listed}, self.catalog_fields)

    def capabilities(self) -> dict[str, Any]:
        """The gateway serves editing under separate model ids; this backend is text-to-image."""
        return {"modalities": ["text"], "max_reference_images": 0}

    def generate(self, prompt: str, aspect_ratio: str = DEFAULT_ASPECT_RATIO, **kwargs: Any) -> dict[str, Any]:
        prompt = (prompt or "").strip()
        aspect = resolve_aspect_ratio(aspect_ratio)
        fail = error_factory("unitalk", aspect)
        if kwargs.get("image_url") or kwargs.get("reference_image_urls"):
            return fail(
                "Unitalk image generation is text-to-image only; image_url and "
                "reference_image_urls are unsupported.", "modality_unsupported", prompt=prompt)
        if not prompt:
            return prompt_required_error("unitalk", aspect)
        api_key = _api_key()
        if not api_key:
            return fail(f"{KEY_ENV} not set. Sign in to Unitalk or add {KEY_ENV} to .env.", "auth_required")

        openai, err = import_openai("unitalk", aspect)
        if err:
            return err
        model_id = _resolve_model()
        size = size_for(aspect)
        fail = error_factory("unitalk", aspect, model=model_id, prompt=prompt)
        client = openai.OpenAI(api_key=api_key, base_url=GATEWAY_BASE_URL)
        try:
            response = client.images.generate(model=model_id, prompt=prompt, size=size, n=1)
        except Exception as exc:
            logger.debug("Unitalk image generation failed", exc_info=True)
            return fail(f"Unitalk image generation failed: {exc}", "api_error")
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()

        record_token_usage(
            getattr(response, "usage", None), model=model_id, provider="unitalk", base_url=GATEWAY_BASE_URL)
        data = getattr(response, "data", None) or []
        if not data:
            return fail("Unitalk gateway returned no image data", "empty_response")
        first = data[0]
        image_ref, err = materialize_image(
            getattr(first, "b64_json", None), getattr(first, "url", None),
            prefix=f"unitalk_{_file_label(model_id)}", label="Unitalk",
            provider="unitalk", model=model_id, prompt=prompt, aspect=aspect, log=logger)
        if err:
            return err
        return success_response(
            image=image_ref, model=model_id, prompt=prompt, aspect_ratio=aspect, provider="unitalk",
            extra={"size": size})


def register(ctx) -> None:
    """Plugin entry point — wire ``UnitalkImageGenProvider`` into the registry."""
    ctx.register_image_gen_provider(UnitalkImageGenProvider())
