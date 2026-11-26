#!/usr/bin/env python3
"""Apply Unitalk distribution defaults to homes that already exist, on every container boot.

The image seeds config.yaml from cli-config.yaml.example only on a volume's first boot, so a
default added to the template never reaches an instance created earlier. This fills a default
in only where the home has not made its own choice; a section already chosen is never touched.

Video generation is default-off upstream; Unitalk turns it on for the CLI/desktop toolset list.
That happens ONCE per home (a marker file records it): a saved list cannot tell "never enabled"
from "turned off", so re-adding it every boot would undo a user's choice to switch video off.
"""
from __future__ import annotations

import sys
from pathlib import Path

from hermes_cli.config import atomic_config_write, require_readable_config_before_write
from hermes_cli.env_loader import selected_config_backend_name
from hermes_constants import get_hermes_home

# Keep identical to the image_gen / video_gen blocks in cli-config.yaml.example (a test enforces it).
IMAGE_GEN_DEFAULT = {
    "provider": "unitalk",
    "model": "fal_ai/fal-ai/nano-banana-pro",
    "max_parallel_requests": 4,
}
VIDEO_GEN_DEFAULT = {
    "provider": "unitalk",
    "model": "wan-3.0",
}
VIDEO_TOOLSET = "video_gen"
VIDEO_ENABLED_MARKER = ".unitalk-video-enabled"


def _with_backend_default(config: dict, section: str, default: dict) -> dict:
    """``config`` with ``default`` filled into ``section`` unless the home already chose a backend."""
    current = config.get(section)
    if isinstance(current, dict) and (current.get("provider") or current.get("use_gateway")):
        return config
    merged = dict(current) if isinstance(current, dict) else {}
    for key, value in default.items():
        merged.setdefault(key, value)
    return {**config, section: merged}


def _with_video_toolset(config: dict) -> dict:
    """``config`` with video generation added to the CLI/desktop toolset list.

    An unsaved list means the platform default composite; ``[hermes-cli, video_gen]`` keeps that
    composite and adds video. An explicitly saved EMPTY list is a deliberate zero-tool state.
    """
    from hermes_cli.tools_config import _coerce_platform_toolsets_value, _platform_default_toolset

    platform_toolsets = config.get("platform_toolsets")
    platform_toolsets = dict(platform_toolsets) if isinstance(platform_toolsets, dict) else {}
    saved = _coerce_platform_toolsets_value(platform_toolsets.get("cli"), "cli")
    if saved == []:
        return config
    names = [str(name) for name in saved] if isinstance(saved, list) else [_platform_default_toolset("cli")]
    if VIDEO_TOOLSET in names:
        return config
    platform_toolsets["cli"] = [*names, VIDEO_TOOLSET]
    return {**config, "platform_toolsets": platform_toolsets}


def with_unitalk_defaults(config: dict, *, enable_video: bool) -> dict:
    """``config`` with every Unitalk default applied that this home has not chosen against."""
    updated = _with_backend_default(config, "image_gen", IMAGE_GEN_DEFAULT)
    updated = _with_backend_default(updated, "video_gen", VIDEO_GEN_DEFAULT)
    return _with_video_toolset(updated) if enable_video else updated


def _homes() -> list[Path]:
    from hermes_cli.profiles import profiles_to_serve

    homes = [home for _, home in profiles_to_serve(True, include_standalone=True, include_parked=True)]
    return [home for home in dict.fromkeys(homes) if (home / "config.yaml").is_file()]


def _apply(home: Path) -> None:
    path = home / "config.yaml"
    marker = home / VIDEO_ENABLED_MARKER
    config = require_readable_config_before_write(path)
    updated = with_unitalk_defaults(config, enable_video=not marker.exists())
    if updated != config:
        atomic_config_write(path, updated)
        changed = ", ".join(key for key in ("image_gen", "video_gen", "platform_toolsets")
                            if updated.get(key) != config.get(key))
        print(f"[unitalk-defaults] applied Unitalk defaults ({changed}) to {path}")
    if not marker.exists():
        marker.write_text("video generation enabled once by scripts/unitalk_apply_defaults.py\n", encoding="utf-8")


def main() -> int:
    if selected_config_backend_name(get_hermes_home()) == "remote":
        print("[unitalk-defaults] remote config backend: nothing to apply")
        return 0
    for home in _homes():
        _apply(home)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # a boot must never fail because a default could not be applied
        print(f"[unitalk-defaults] WARNING: {exc}", file=sys.stderr)
        raise SystemExit(0)
