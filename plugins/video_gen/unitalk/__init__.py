"""Unitalk video generation: video models served by the Unitalk LiteLLM gateway.

The gateway's OpenAI-compatible ``/v1/videos`` (create → poll → ``/content``) proxies FAL and bills
the customer's own ``UNITALK_API_KEY``; Unitalk's FAL credential stays on the gateway, so the SDK
plumbing is :class:`agent.video_gen_provider.OpenAICompatibleVideoGenProvider`.

The user picks a model FAMILY once; ``image_url`` routes to its image-to-video endpoint, otherwise
text-to-video. LiteLLM maps ``seconds`` → fal ``duration`` and ``size`` → ``resolution``, and passes
``extra_body`` through to fal verbatim, so each family's endpoint-specific keys ride there.
Selection: ``video_gen.unitalk.model`` → ``video_gen.model`` (the picker writes this) → default.
"""

from __future__ import annotations

import base64
import logging
import mimetypes
import time
from pathlib import Path
from typing import Any, Optional

from agent.video_gen_provider import OpenAICompatibleVideoGenProvider

logger = logging.getLogger(__name__)

GATEWAY_BASE_URL = "https://llmgateway.unitalk.ai/v1"
KEY_ENV = "UNITALK_API_KEY"
DEFAULT_MODEL = "wan-3.0"

_SIX_ASPECTS = ("21:9", "16:9", "4:3", "1:1", "3:4", "9:16")


def _family(display: str, strengths: str, text: str, image: str, **spec: Any) -> dict[str, Any]:
    """One picker entry. ``durations`` is a ``(min, max)`` clamp; ``duration_enum`` snaps instead and
    ``duration_suffix`` is the unit the endpoint's enum carries ("4s"). ``image_key`` is the endpoint's
    start-frame field; ``image_resolutions`` narrows resolutions on image-to-video and
    ``image_keeps_aspect`` False drops aspect_ratio there (the endpoint follows the image)."""
    return {"display": display, "strengths": strengths, "text_endpoint": text, "image_endpoint": image,
            "image_key": "image_url", "image_resolutions": None, "image_keeps_aspect": True,
            "duration_enum": None, "duration_suffix": "", "negative": False, "seed": False, **spec}


# Limits are the endpoints' published fal schemas. Resolutions stop where the gateway has a price.
# ``default_duration`` is always sent: the gateway bills the requested duration, not the rendered one.
_VEO = dict(aspect_ratios=("16:9", "9:16"), resolutions=("720p", "1080p"), durations=(4, 8),
            duration_enum=(4, 6, 8), duration_suffix="s", default_duration=8, seed=True)
FAMILIES: dict[str, dict[str, Any]] = {
    "veo-3.1": _family(
        "Veo 3.1", "Google DeepMind. Cinematic, native audio, strong prompt adherence.",
        "fal-ai/veo3.1", "fal-ai/veo3.1/image-to-video", speed="~60-120s", negative=True, **_VEO),
    "veo-3.1-fast": _family(
        "Veo 3.1 Fast", "Faster, cheaper Veo 3.1 tier with native audio.",
        "fal-ai/veo3.1/fast", "fal-ai/veo3.1/fast/image-to-video", negative=True, **_VEO),
    "veo-3.1-lite": _family(
        "Veo 3.1 Lite", "Lightest Veo 3.1 tier with native audio.",
        "fal-ai/veo3.1/lite", "fal-ai/veo3.1/lite/image-to-video", **_VEO),
    "kling-v4": _family(
        "Kling 4.0", "Kuaishou. Cinematic motion, 3-30s clips.",
        "fal_ai/kling/v4/text-to-video", "fal_ai/kling/v4/image-to-video", speed="~60-180s",
        price="$0.16-0.24/s", aspect_ratios=_SIX_ASPECTS, resolutions=("720p", "1080p"),
        image_resolutions=("1080p",), image_key="start_image_url", image_keeps_aspect=False,
        durations=(3, 30), default_duration=5),
    "seedance-2.5": _family(
        "Seedance 2.5", "ByteDance flagship. Audio in the same pass, lip-sync, 4-30s.",
        "fal_ai/bytedance/seedance-2.5/text-to-video", "fal_ai/bytedance/seedance-2.5/image-to-video",
        speed="~60-180s", price="$0.22-0.47/s", aspect_ratios=_SIX_ASPECTS, resolutions=("480p", "720p"),
        image_keeps_aspect=False, durations=(4, 30), default_duration=5),
    "wan-3.0": _family(
        "Wan 3.0", "Alibaba. Cheapest; native audio, 2-30s clips, up to 1080p.",
        "alibaba/wan-3.0/text-to-video", "alibaba/wan-3.0/image-to-video", speed="~70s",
        price="$0.05-0.20/s", aspect_ratios=("16:9", "4:3", "1:1", "3:4", "9:16"),
        resolutions=("480p", "720p", "1080p"), image_key="start_image_url", durations=(2, 30),
        default_duration=5, seed=True),
}
_ENDPOINTS: dict[str, tuple[str, str]] = {
    meta[f"{modality}_endpoint"]: (fid, modality) for fid, meta in FAMILIES.items() for modality in ("text", "image")}

