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
    related_skills: [microsoft-office, pdf]
---

# Spreadsheet Skill

Create, read, edit, and restructure `.xlsx` workbooks with the bundled
`microsoft-office` helpers. Legacy `.xls` files need conversion first.

## When to Use

Use for workbooks, formulas, charts, tables, structural edits, and CSV
conversion.

## Prerequisites

The `microsoft-office` skill must be enabled. Its Prerequisites section
selects the shared Hermes documents interpreter with `openpyxl`.
LibreOffice Calc is optional for formula recalculation. If that skill is
disabled or missing, ask the user to enable or restore it.

## How to Run

1. Call `skill_view(name="microsoft-office")`, work from its returned
   `skill_dir`, and follow its Prerequisites to select `PY`.
2. Call `skill_view(name="microsoft-office", file_path="references/excel.md")`
   for the commands and format-specific details.
3. Run the helpers from that Office directory with `terminal` and `"$PY"`
   (PowerShell: `& $env:PY`); use an output path to preserve the original.

## Quick Reference

`xlsx_create.py`, `xlsx_read.py`, `xlsx_edit.py`, and
`xlsx_restructure.py` handle workbooks. `csv_to_xlsx.py` and
`xlsx_to_csv.py` convert CSV files; `xlsx_recalc.py` recalculates formulas.

## Procedure

Choose the operation from the Excel reference, prepare its inputs, and run
the matching helper from the Office skill's `scripts/` directory.

## Pitfalls

`openpyxl` writes but does not calculate formulas. Use `xlsx_recalc.py`
with LibreOffice when cached results are needed; the helper reports when
LibreOffice is unavailable.

## Verification

Re-read the output with `xlsx_read.py` and check the changed values and
formulas; verify recalculated values when required.
