"""Document skill entry points resolve to the bundled Office helpers."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from tools.skills_sync import sync_skills
from tools.skills_tool import clear_skills_cache, skill_view


@pytest.fixture
def synced_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    monkeypatch.chdir(tmp_path)
    sync_skills(quiet=True)
    clear_skills_cache()
    return tmp_path / "home"


@pytest.mark.parametrize(
    ("name", "reference", "helper"),
    [
        ("docx", "references/word.md", "scripts/docx_read.py"),
        ("powerpoint", "references/powerpoint.md", "scripts/pptx_read.py"),
        ("xlsx", "references/excel.md", "scripts/xlsx_read.py"),
    ],
)
def test_bundled_format_skill_reaches_office_helper(synced_home, name, reference, helper):
    entry = json.loads(skill_view(name, preprocess=False))
    office = json.loads(skill_view("microsoft-office", preprocess=False))
    guide = json.loads(skill_view("microsoft-office", file_path=reference))

    assert entry["success"] and entry["name"] == name
    assert "microsoft-office" in entry["related_skills"]
    assert reference in entry["content"]
    assert office["success"] and guide["success"]
    assert Path(office["skill_dir"]).is_relative_to(synced_home)
    assert json.loads(skill_view("microsoft-office", file_path=helper))["success"]


@pytest.mark.parametrize(
    ("helper", "module"),
    [
        ("docx_read.py", "docx"),
        ("pptx_read.py", "pptx"),
        ("xlsx_read.py", "openpyxl"),
    ],
)
def test_seeded_office_helper_runs(synced_home, helper, module):
    pytest.importorskip(module)
    office = json.loads(skill_view("microsoft-office", preprocess=False))
    result = subprocess.run(
        [sys.executable, str(Path(office["skill_dir"]) / "scripts" / helper), "--help"],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "usage:" in result.stdout.lower()


def test_sync_keeps_an_existing_custom_document_skill(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.chdir(tmp_path)
    existing = home / "skills" / "productivity" / "xlsx" / "SKILL.md"
    existing.parent.mkdir(parents=True)
    existing.write_text("---\nname: xlsx\ndescription: My spreadsheet skill.\n---\n", encoding="utf-8")

    sync_skills(quiet=True)
    clear_skills_cache()

    assert "My spreadsheet skill." in json.loads(skill_view("xlsx", preprocess=False))["content"]
    assert json.loads(skill_view("pdf", preprocess=False))["success"]


def test_sync_preserves_a_unitalk_skill_in_its_original_category(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.chdir(tmp_path)
    existing = home / "skills" / "documents-and-analysis" / "xlsx" / "SKILL.md"
    existing.parent.mkdir(parents=True)
    existing.write_text("---\nname: xlsx\ndescription: My spreadsheet skill.\n---\n", encoding="utf-8")

    sync_skills(quiet=True)
    clear_skills_cache()

    original = json.loads(skill_view("documents-and-analysis/xlsx", preprocess=False))
    bundled = json.loads(skill_view("productivity/xlsx", preprocess=False))
    assert original["success"] and "My spreadsheet skill." in original["content"]
    assert bundled["success"] and "microsoft-office" in bundled["related_skills"]
