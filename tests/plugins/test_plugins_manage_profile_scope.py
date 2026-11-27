"""plugins.manage optional ``profile`` param — per-profile plugins scoping.

Mirrors ``cron.manage`` / ``mcp.servers.*``: when a ``profile`` is passed the
handler resolves ``get_profile_dir(profile)`` and wraps the action dispatch in
``set_hermes_home_override`` / ``reset_hermes_home_override``. Because
``_plugins_dir()`` keys off ``get_hermes_home()``, the list action must then
scan THAT profile's ``plugins/`` dir, not the launch profile's.
"""

import hermes_yaml as yaml

from tui_gateway import server


def _write_profile_config(home, plugins):
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text(
        yaml.safe_dump({"_config_version": 54, "plugins": plugins}, sort_keys=False),
        encoding="utf-8",
    )


def _plugins_of(home):
    data = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8")) or {}
    return data.get("plugins") or {}


def test_plugins_manage_profile_reads_that_profiles_dir(tmp_path, monkeypatch):
    # A temp profile home with one user plugin in its plugins dir.
    profile_home = tmp_path / "profiles" / "botA"
    plugin_dir = profile_home / "plugins" / "bota-only-plugin"
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "plugin.yaml").write_text(
        "name: bota-only-plugin\nversion: '1.0'\ndescription: BotA-only plugin\n",
        encoding="utf-8",
    )

    # Route the profile name the handler resolves to our temp home.
    from hermes_cli import profiles

    monkeypatch.setattr(profiles, "get_profile_dir", lambda name: profile_home)

    resp = server.handle_request(
        {
            "id": "1",
            "method": "plugins.manage",
            "params": {"action": "list", "profile": "botA"},
        }
    )

    assert "result" in resp, resp
    user_rows = [
        p for p in resp["result"]["plugins"] if p.get("source") == "user"
    ]
    assert "bota-only-plugin" in [p["name"] for p in user_rows]

    # The override must not leak: an unscoped call after this one resolves the
    # launch profile again.
    from hermes_constants import get_hermes_home_override

    assert get_hermes_home_override() is None


def test_plugins_manage_unknown_profile_errors(tmp_path, monkeypatch):
    from hermes_cli import profiles

    missing = tmp_path / "profiles" / "ghost"
    monkeypatch.setattr(profiles, "get_profile_dir", lambda name: missing)

    resp = server.handle_request(
        {
            "id": "2",
            "method": "plugins.manage",
            "params": {"action": "list", "profile": "ghost"},
        }
    )

    assert "error" in resp, resp
    assert resp["error"]["code"] == 4064


def test_plugins_manage_unscoped_still_lists(monkeypatch):
    # No profile param — the pre-existing contract is unchanged.
    resp = server.handle_request(
        {"id": "3", "method": "plugins.manage", "params": {"action": "list"}}
    )

    assert "result" in resp, resp
    assert "plugins" in resp["result"]


def test_dashboard_only_plugin_enable_is_per_profile(tmp_path, monkeypatch):
    """A dashboard-only user plugin (no agent manifest) is enabled through the same
    ``plugins.enabled`` gate, but only in the requested profile's config."""
    home_a = tmp_path / "profiles" / "botA"
    home_b = tmp_path / "profiles" / "botB"
    _write_profile_config(home_a, {"enabled": [], "disabled": []})
    _write_profile_config(home_b, {"enabled": [], "disabled": []})
    before_b = (home_b / "config.yaml").read_bytes()

    from hermes_cli import profiles
    from hermes_cli import web_server_dashboard as wsd

    monkeypatch.setattr(
        profiles, "get_profile_dir", lambda name: {"botA": home_a, "botB": home_b}[name]
    )
    # Discovery of the root-installed dashboard half (no plugin.yaml to resolve).
    monkeypatch.setattr(
        wsd,
        "_discover_dashboard_plugins",
        lambda: [{"name": "pipedream-apps", "source": "user"}],
    )

    def toggle(enable, request_id):
        return server.handle_request(
            {
                "id": request_id,
                "method": "plugins.manage",
                "params": {
                    "action": "toggle",
                    "key": "pipedream-apps",
                    "enable": enable,
                    "profile": "botA",
                },
            }
        )

    enabled = toggle(True, "1")
    assert "result" in enabled, enabled
    assert enabled["result"]["ok"] is True
    assert _plugins_of(home_a) == {"enabled": ["pipedream-apps"], "disabled": []}
    assert (home_b / "config.yaml").read_bytes() == before_b

    disabled = toggle(False, "2")
    assert "result" in disabled, disabled
    assert disabled["result"]["ok"] is True
    assert _plugins_of(home_a) == {"enabled": [], "disabled": ["pipedream-apps"]}
    assert (home_b / "config.yaml").read_bytes() == before_b
