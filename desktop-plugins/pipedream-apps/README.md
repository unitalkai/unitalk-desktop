# Pipedream Apps (Desktop plugin)

Adds a **Connectors** tab backed by the Pipedream apps catalog to
**Capabilities**, replacing the built-in Connectors tab. Old `?tab=connectors`
links open it instead. It is a runtime plugin — copy the folder, no app rebuild
for the plugin itself:

```powershell
Copy-Item -Recurse desktop-plugins\pipedream-apps "$env:LOCALAPPDATA\hermes\desktop-plugins\pipedream-apps"
```

On Linux/macOS the Hermes home is `~/.hermes` unless `HERMES_HOME` overrides it.

The tab needs the Desktop core build that includes the `capabilities.tabs`
contribution area, and the `pipedream-apps` Python backend installed **once** in
the Hermes root (`<HERMES_HOME>/plugins/pipedream-apps`) and enabled per profile.

## Enabling the backend per profile

The backend is a user-source dashboard plugin. It is discovered from the Hermes
root for every profile, so it never needs copying into a profile's own
`plugins/` directory. Consent is per profile, however: a freshly created profile
has no `plugins.enabled` entry yet, and its requests are refused until it does.

When the selected profile's backend is not enabled, the tab shows **Enable for
this profile**. That action calls `plugins.manage toggle` on the selected
profile's backend and writes only that profile's `config.yaml`
(`plugins.enabled`). No other profile's config, connections or MCP entries change.

Manual equivalent:

```yaml
# <HERMES_HOME>/profiles/<profile>/config.yaml
plugins:
  enabled:
    - pipedream-apps
```

## Configuration

The project credentials and MCP proxy base are baked into the backend as module
constants in `plugins/pipedream-apps/dashboard/plugin_api.py`, so no gateway
environment or `~/.hermes/.env` entry is required. The configured `_MCP_BASE`
enables MCP server configuration after a successful connect.

## Behaviour

- Browses Pipedream Connect apps with search, category filters and cursor pagination.
- Connect opens the Pipedream Connect Link in a new tab (the system browser in
  Electron) and polls until the account appears. In the browser-hosted app the
  tab is closed automatically once the account appears or the dialog is
  cancelled; Electron cannot close a system-browser tab.
- Lists connected accounts, shows health/errors, reconnects or disconnects.
- **Add your own** opens the built-in custom MCP dialog directly (the same one
  the old Connectors tab used), with no page or tab redirect. Builds without the
  SDK's `AddCustomMcpDialog` export hide the button.
- Installed local MCP servers appear beside the Pipedream accounts under **On
  this device** and **All** as the old Connectors cards (on/off, authenticate,
  tools/logs/mcp.json, remove). The Pipedream-managed `pipedream_<slug>` entries
  are omitted so each app appears only once. Builds without the SDK's
  `LocalMcpServersPanel` export hide the section.
- Scopes every Pipedream external user by the signed-in principal and the Hermes
  profile: `userId@orgId#profileName`. Connections and MCP entries made in one
  profile (or Clerk organization) never appear in another; there is no anonymous
  fallback.
- Shows the Capabilities profile selector at the top right of the tab so another
  profile's connectors can be viewed and managed without changing the app's
  active profile. The selected scope rides on every connect/accounts/disconnect/
  MCP-enable call. Builds without the SDK's `useCapabilityScope` /
  `CapabilityScopeSelector` exports hide the selector; connections still follow
  the active profile.
- After a connect, calls the plugin backend (`POST /mcp/enable`), which configures
  `pipedream_<slug>` through the Dashboard MCP API **in the selected profile's
  config**, with the profile-scoped external-user URL. Disconnecting the last
  account for an app disables the entry instead of deleting it. There is no live
  reload; tools become available in a new chat/session.
- Replaces the built-in Capabilities Connectors tab: the row always shows Skills,
  Plugins, Connectors, Tools, and `?tab=connectors` links open this catalog.

Enable/disable it in **Capabilities → Plugins**; it ships on by default.
