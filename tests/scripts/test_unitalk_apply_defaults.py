"""Boot-time Unitalk defaults reach homes created before the default existed.

The template only seeds a volume's first boot; ``scripts/unitalk_apply_defaults.py`` runs on every
boot and fills the image/video defaults in wherever the home has not chosen a provider itself, and
turns video generation on once per home.
"""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import hermes_yaml as yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "unitalk_apply_defaults.py"


def _load_script_module():
    spec = importlib.util.spec_from_file_location("unitalk_apply_defaults_test_module", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(hermes_home: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update({"HERMES_HOME": str(hermes_home), "HERMES_SKIP_CHMOD": "1", "PYTHONPATH": str(REPO_ROOT)})
    return subprocess.run(
        [sys.executable, str(SCRIPT)], cwd=str(REPO_ROOT), env=env,
        capture_output=True, text=True, check=False,
    )


def _section(path: Path, key: str):
    return (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get(key)


def _image_gen(path: Path) -> dict:
    return _section(path, "image_gen")


def test_existing_home_without_image_settings_gets_the_unitalk_default(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    config.write_text("# operator note\nagent:\n  max_turns: 42\n", encoding="utf-8")

    proc = _run(tmp_path)

    assert proc.returncode == 0, proc.stderr
    assert _image_gen(config) == _load_script_module().IMAGE_GEN_DEFAULT
    text = config.read_text(encoding="utf-8")
    assert "# operator note" in text
    assert yaml.safe_load(text)["agent"]["max_turns"] == 42


def test_home_that_chose_an_image_provider_is_left_alone(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    chosen = {"provider": "fal", "model": "fal-ai/flux-2-pro"}
    config.write_text(yaml.safe_dump({"image_gen": chosen}), encoding="utf-8")

    proc = _run(tmp_path)

    assert proc.returncode == 0, proc.stderr
    assert _image_gen(config) == chosen


def test_named_profiles_receive_the_default_too(tmp_path: Path) -> None:
    (tmp_path / "config.yaml").write_text("agent:\n  max_turns: 90\n", encoding="utf-8")
    profile_config = tmp_path / "profiles" / "designer" / "config.yaml"
    profile_config.parent.mkdir(parents=True)
    profile_config.write_text("agent:\n  max_turns: 90\n", encoding="utf-8")

    proc = _run(tmp_path)

    assert proc.returncode == 0, proc.stderr
    assert _image_gen(profile_config)["provider"] == "unitalk"
    assert _section(profile_config, "video_gen")["provider"] == "unitalk"


def test_second_boot_changes_nothing(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    config.write_text("agent:\n  max_turns: 90\n", encoding="utf-8")
    assert _run(tmp_path).returncode == 0
    after_first = config.read_bytes()

    proc = _run(tmp_path)

    assert proc.returncode == 0, proc.stderr
    assert config.read_bytes() == after_first
    assert "applied Unitalk defaults" not in proc.stdout


def test_boot_default_matches_the_template_new_homes_are_seeded_from() -> None:
    template = yaml.safe_load((REPO_ROOT / "cli-config.yaml.example").read_text(encoding="utf-8"))

    assert template["image_gen"] == _load_script_module().IMAGE_GEN_DEFAULT


def _video_on(path: Path) -> bool:
    from hermes_cli.tools_config import _get_platform_tools

    return "video_gen" in _get_platform_tools(yaml.safe_load(path.read_text(encoding="utf-8")), "cli")


def test_existing_home_gets_the_video_default_and_video_turned_on(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    config.write_text("agent:\n  max_turns: 42\n", encoding="utf-8")
    assert not _video_on(config)

    proc = _run(tmp_path)

    assert proc.returncode == 0, proc.stderr
    assert _section(config, "video_gen") == _load_script_module().VIDEO_GEN_DEFAULT
    assert _video_on(config)
    from hermes_cli.tools_config import _get_platform_tools
    assert "terminal" in _get_platform_tools(yaml.safe_load(config.read_text(encoding="utf-8")), "cli")


def test_video_switched_off_after_the_first_boot_stays_off(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    config.write_text("agent:\n  max_turns: 42\n", encoding="utf-8")
    assert _run(tmp_path).returncode == 0
    switched_off = yaml.safe_load(config.read_text(encoding="utf-8"))
    switched_off["platform_toolsets"]["cli"] = ["hermes-cli"]
    config.write_text(yaml.safe_dump(switched_off), encoding="utf-8")

    proc = _run(tmp_path)

    assert proc.returncode == 0, proc.stderr
    assert not _video_on(config)


def test_a_saved_toolset_list_keeps_its_choices_and_gains_video(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    config.write_text(yaml.safe_dump({"platform_toolsets": {"cli": ["file", "terminal", "my-mcp"]}}), encoding="utf-8")

    proc = _run(tmp_path)

    assert proc.returncode == 0, proc.stderr
    assert _section(config, "platform_toolsets")["cli"] == ["file", "terminal", "my-mcp", "video_gen"]


def test_an_explicitly_empty_toolset_list_is_left_empty(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    config.write_text(yaml.safe_dump({"platform_toolsets": {"cli": []}}), encoding="utf-8")

    proc = _run(tmp_path)

    assert proc.returncode == 0, proc.stderr
    assert _section(config, "platform_toolsets")["cli"] == []


def test_home_that_chose_a_video_provider_keeps_it(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    chosen = {"provider": "fal", "model": "veo3.1"}
    config.write_text(yaml.safe_dump({"video_gen": chosen}), encoding="utf-8")

    proc = _run(tmp_path)

    assert proc.returncode == 0, proc.stderr
    assert _section(config, "video_gen") == chosen


def test_template_turns_video_on_with_the_boot_video_default() -> None:
    template = yaml.safe_load((REPO_ROOT / "cli-config.yaml.example").read_text(encoding="utf-8"))

    assert template["video_gen"] == _load_script_module().VIDEO_GEN_DEFAULT
    from hermes_cli.tools_config import _get_platform_tools
    assert "video_gen" in _get_platform_tools(template, "cli")