_TERMINAL = frozenset({"completed", "succeeded", "failed", "error", "cancelled", "canceled"})
_LISTING_TTL_S = 600
_listing_cache: dict[str, tuple[float, Optional[frozenset[str]]]] = {}


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


def _family_id(candidate: Any) -> Optional[str]:
    """A family id from a family id or one of its endpoint ids; None for another backend's id."""
    if not isinstance(candidate, str):
        return None
    candidate = candidate.strip()
    if candidate in FAMILIES:
        return candidate
    hit = _ENDPOINTS.get(candidate)
    return hit[0] if hit else None


def _resolve_family(explicit: Optional[str]) -> tuple[str, dict[str, Any]]:
    """``video_gen.unitalk.model`` → ``explicit`` (the tool passes ``video_gen.model``) →
    ``video_gen.model`` → default. The shared key may hold another backend's id; it is skipped."""
    from hermes_cli.config import load_config

    section = load_config().get("video_gen")
    section = section if isinstance(section, dict) else {}
    scoped = section.get("unitalk")
    for candidate in (scoped.get("model") if isinstance(scoped, dict) else None, explicit, section.get("model")):
        fid = _family_id(candidate)
        if fid:
            return fid, FAMILIES[fid]
    return DEFAULT_MODEL, FAMILIES[DEFAULT_MODEL]


def _inline_local_image(ref: Optional[str]) -> Optional[str]:
    """A readable local image as a ``data:`` URL; anything else unchanged. Under a local terminal
    backend the tool hands providers an uploaded image's path, which the gateway cannot read."""
    if not ref or ref.lower().startswith(("http://", "https://", "data:")):
        return ref
    path = Path(ref).expanduser()
    mime = mimetypes.guess_type(path.name)[0] or ""
    if not mime.startswith("image/") or not path.is_file():
        return ref
    from agent.file_safety import raise_if_read_blocked

    raise_if_read_blocked(ref)
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def _duration(family: dict[str, Any], requested: Optional[str]) -> int:
    seconds = int(requested) if requested else family["default_duration"]
    if family["duration_enum"]:
        return min(family["duration_enum"], key=lambda d: abs(d - seconds))
    low, high = family["durations"]
    return max(low, min(high, seconds))


def _shape_request(call_kwargs: dict[str, Any]) -> dict[str, Any]:
    """Fit the generic ``videos.create`` kwargs to the endpoint they target: start-frame field name,
    supported resolution/aspect/duration, and only the optional keys that endpoint declares."""
    family_id, modality = _ENDPOINTS[call_kwargs["model"]]
    family = FAMILIES[family_id]
    shaped = {k: v for k, v in call_kwargs.items() if k != "extra_body"}
    extra = dict(call_kwargs.get("extra_body") or {})
    image = extra.pop("image_url", None)
    if image and modality == "image":
        extra[family["image_key"]] = image

    resolutions = (modality == "image" and family["image_resolutions"]) or family["resolutions"]
    if shaped.get("size") not in resolutions:  # nearest priced tier instead of an endpoint default the gateway can't bill
        shaped["size"] = resolutions[0]
    seconds = _duration(family, shaped.get("seconds"))
    shaped["seconds"] = str(seconds)
    if family["duration_suffix"]:
        extra["duration"] = f"{seconds}{family['duration_suffix']}"
    keeps_aspect = modality == "text" or family["image_keeps_aspect"]
    if not keeps_aspect or extra.get("aspect_ratio") not in family["aspect_ratios"]:
        extra.pop("aspect_ratio", None)
    for flag, key in (("negative", "negative_prompt"), ("seed", "seed")):
        if not family[flag]:
            extra.pop(key, None)
    if extra:
        shaped["extra_body"] = extra
    return shaped


