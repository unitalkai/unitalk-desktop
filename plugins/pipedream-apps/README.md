# Pipedream Apps

A Desktop **Capabilities → Apps** tab backed by Pipedream Connect, shipped as two
independent halves:

| Half | Path | Responsibility |
| --- | --- | --- |
| Desktop plugin | `desktop-plugins/pipedream-apps/plugin.js` | App catalog, search, categories, Connect dialogs, connected accounts |
| Backend | `plugins/pipedream-apps/dashboard/plugin_api.py` | Project OAuth token, Connect token minting, app/account proxy, ownership-checked delete |

The renderer never receives the Pipedream client secret or the server OAuth access
token. It only receives the short-lived Connect Link it opens in the browser.

## Configuration

The project credentials and MCP proxy base are baked into the backend as module
constants in `dashboard/plugin_api.py` (`_CLIENT_ID`, `_CLIENT_SECRET`,
`_PROJECT_ID`, `_ENVIRONMENT`, `_MCP_BASE`). No gateway environment or `.env`
entry is required, so source and the production Docker image behave the same.

`_MCP_BASE` is a base app URL (e.g. `https://agent.unitalk.ai`) from which the
`.../api/pipedream/mcp` prefix is derived. When set, a successful connect ensures
`pipedream_<slug>` exists and is enabled through the Dashboard MCP API
(`POST /api/mcp/servers`, `PUT /api/mcp/servers/{name}/enabled`). Disconnecting
the last account for an app disables that entry instead of deleting it. There is
no live reload: the change applies on the next session or gateway restart.

## Install

Run the gateway from this checkout (the backend is discovered as a bundled plugin), or
install both halves into the Hermes home:

```powershell
Copy-Item -Recurse plugins\pipedream-apps "$env:LOCALAPPDATA\hermes\plugins\pipedream-apps"
Copy-Item -Recurse desktop-plugins\pipedream-apps "$env:LOCALAPPDATA\hermes\desktop-plugins\pipedream-apps"
```

The backend is installed **once** in the Hermes root (`<HERMES_HOME>/plugins`) and is
discovered for every profile; never copy it into a profile's own `plugins/` directory.
User-source plugins are consent-gated per profile through `plugins.enabled`, so a
freshly created profile must enable it once. The Apps tab shows **Enable for this
profile** when the selected profile has not done so; that toggle writes only that
profile's `config.yaml` and affects no other profile. The manual equivalent is:

```yaml
# <HERMES_HOME>/profiles/<profile>/config.yaml
plugins:
  enabled:
    - pipedream-apps
```

The Desktop half is enabled by default; disable it in **Capabilities → Plugins** if
needed.

The Apps tab requires the Desktop core build that includes the
`capabilities.tabs` contribution area. Rebuild/relaunch Desktop after updating.

## Backend routes

Mounted under `/api/plugins/pipedream-apps/` and authenticated by the gateway:

- `GET /config` → `{ configured, environment, mcpBaseUrl }` (no secrets)
- `GET /apps?q=&limit=&after=&before=&category=` → one page of the full Pipedream
  app catalog (including apps without actions/triggers) + cursors
- `GET /categories`
- `GET /apps/{slug}`
- `POST /connect` `{ externalUserId, appSlug }` → `{ token, connectLinkUrl, expiresAt }`
- `POST /mcp/enable` `{ externalUserId, appSlug }` → ensures `pipedream_<slug>` exists and is
  enabled via the Dashboard MCP API; replaces a stale plugin-owned URL, never touches a
  foreign same-name entry
- `GET /accounts?externalUserId=` → safe accounts (credentials stripped)
- `DELETE /accounts/{accountId}?externalUserId=` → ownership check, then delete; disables
  `pipedream_<slug>` when this was the last account for that app

## Identity

The Desktop plugin scopes every Pipedream external user to the signed-in principal
and the Hermes profile: `userId@orgId#profileName` (the profile name is included even
for `default`). Both ids come from the Clerk snapshot; users must be signed in and
belong to an organization, so there is no anonymous or UUID fallback. Connections made
in one profile or Clerk organization never appear in another. The MCP URL built by
`/mcp/enable` embeds the same id, so its tools resolve to the matching account.

## Verification

```sh
scripts/run_tests.sh tests/plugins/test_pipedream_apps_api.py
pnpm --filter unitalk-desktop typecheck
pnpm --filter unitalk-desktop lint
pnpm --filter unitalk-desktop test:ui
```

Manual: configure the env vars, install both halves, restart the gateway/Desktop, open
**Capabilities → Apps**, search/connect an app, finish the browser sign-in, confirm the
account appears, and disconnect it.
