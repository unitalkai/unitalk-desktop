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
    related_skills: [pdf, powerpoint, xlsx]
---

# Word Document Skill

Create, read, edit, and review `.docx` documents with the bundled helpers.
Legacy `.doc` files need conversion first.

## When to Use

Use for Word reports, templates, tracked changes, comments, or extracting
text and images.

## Prerequisites

Python 3.10+ with `python-docx` and its `lxml` dependency. LibreOffice is
optional for PDF conversion.

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
"$PY" scripts/docx_create.py --help
```

The sandbox fallback publishes only a completed environment and preserves a
working environment another agent published. In PowerShell, select
`$env:PY = hermes pm environment documents --extra documents --extra documents-pdf`
and invoke helpers with `& $env:PY`. Never install packages into the
Hermes-owned interpreter.

## How to Run

1. Work from the `skill_dir` returned by `skill_view` and select `PY`.
2. Read `references/word.md` with `skill_view` for commands and details.
3. Run this skill's `scripts/` with `terminal` and `"$PY"`; use an output
   path to preserve the original document.

## Quick Reference

`docx_create.py`, `docx_read.py`, `docx_edit.py`, and `docx_template.py`
cover creation, inspection, editing, and templates. `docx_revisions.py`,
`docx_comments.py`, and `docx_validate.py` handle review and validation.

## Procedure

Choose the operation from the Word reference, prepare its inputs, and run
the matching helper from this skill's `scripts/` directory.

## Converting to PDF

When LibreOffice is available, use `soffice --headless --convert-to pdf`
with the document and an output directory. Otherwise report that rendering
is unavailable; `python-docx` does not render PDFs.

## Pitfalls

Word can split text across formatting runs; replacement across different
formats inherits the first run's formatting. LibreOffice or Word is needed
to populate fields and render pages.

## Verification

Re-read the output with `docx_read.py`; use `docx_validate.py` after editing
revisions, comments, or fields.
