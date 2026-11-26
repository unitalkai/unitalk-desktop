---
name: docx
description: Create, edit, and review Word documents.
version: 1.1.0
author: Nous Research
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [word, docx, documents, templates, revisions, comments]
    category: productivity
    related_skills: [microsoft-office, pdf]
---

# Word Document Skill

Create, read, edit, and review `.docx` documents using the bundled
`microsoft-office` helpers. Legacy `.doc` files need conversion first.

## When to Use

Use for Word reports, templates, tracked changes, comments, or extracting
text and images.

## Prerequisites

The `microsoft-office` skill must be enabled. Its Prerequisites section
selects the shared Hermes documents interpreter with `python-docx` and
`lxml`; LibreOffice is optional for PDF conversion. If that skill is
disabled or missing, ask the user to enable or restore it.

## How to Run

1. Call `skill_view(name="microsoft-office")`, work from its returned
   `skill_dir`, and follow its Prerequisites to select `PY`.
2. Call `skill_view(name="microsoft-office", file_path="references/word.md")`
   for the commands and format-specific details.
3. Run the helpers from that Office directory with `terminal` and `"$PY"`
   (PowerShell: `& $env:PY`); use an output path to preserve the original.

## Quick Reference

`docx_create.py`, `docx_read.py`, `docx_edit.py`, and `docx_template.py`
cover creation, inspection, editing, and templates. `docx_revisions.py`,
`docx_comments.py`, and `docx_validate.py` handle review and validation.

## Procedure

Choose the operation from the Word reference, prepare its inputs, and run
the matching helper from the Office skill's `scripts/` directory.

## Pitfalls

Word can split text across formatting runs; replacement across different
formats inherits the first run's formatting. LibreOffice or Word is needed
to populate fields and render pages.

## Verification

Re-read the output with `docx_read.py`; use `docx_validate.py` after editing
revisions, comments, or fields.