class UnitalkVideoGenProvider(OpenAICompatibleVideoGenProvider):
    """Text-to-video and image-to-video through the Unitalk gateway's ``/v1/videos``."""

    name = "unitalk"
    display_name = "Unitalk"
    _env_key = KEY_ENV
    _default_base_url = GATEWAY_BASE_URL

    def _base_url(self) -> str:
        return GATEWAY_BASE_URL

    def list_models(self) -> list[dict[str, Any]]:
        """Families whose endpoints the gateway lists (all of them when the listing is unreachable)."""
        listed = _gateway_model_ids(self._api_key()) if self._api_key() else None
        rows = []
        for fid, meta in FAMILIES.items():
            modalities = [m for m in ("text", "image") if listed is None or meta[f"{m}_endpoint"] in listed]
            if not modalities:
                continue
            low, high = meta["durations"]
            rows.append({"id": fid, "display": meta["display"], "strengths": meta["strengths"],
                         **{k: meta[k] for k in ("speed", "price") if meta.get(k)},
                         "modalities": modalities, "min_duration": low, "max_duration": high})
        return rows

    def default_model(self) -> Optional[str]:
        return DEFAULT_MODEL

    def capabilities(self) -> dict[str, Any]:
        """The configured family's surface, so the tool schema offers only what that model honors."""
        _, family = _resolve_family(None)
        low, high = family["durations"]
        return {"modalities": ["text", "image"], "aspect_ratios": list(family["aspect_ratios"]),
                "resolutions": list(family["resolutions"]), "min_duration": low, "max_duration": high,
                "supports_audio": False, "supports_negative_prompt": family["negative"],
                "supports_seed": family["seed"], "supports_upscale": False, "max_reference_images": 0}

    def get_setup_schema(self) -> dict[str, Any]:
        return {"name": "Unitalk", "badge": "paid",
                "tag": "Veo 3.1, Kling, Seedance, Wan — billed to your Unitalk credits; text-to-video & image-to-video",
                "env_vars": [{"key": KEY_ENV, "prompt": "Unitalk API key", "url": "https://unitalk.ai"}]}

    def _create_and_poll(self, client: Any, call_kwargs: dict[str, Any]) -> Any:
        """Poll with the id ``create`` returned: the gateway's status responses re-encode a shortened
        model id that no longer resolves to a deployment (polling it fails with a missing FAL key)."""
        video = client.videos.create(**_shape_request(call_kwargs))
        job_id = video.id
        deadline = time.monotonic() + self._poll_deadline_s
        while getattr(video, "status", None) not in _TERMINAL:
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"video job {job_id} did not reach a terminal status within {int(self._poll_deadline_s)}s "
                    f"(last status={getattr(video, 'status', None)!r})")
            time.sleep(self._poll_interval_s)
            video = client.videos.retrieve(job_id)
        video.id = job_id  # the base class downloads by this id
        return video

    def generate(self, prompt: str, *, model: Optional[str] = None, image_url: Optional[str] = None,
                 **kwargs: Any) -> dict[str, Any]:
        _, family = _resolve_family(model)
        endpoint = family["image_endpoint" if image_url else "text_endpoint"]
        return super().generate(prompt, model=endpoint, image_url=_inline_local_image(image_url), **kwargs)


def register(ctx) -> None:
    """Plugin entry point — wire ``UnitalkVideoGenProvider`` into the registry."""
    ctx.register_video_gen_provider(UnitalkVideoGenProvider())
