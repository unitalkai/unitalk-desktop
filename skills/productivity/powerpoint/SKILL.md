---
name: powerpoint
description: Create, inspect, and edit presentation decks.
version: 1.1.0
author: Nous Research
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [powerpoint, pptx, presentations, slides, templates]
    category: productivity
    related_skills: [microsoft-office, pdf]
---

# PowerPoint Skill

Create, read, edit, and template `.pptx` decks using the bundled
`microsoft-office` helpers. Legacy `.ppt` files need conversion first.

## When to Use

Use for presentations, slide templates, charts, speaker notes, or visual
review of slides.

## Prerequisites

The `microsoft-office` skill must be enabled. Its Prerequisites section
selects the shared Hermes documents interpreter with `python-pptx`.
LibreOffice and Poppler are optional for rendering slide images. If that
skill is disabled or missing, ask the user to enable or restore it.

## How to Run

1. Call `skill_view(name="microsoft-office")`, work from its returned
   `skill_dir`, and follow its Prerequisites to select `PY`.
2. Call `skill_view(name="microsoft-office", file_path="references/powerpoint.md")`
   for the commands and format-specific details.
3. Run the helpers from that Office directory with `terminal` and `"$PY"`
   (PowerShell: `& $env:PY`); use an output path to preserve the original.

## Quick Reference

`pptx_create.py`, `pptx_read.py`, `pptx_edit.py`, and
`pptx_from_template.py` create, inspect, edit, and template decks.
`pptx_render.py` produces slide images when its render tools are present.

## Procedure

Choose the operation from the PowerPoint reference, prepare its inputs,
and run the matching helper from the Office skill's `scripts/` directory.

## Pitfalls

Text can span several formatting runs. Rendering requires LibreOffice and
Poppler; font substitution can change the layout.

## Verification

Re-read the output with `pptx_read.py`; render and inspect the slides when
the render tools are available.
