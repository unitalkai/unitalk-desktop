"""Document skills run their own bundled helpers."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from tools.skills_sync import sync_skills
from tools.skills_tool import clear_skills_cache, skill_view


@pytest.fixture
def synced_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text("skills:\n  disabled:\n    - microsoft-office\n", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.chdir(tmp_path)
    sync_skills(quiet=True)
    clear_skills_cache()
    return home


@pytest.mark.parametrize(
    ("name", "reference", "helper"),
    [
        ("docx", "references/word.md", "scripts/docx_read.py"),
        ("powerpoint", "references/powerpoint.md", "scripts/pptx_read.py"),
        ("xlsx", "references/excel.md", "scripts/xlsx_read.py"),
        ("pdf", "references/forms.md", "scripts/pdf_read.py"),
    ],
)
def test_bundled_format_skill_contains_its_own_guide_and_helper(synced_home, name, reference, helper):
    entry = json.loads(skill_view(name, preprocess=False))
    office = json.loads(skill_view("microsoft-office", preprocess=False))
    guide = json.loads(skill_view(name, file_path=reference))

    assert entry["success"] and entry["name"] == name
    assert not office["success"]
    assert reference in entry["content"]
    assert guide["success"]
    assert Path(entry["skill_dir"]).is_relative_to(synced_home)
    assert json.loads(skill_view(name, file_path=helper))["success"]


@pytest.mark.parametrize(
    ("name", "helper", "module"),
    [
        ("docx", "docx_read.py", "docx"),
        ("powerpoint", "pptx_read.py", "pptx"),
        ("xlsx", "xlsx_read.py", "openpyxl"),
        ("pdf", "pdf_read.py", "pypdf"),
    ],
)
def test_seeded_document_helper_runs(synced_home, name, helper, module):
    pytest.importorskip(module)
    entry = json.loads(skill_view(name, preprocess=False))
    result = subprocess.run(
        [sys.executable, str(Path(entry["skill_dir"]) / "scripts" / helper), "--help"],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "usage:" in result.stdout.lower()


@pytest.mark.parametrize(
    ("name", "module", "create", "read", "spec", "read_options"),
    [
        ("docx", "docx", "docx_create.py", "docx_read.py",
         {"blocks": [{"type": "paragraph", "text": "Independent document"}]}, ["--text"]),
        ("powerpoint", "pptx", "pptx_create.py", "pptx_read.py",
         {"slides": [{"layout": "title", "title": "Independent document"}]}, ["--outline"]),
        ("xlsx", "openpyxl", "xlsx_create.py", "xlsx_read.py",
         {"sheets": [{"name": "Data", "rows": [["Independent document", 42]]}]}, ["--json", "--sheet", "Data"]),
    ],
)
def test_standalone_skill_creates_and_reads_document(
    synced_home, tmp_path, name, module, create, read, spec, read_options
):
    pytest.importorskip(module)
    entry = json.loads(skill_view(name, preprocess=False))
    scripts = Path(entry["skill_dir"]) / "scripts"
    spec_path = tmp_path / "spec.json"
    output = tmp_path / ("result.pptx" if name == "powerpoint" else f"result.{name}")
    spec_path.write_text(json.dumps(spec), encoding="utf-8")

    created = subprocess.run(
        [sys.executable, str(scripts / create), str(spec_path), str(output)],
        capture_output=True, text=True, check=False,
    )
    assert created.returncode == 0, created.stderr
    readback = subprocess.run(
        [sys.executable, str(scripts / read), str(output), *read_options],
        capture_output=True, text=True, check=False,
    )
    assert readback.returncode == 0, readback.stderr
    assert "Independent document" in json.dumps(json.loads(readback.stdout))


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
    assert bundled["success"] and "scripts/xlsx_create.py" in bundled["content"]
