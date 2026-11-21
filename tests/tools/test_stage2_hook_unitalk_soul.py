"""The Docker stage2 hook gives an agent the Unitalk persona (docker/SOUL.md).

A fresh home gets it from seed_one; a SOUL.md that is still one of Hermes' own
seed texts gets it from seed_unitalk_soul. A SOUL.md the member wrote is never
touched.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from hermes_cli.default_soul import (
    DEFAULT_SOUL_MD,
    _LEGACY_TEMPLATE_SOULS,
    is_legacy_template_soul,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
STAGE2_HOOK = REPO_ROOT / "docker" / "stage2-hook.sh"
PERSONA = REPO_ROOT / "docker" / "SOUL.md"


@pytest.fixture(scope="module")
def stage2_text() -> str:
    if not STAGE2_HOOK.exists():
        pytest.skip("docker/stage2-hook.sh not present in this checkout")
    return STAGE2_HOOK.read_text()


def _function(text: str, name: str) -> str:
    m = re.search(rf"({name}\(\) \{{\n(?:.*\n)*?\}})\n{name}", text)
    assert m, f"stage2-hook.sh must define {name} right before calling it"
    return m.group(1)


def _path_guard_functions(text: str) -> str:
    start = text.index("path_has_symlink_component() {")
    end = text.index("\n\nchown_hermes_tree() {", start)
    return text[start:end]


def _run(stage2_text: str, tmp_path: Path, calls: str, python: str = sys.executable):
    bash = shutil.which("bash")
    if bash is None:
        pytest.skip("bash not available")
    install_dir = tmp_path / "install"
    (install_dir / "docker").mkdir(parents=True, exist_ok=True)
    (install_dir / ".venv" / "bin").mkdir(parents=True, exist_ok=True)
    shutil.copy(PERSONA, install_dir / "docker" / "SOUL.md")
    venv_python = install_dir / ".venv" / "bin" / "python"
    if not venv_python.exists():
        venv_python.symlink_to(python)
    script = (
        "set -eu\n"
        f'HERMES_HOME="{tmp_path / "home"}"\n'
        f'INSTALL_DIR="{install_dir}"\n'
        'as_hermes() { "$@"; }\n'
        f"{_path_guard_functions(stage2_text)}\n"
        f"{_function(stage2_text, 'seed_one')}\n"
        f"{_function(stage2_text, 'seed_unitalk_soul')}\n"
        f"{calls}\n"
    )
    script_path = tmp_path / "harness.sh"
    script_path.write_text(script)
    env = {**os.environ, "PYTHONPATH": str(REPO_ROOT)}
    return subprocess.run(
        [bash, str(script_path)], capture_output=True, text=True, check=False, env=env
    )


@pytest.fixture
def home(tmp_path: Path) -> Path:
    path = tmp_path / "home"
    path.mkdir()
    return path


def test_persona_is_unitalk_and_not_a_stock_hermes_text() -> None:
    text = PERSONA.read_text(encoding="utf-8")
    assert text.startswith("You are an AI collaborator created by Unitalk AI")
    assert text.strip() != DEFAULT_SOUL_MD.strip()
    assert not is_legacy_template_soul(text)


def test_fresh_home_gets_the_persona(
    stage2_text: str, tmp_path: Path, home: Path
) -> None:
    proc = _run(
        stage2_text, tmp_path, 'seed_one "SOUL.md" "docker/SOUL.md"\nseed_unitalk_soul'
    )
    assert proc.returncode == 0, proc.stderr
    assert (home / "SOUL.md").read_bytes() == PERSONA.read_bytes()
    assert proc.stdout == ""


@pytest.mark.parametrize(
    "stock",
    [
        DEFAULT_SOUL_MD,
        DEFAULT_SOUL_MD + "\n",
        "﻿" + DEFAULT_SOUL_MD.replace("\n", "\r\n") + "\r\n",
        *_LEGACY_TEMPLATE_SOULS,
    ],
)
def test_stock_hermes_text_gets_the_persona(
    stage2_text: str, tmp_path: Path, home: Path, stock: str
) -> None:
    soul = home / "SOUL.md"
    soul.write_text(stock, encoding="utf-8", newline="")
    soul.chmod(0o640)
    proc = _run(stage2_text, tmp_path, "seed_unitalk_soul")
    assert proc.returncode == 0, proc.stderr
    assert soul.read_bytes() == PERSONA.read_bytes()
    assert stat.S_IMODE(soul.stat().st_mode) == 0o640
    assert "seeded the Unitalk persona" in proc.stdout
    assert [p.name for p in home.iterdir()] == ["SOUL.md"]  # no temp file left


@pytest.mark.parametrize(
    "member_text",
    [
        "You are a project management assistant.\n",
        DEFAULT_SOUL_MD + "\n\nAlways answer in French.\n",
        PERSONA.read_text(encoding="utf-8")
        + "\n### Stalwart Email Instruction\nUse the mail tool.\n###\n",
        "",
    ],
)
def test_member_soul_is_never_touched(
    stage2_text: str, tmp_path: Path, home: Path, member_text: str
) -> None:
    soul = home / "SOUL.md"
    soul.write_text(member_text, encoding="utf-8")
    proc = _run(
        stage2_text, tmp_path, 'seed_one "SOUL.md" "docker/SOUL.md"\nseed_unitalk_soul'
    )
    assert proc.returncode == 0, proc.stderr
    assert soul.read_text(encoding="utf-8") == member_text
    assert proc.stdout == ""


def test_symlinked_soul_is_refused(
    stage2_text: str, tmp_path: Path, home: Path
) -> None:
    outside = tmp_path / "outside.md"
    outside.write_text(DEFAULT_SOUL_MD, encoding="utf-8")
    try:
        (home / "SOUL.md").symlink_to(outside)
    except (NotImplementedError, OSError):
        pytest.skip("symlinks are not available on this platform")
    proc = _run(stage2_text, tmp_path, "seed_unitalk_soul")
    assert proc.returncode == 0, proc.stderr
    assert outside.read_text(encoding="utf-8") == DEFAULT_SOUL_MD
    assert (home / "SOUL.md").is_symlink()
    assert "refusing persona seed through symlinked path" in proc.stdout


def test_a_failed_check_never_blocks_the_start(
    stage2_text: str, tmp_path: Path, home: Path
) -> None:
    soul = home / "SOUL.md"
    soul.write_text(DEFAULT_SOUL_MD, encoding="utf-8")
    proc = _run(
        stage2_text, tmp_path, "seed_unitalk_soul\necho after", python="/bin/false"
    )
    assert proc.returncode == 0, proc.stderr
    assert soul.read_text(encoding="utf-8") == DEFAULT_SOUL_MD
    assert "could not check SOUL.md" in proc.stdout
    assert proc.stdout.rstrip().endswith("after")
