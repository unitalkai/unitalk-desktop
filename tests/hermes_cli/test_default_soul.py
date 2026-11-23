"""The default identity is consistent across seeded and fallback sessions."""

from types import SimpleNamespace

import pytest


_PREVIOUS_DEFAULT = (
    "You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of "
    "the ask — a one-line question gets a one-line answer, and finished work gets a short report of what "
    "changed, what's verified, and what's left, never a replay of the process. No filler (\"Great question,\" "
    "\"I'd be happy to\"), no restating the request back, no re-summarizing what you already said, no narrating "
    "tool calls the user can see. Plain claims over adjectives; when unsure, say so plainly. Agree because it's "
    "right, not because the user said it. Depth is earned — give it when the user asks for detail, teaches, or "
    "the stakes demand it, not by default."
)


@pytest.mark.parametrize("previous", [_PREVIOUS_DEFAULT, _PREVIOUS_DEFAULT.replace("—", "--")])
def test_previous_default_upgrades_but_customizations_are_preserved(tmp_path, previous):
    from hermes_cli.config import _ensure_default_soul_md
    from hermes_cli.default_soul import DEFAULT_SOUL_MD

    soul = tmp_path / "SOUL.md"
    soul.write_text(previous, encoding="utf-8")
    _ensure_default_soul_md(tmp_path)
    assert soul.read_text(encoding="utf-8") == DEFAULT_SOUL_MD
    assert DEFAULT_SOUL_MD != previous

    customized = previous + " Always respond in verse."
    soul.write_text(customized, encoding="utf-8")
    _ensure_default_soul_md(tmp_path)
    assert soul.read_text(encoding="utf-8") == customized


def test_seeded_and_fallback_identity_match(tmp_path, monkeypatch):
    from agent.system_prompt import _identity_parts
    from hermes_cli.config import _ensure_default_soul_md

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _ensure_default_soul_md(tmp_path)
    seeded, loaded = _identity_parts(
        SimpleNamespace(load_soul_identity=True, skip_context_files=False), None
    )
    fallback, fallback_loaded = _identity_parts(
        SimpleNamespace(load_soul_identity=False, skip_context_files=True), None
    )

    assert loaded and not fallback_loaded
    assert seeded == fallback
