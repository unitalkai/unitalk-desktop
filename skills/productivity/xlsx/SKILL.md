---
name: xlsx
description: Create, inspect, and edit spreadsheets and CSVs.
version: 1.1.0
author: Nous Research
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [excel, spreadsheet, xlsx, csv, formulas]
    category: productivity
    related_skills: [pdf, docx, powerpoint]
---

# Spreadsheet Skill

Create, read, edit, and restructure `.xlsx` workbooks with the bundled
helpers. Legacy `.xls` files need conversion first.

## When to Use

Use for workbooks, formulas, charts, tables, structural edits, and CSV
conversion.

## Prerequisites

Python 3.10+ with `openpyxl`. LibreOffice Calc is optional for formula
recalculation.

Run this with `terminal` from this skill's `skill_dir`. It selects an existing
interpreter or the shared, pinned Hermes documents environment. In a sandbox
without Hermes it creates an isolated environment with the same pinned packages.

```bash
python -c "import docx, pptx, openpyxl" 2>/dev/null && PY=python || if command -v hermes >/dev/null 2>&1; then
  PY="$(hermes pm environment documents --extra documents --extra documents-pdf)"
else
  PY="$HOME/.cache/hermes-docs-venv/bin/python"
  "$PY" -c "import docx, openpyxl, pptx, reportlab, pypdf, pdfplumber, pypdfium2" 2>/dev/null || (
    mkdir -p "$HOME/.cache" && cd "$HOME/.cache" && stage="$(mktemp -d hermes-docs-venv.XXXXXX)" || exit 1
    old="$(readlink hermes-docs-venv)"
    python3 -m venv "$stage" &&
      "$stage/bin/python" -m pip install -q --disable-pip-version-check python-docx==1.2.0 openpyxl==3.1.5 python-pptx==1.0.2 reportlab==5.1.0 pypdf==6.21.4 pdfplumber==0.11.10 pypdfium2==5.14.0 &&
      "$stage/bin/python" -c "import docx, openpyxl, pptx, reportlab, pypdf, pdfplumber, pypdfium2" &&
      if [ -z "$old" ]; then python3 -c 'import os, sys; os.symlink(*sys.argv[1:])' "$stage" hermes-docs-venv
      elif [ "$(readlink hermes-docs-venv)" = "$old" ] && ! "$old/bin/python" -c "import docx, openpyxl, pptx, reportlab, pypdf, pdfplumber, pypdfium2" 2>/dev/null; then
        ln -s "$stage" "$stage.lnk" && python3 -c 'import os, sys; os.replace(*sys.argv[1:])' "$stage.lnk" hermes-docs-venv &&
          case "$old" in hermes-docs-venv.??????) rm -rf "$old" ;; esac
      fi 2>/dev/null
    [ "$(readlink hermes-docs-venv)" = "$stage" ] || rm -rf "$stage" "$stage.lnk"
  )
fi
export PY
"$PY" scripts/xlsx_create.py --help
```

The sandbox fallback publishes only a completed environment and preserves a
working environment another agent published. In PowerShell, select
`$env:PY = hermes pm environment documents --extra documents --extra documents-pdf`
and invoke helpers with `& $env:PY`. Never install packages into the
Hermes-owned interpreter.

## How to Run

1. Work from the `skill_dir` returned by `skill_view` and select `PY`.
2. Read `references/excel.md` with `skill_view` for commands and details.
3. Run this skill's `scripts/` with `terminal` and `"$PY"`; use an output
   path to preserve the original workbook.

## Quick Reference

`scripts/xlsx_create.py`, `xlsx_read.py`, `xlsx_edit.py`, and
`xlsx_restructure.py` handle workbooks. `csv_to_xlsx.py` and
`xlsx_to_csv.py` convert CSV files; `xlsx_recalc.py` recalculates formulas.

## Procedure

Choose the operation from the Excel reference, prepare its inputs, and run
the matching helper from this skill's `scripts/` directory.

## Pitfalls

`openpyxl` writes but does not calculate formulas. Use `xlsx_recalc.py`
with LibreOffice when cached results are needed; the helper reports when
LibreOffice is unavailable.

## Verification

Re-read the output with `xlsx_read.py` and check the changed values and
formulas; verify recalculated values when required.
