import {
  atom,
  Badge,
  Button,
  CAPABILITIES_TABS_AREA,
  cn,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  fmtDateTime,
  GlyphSpinner,
  host,
  icons,
  SearchField,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  usePluginI18n,
  useQuery,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import * as sdk from '@hermes/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export const ID = 'pipedream-apps'
const PAGE_SIZE = 24
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000
const CONNECT_POLL_MS = 2500
const ALL_CATEGORIES = 'all'
// The Pipedream backend writes `pipedream_<slug>` MCP entries; the plugin's
// account rows already represent those apps, so the local MCP panel omits them.
const PIPEDREAM_SERVER_PREFIXES = ['pipedream_']
const NO_SESSION = atom({ activeOrganization: null, user: null })

export const LOCALES = {
  en: {
    title: 'Connectors',
    addYourOwn: 'Add your own',
    localMcpServers: 'Local MCP servers',
    all: 'All',
    onThisDevice: 'On this device',
    available: 'Available',
    search: 'Search connectors…',
    category: 'Category',
    allCategories: 'All categories',
    connect: 'Connect',
    connectAppTitle: name => `Connect ${name}`,
    preparing: 'Preparing the connection…',
    waitingTitle: name => `Finish connecting ${name}`,
    waitingBody: 'Complete the sign-in in your browser. This window updates automatically.',
    openAgain: 'Open link again',
    refreshNow: 'Refresh now',
    copyLink: 'Copy link',
    linkCopied: 'Link copied',
    cancel: 'Cancel',
    retry: 'Try again',
    connectedState: 'Connected',
    noApps: 'No connectors found',
    noAppsHint: 'Try another search or category.',
    noAccounts: 'No Pipedream apps connected yet',
    noAccountsHint: 'Browse the catalog and connect your first Pipedream app.',
    browseApps: 'Browse connectors',
    loading: 'Loading connectors…',
    errorTitle: 'Could not load connectors',
    accountsUnavailable: 'Connected accounts are temporarily unavailable.',
    unconfiguredTitle: 'Pipedream is not configured',
    unconfiguredHint:
      'The Pipedream backend is missing its baked-in project credentials. Reinstall the pipedream-apps plugin package, then restart the gateway.',
    backendTitle: 'Pipedream backend unavailable',
    backendHint: 'Install the pipedream-apps plugin package and restart the gateway.',
    previous: 'Previous',
    next: 'Next',
    page: (page, total) => `Page ${page} of ${total}`,
    appConnected: 'Connector connected',
    appConnectedMessage: () => 'Connected successfully. Tools will be available in a new chat.',
    connectFailedTitle: name => `Could not connect ${name}`,
    missingApp: 'This connector is missing a name slug.',
    disconnectTitle: name => `Disconnect ${name}?`,
    disconnectBody: 'The agent will lose access to this account. You can reconnect it later.',
    appDisconnected: 'Connector disconnected',
    accountHealthy: 'Healthy',
    accountUnhealthy: 'Needs attention',
    accountDead: 'Expired',
    reconnect: 'Reconnect',
    disconnect: 'Disconnect',
    created: date => `Added ${date}`,
    timeoutTitle: name => `Still waiting for ${name}`,
    timeoutBody: 'The connection has not completed yet. Finish the sign-in in your browser, then refresh.',
    mcpWarningTitle: 'Connector connected, tools not registered',
    mcpWarning: reason => `The connector is connected, but its tools could not be registered: ${reason}`,
    authOauth: 'OAuth',
    authKeys: 'API key',
    authNone: 'No authentication',
    unknownApp: 'Connector',
    backendDisabledTitle: 'Pipedream Apps is not enabled',
    backendDisabledBody: profile =>
      `Enable the Pipedream Apps backend for the "${profile}" profile to connect apps here. Other profiles are not affected.`,
    enableForProfile: 'Enable for this profile',
    enablingForProfile: 'Enabling…',
    backendEnabled: 'Pipedream Apps enabled',
    backendEnabledMessage: profile => `Enabled for the "${profile}" profile only.`,
    enableFailedTitle: 'Could not enable Pipedream Apps',
    enableUnavailable: 'This Desktop build cannot enable it from here. Update Unitalk Desktop, or add "pipedream-apps" to this profile\'s plugins.enabled.'
  }
}

const CSS = `
.pd-apps { display:flex; flex-direction:column; gap:0.75rem; height:100%; min-height:0; padding-block:1.25rem 0.5rem; color:var(--ui-text-primary); }
.pd-directory { display:flex; flex-direction:column; gap:0.75rem; min-height:0; flex:1; }
.pd-toolbar { display:flex; align-items:center; gap:0.5rem; }
.pd-scope-row { display:flex; justify-content:flex-end; padding-top:0.25rem; }
.pd-search-actions { display:flex; align-items:center; gap:0.375rem; flex:0 0 auto; }
.pd-search { flex:1 1 auto; min-width:0; }
.pd-toolbar .pd-category-select { flex:0 0 12rem; width:12rem; }
.pd-scroll { flex:1; min-height:0; overflow-y:auto; padding:0 0 0.5rem; }
.pd-grid { display:grid; grid-template-columns:minmax(0,1fr); gap:0.75rem; }
@media (min-width: 1080px) { .pd-grid { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } }
.pd-section-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:1.25rem; padding:var(--capabilities-gap-section) var(--capabilities-inset) var(--capabilities-gap-heading); }
.pd-section:first-child .pd-section-heading { padding-top:var(--capabilities-gap-lead); }
.pd-section-heading h2 { margin:0; font-size:1.4rem; font-weight:600; letter-spacing:-0.025em; }
.pd-section-count { margin-left:0.5rem; font-weight:400; color:var(--ui-text-tertiary); font-variant-numeric:tabular-nums; }
.pd-section-empty { padding:0 var(--capabilities-inset); }
.pd-card { position:relative; display:flex; align-items:center; gap:0.75rem; padding:0.75rem; border:1px solid var(--ui-stroke-quaternary); border-radius:0; background:var(--ui-bg-elevated); transition:background-color .15s; }
.pd-card:hover { background:var(--chrome-action-hover); }
.pd-card[data-connected="true"] { border-color:color-mix(in srgb, var(--ui-green) 35%, var(--ui-stroke-quaternary)); }
.pd-card-main { display:flex; align-items:center; gap:0.75rem; min-width:0; flex:1; border:0; background:transparent; padding:0; text-align:left; color:inherit; cursor:pointer; font:inherit; }
.pd-logo { display:grid; place-items:center; width:2.25rem; height:2.25rem; flex:0 0 auto; overflow:hidden; padding:0.2rem; border:1px solid var(--ui-stroke-quaternary); border-radius:0.5625rem; background:var(--ui-bg-primary); }
.pd-logo img { width:100%; height:100%; object-fit:contain; }
.pd-logo-fallback { font-size:0.75rem; font-weight:600; color:var(--ui-text-secondary); }
.pd-card-copy { display:flex; flex-direction:column; gap:0.1rem; min-width:0; flex:1; }
.pd-card-title { display:flex; align-items:center; gap:0.375rem; min-width:0; }
.pd-card-name { font-size:0.8125rem; font-weight:600; color:var(--ui-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pd-card-category { font-size:0.6875rem; color:var(--ui-text-tertiary); white-space:nowrap; }
.pd-card-desc { font-size:0.72rem; line-height:1.35; color:var(--ui-text-secondary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.pd-card-lane { display:flex; align-items:center; gap:0.5rem; flex:0 0 auto; }
.pd-state { display:inline-flex; align-items:center; gap:0.25rem; font-size:0.6875rem; font-weight:500; }
.pd-state[data-tone="ok"] { color:var(--ui-green); }
.pd-state[data-tone="warn"] { color:var(--ui-orange); }
.pd-state[data-tone="bad"] { color:var(--ui-red); }
.pd-skeleton { display:flex; align-items:center; gap:0.75rem; padding:0.75rem; border:1px solid var(--ui-stroke-quaternary); border-radius:0; }
.pd-skeleton-copy { display:flex; flex-direction:column; gap:0.45rem; flex:1; }
.pd-pager { display:flex; align-items:center; justify-content:space-between; gap:0.75rem; padding-top:0.75rem; }
.pd-page-label { font-size:0.75rem; color:var(--ui-text-tertiary); }
.pd-empty-stack { display:flex; flex-direction:column; align-items:center; gap:0.75rem; padding:1.5rem 0; }
.pd-notice { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; border:1px solid var(--ui-stroke-quaternary); border-radius:0.5rem; padding:0.5rem 0.75rem; font-size:0.75rem; color:var(--ui-text-secondary); background:var(--ui-bg-elevated); }
.pd-center { display:flex; align-items:center; justify-content:center; gap:0.5rem; min-height:12rem; font-size:0.8125rem; color:var(--ui-text-secondary); }
.pd-account { display:flex; align-items:center; gap:0.75rem; padding:0.75rem; border:1px solid var(--ui-stroke-quaternary); border-radius:0; background:var(--ui-bg-elevated); }
.pd-account-copy { display:flex; flex-direction:column; gap:0.1rem; flex:1; min-width:0; }
.pd-account-name { font-size:0.8125rem; font-weight:600; }
.pd-account-sub { font-size:0.72rem; color:var(--ui-text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pd-account-error { font-size:0.68rem; color:var(--ui-red); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pd-account-actions { display:flex; align-items:center; gap:0.375rem; flex:0 0 auto; flex-wrap:wrap; justify-content:flex-end; }
.pd-dialog-body { display:flex; flex-direction:column; gap:0.75rem; }
.pd-dialog-head { display:flex; align-items:center; gap:0.75rem; }
.pd-dialog-name { font-size:1rem; font-weight:600; }
.pd-dialog-desc { font-size:0.8125rem; line-height:1.5; color:var(--ui-text-secondary); }
.pd-dialog-meta { display:flex; flex-wrap:wrap; gap:0.375rem; }
.pd-wait { display:flex; flex-direction:column; align-items:center; gap:0.75rem; padding:1rem 0; text-align:center; }
.pd-wait-copy { font-size:0.8125rem; color:var(--ui-text-secondary); line-height:1.5; }
.pd-link { font-family:var(--font-mono, monospace); font-size:0.7rem; word-break:break-all; color:var(--ui-text-tertiary); background:var(--ui-bg-tertiary); border-radius:0.375rem; padding:0.5rem; }
.pd-actions { display:flex; align-items:center; justify-content:flex-end; gap:0.5rem; flex-wrap:wrap; }

/* Apps replaces the built-in Connectors tab in Capabilities. Keep the tab row
   visible at every width so the collapsed dropdown never lists Connectors. */
[data-tour="page-tabs"]:has([data-tour="tab-connectors"]) > div:first-child { display:flex !important; }
[data-tour="page-tabs"]:has([data-tour="tab-connectors"]) > div:last-child { display:none !important; }
[data-tour="tab-connectors"] { display:none !important; }
[data-tour="page-tabs"]:has([data-tour="tab-connectors"]) [data-tour="tab-pipedream-apps:apps"] { order:40; }
[data-tour="page-tabs"]:has([data-tour="tab-connectors"]) [data-tour="tab-toolsets"] { order:50; }
`

export function appSlugOf(app) {
  return app?.name_slug || app?.nameSlug || ''
}

export function accountSlugOf(account) {
  return appSlugOf(account?.app)
}

export function appNameOf(app) {
  return app?.name || appSlugOf(app)
}

export function appImageOf(app) {
  return app?.img_src || app?.imgSrc || ''
}

export function accountSubtitle(account) {
  const email = typeof account?.email === 'string' ? account.email.trim() : ''
  if (email) return email
  const name = typeof account?.name === 'string' ? account.name.trim() : ''
  return name
}

export function accountTone(account) {
  if (account?.dead) return 'bad'
  if (account?.healthy === false) return 'warn'
  return 'ok'
}

export function errorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message
  return 'Something went wrong.'
}

/** The gateway refused the plugin route because its backend is not enabled for the
 *  requested profile (the consent gate answers a deliberately generic 404). */
export function isPluginUnavailable(error) {
  const message = errorMessage(error)
  return /plugin not found/i.test(message) || /\b404\b/.test(message)
}

export function appsTabHashFor(hash) {
  return String(hash).replace(/([?&])tab=connectors(?=&|$)/, (_, prefix) => `${prefix}tab=${ID}:apps`)
}

export function createPipedreamApi(rest) {
  return {
    config: scope => rest('/config', scope ? { scope } : undefined),
    categories: () => rest('/categories'),
    apps: ({ q, limit, category, after, before } = {}) => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (limit) params.set('limit', String(limit))
      if (category) params.set('category', category)
      if (after) params.set('after', after)
      if (before) params.set('before', before)
      const query = params.toString()
      return rest(`/apps${query ? `?${query}` : ''}`)
    },
    connect: ({ appSlug, externalUserId, scope }) =>
      rest('/connect', { method: 'POST', body: { externalUserId, appSlug }, ...(scope ? { scope } : {}) }),
    accounts: (externalUserId, scope) =>
      rest(`/accounts?externalUserId=${encodeURIComponent(externalUserId)}`, scope ? { scope } : undefined),
    disconnect: ({ accountId, externalUserId, scope }) =>
      rest(`/accounts/${encodeURIComponent(accountId)}?externalUserId=${encodeURIComponent(externalUserId)}`, {
        method: 'DELETE',
        ...(scope ? { scope } : {})
      }),
    mcpEnable: ({ appSlug, externalUserId, scope }) =>
      rest('/mcp/enable', { method: 'POST', body: { externalUserId, appSlug }, ...(scope ? { scope } : {}) })
  }
}

// A Pipedream external user is scoped by the signed-in principal AND the
// Hermes profile: connections made in "default" never leak into "test1", and a
// Clerk organization change is another isolated account too. Users must be
// signed in and belong to an organization, so there is no anonymous fallback.
export function scopedExternalUserId(userId, orgId, profileName) {
  return `${userId}@${orgId}#${profileName}`
}

export function profileNameOf(profileScope) {
  const name = profileScope && typeof profileScope === 'object' ? profileScope.profile : profileScope
  return String(name ?? '').trim() || 'default'
}

function useClerkIdentity() {
  const snapshot = useValue(host.clerk?.snapshot ?? NO_SESSION)

  return {
    orgId: snapshot?.activeOrganization?.id || '',
    userId: snapshot?.user?.id || ''
  }
}

/** The route descriptor for a scope's profile, so `plugins.manage` runs on the RIGHT backend.
 *  A bare profile name is the legacy local door; a pinned (connection, profile) scope resolves
 *  through the roster. Falls back to the name so `requestProfile` reports any ambiguity itself. */
async function enableRouteForScope(scope, fallbackProfile) {
  const raw = scope ? scope.profile : fallbackProfile
  const profile = profileNameOf(raw)
  const pinned = raw && typeof raw === 'object' ? raw : null

  try {
    if (typeof host.profileRoutes === 'function') {
      const routes = await host.profileRoutes()
      const match = routes.find(
        route =>
          (!pinned || route.connectionId === pinned.connectionId) &&
          (route.profile === profile || route.targetProfile === profile)
      )
      if (match) return match
    }
  } catch {
    // Fall through to the profile string; requestProfile reports a multi-source ambiguity.
  }

  return profile
}

function initialOf(value) {
  const text = String(value || '').trim()
  return text ? text.slice(0, 1).toUpperCase() : '?'
}

function createdLabel(account) {
  if (!account?.created_at) return ''
  try {
    return fmtDateTime.format(new Date(account.created_at))
  } catch {
    return ''
  }
}

function authLabel(app, t) {
  switch (app?.auth_type) {
    case 'oauth':
      return t('authOauth')
    case 'keys':
      return t('authKeys')
    case 'none':
      return t('authNone')
    default:
      return ''
  }
}

function AppLogo({ app, className }) {
  const [failed, setFailed] = useState(false)
  const src = appImageOf(app)

  useEffect(() => {
    setFailed(false)
  }, [src])

  return jsx('span', {
    className: cn('pd-logo', className),
    children:
      src && !failed
        ? jsx('img', { alt: '', loading: 'lazy', onError: () => setFailed(true), src })
        : jsx('span', { className: 'pd-logo-fallback', children: initialOf(appNameOf(app)) })
  })
}

function AppCard({ app, connected, onOpen, onConnect }) {
  const t = usePluginI18n(ID)
  const category = Array.isArray(app?.categories) && app.categories.length > 0 ? app.categories[0] : ''

  return jsxs('div', {
    'data-connected': connected ? 'true' : 'false',
    className: 'pd-card',
    children: [
      jsxs('button', {
        className: 'pd-card-main',
        onClick: onOpen,
        type: 'button',
        children: [
          jsx(AppLogo, { app }),
          jsxs('span', {
            className: 'pd-card-copy',
            children: [
              jsxs('span', {
                className: 'pd-card-title',
                children: [
                  jsx('span', { className: 'pd-card-name', children: appNameOf(app) }),
                  category ? jsx('span', { className: 'pd-card-category', children: `· ${category}` }) : null
                ]
              }),
              app?.description ? jsx('span', { className: 'pd-card-desc', children: app.description }) : null
            ]
          })
        ]
      }),
      jsxs('span', {
        className: 'pd-card-lane',
        children: [
          connected
            ? jsxs('span', {
                className: 'pd-state',
                'data-tone': 'ok',
                children: [jsx(icons.Check, { size: 14 }), t('connectedState')]
              })
            : jsx(Button, {
                onClick: onConnect,
                size: 'xs',
                type: 'button',
                variant: 'outline',
                children: t('connect')
              })
        ]
      })
    ]
  })
}

function SkeletonCard({ index }) {
  return jsxs(
    'div',
    {
      className: 'pd-skeleton',
      children: [
        jsx(Skeleton, { className: 'h-9 w-9 rounded-[9px]' }),
        jsxs('div', {
          className: 'pd-skeleton-copy',
          children: [jsx(Skeleton, { className: 'h-2.5 w-40' }), jsx(Skeleton, { className: 'h-2 w-full' })]
        }),
        jsx(Skeleton, { className: 'h-7 w-20' })
      ]
    },
    index
  )
}

function matchesQuery(value, query) {
  const needle = query.trim().toLowerCase()
  return needle.length === 0 || value.toLowerCase().includes(needle)
}

function accountMatches(account, query) {
  return matchesQuery(appNameOf(account?.app) || '', query) || matchesQuery(appSlugOf(account?.app) || '', query)
}

function SectionHeading({ count, title }) {
  return jsx('header', {
    className: 'pd-section-heading',
    children: jsxs('h2', {
      children: [title, jsx('span', { className: 'pd-section-count', children: count })]
    })
  })
}

/** The profile picker for the states that render before the directory (a backend that is not
 *  enabled for the selected profile): the user must still be able to switch away from it. */
function ScopeSelectorRow({ scope }) {
  const ScopeSelector = sdk.CapabilityScopeSelector

  return scope && ScopeSelector
    ? jsx('div', { className: 'pd-scope-row', children: jsx(ScopeSelector, { scope }) })
    : null
}

/** A pre-directory state that keeps the profile picker reachable. */
function StatusScreen({ children, scope }) {
  return jsxs('div', {
    className: 'pd-apps capabilities-page',
    children: [jsx(ScopeSelectorRow, { scope }), children]
  })
}

export function AppsDirectory({
  accounts,
  accountsError,
  accountsPending,
  api,
  connectedSlugs,
  externalUserId,
  localMcp,
  localMcpCount,
  onAddYourOwn,
  onConnect,
  onDisconnect,
  onOpen,
  onReconnect,
  onRetryAccounts,
  scope,
  scopeSelector
}) {
  const t = usePluginI18n(ID)
  const [view, setView] = useState('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [cursor, setCursor] = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim())
      setCursor(null)
      setHistory([])
    }, 400)

    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setCursor(null)
    setHistory([])
  }, [category])

  const categoriesQuery = useQuery({
    queryKey: [ID, 'categories'],
    queryFn: () => api.categories(),
    staleTime: 24 * 60 * 60 * 1000,
    retry: false
  })

  const appsKey = [ID, 'apps', externalUserId, query, category, cursor?.after ?? '', cursor?.before ?? '']
  const appsQuery = useQuery({
    queryKey: appsKey,
    queryFn: () => api.apps({ q: query, limit: PAGE_SIZE, category, after: cursor?.after, before: cursor?.before }),
    placeholderData: previous => previous,
    retry: 1,
    staleTime: 60 * 1000
  })

  const categories = categoriesQuery.data?.categories ?? []
  const data = appsQuery.data ?? { apps: [], nextCursor: null, prevCursor: null, totalCount: 0 }
  const apps = data.apps ?? []
  const totalPages = Math.max(1, Math.ceil((data.totalCount || 0) / PAGE_SIZE))
  const page = history.length + 1
  const showPager = Boolean(data.nextCursor) || history.length > 0

  const connectedAccounts = useMemo(() => accounts.filter(account => accountMatches(account, query)), [accounts, query])
  const availableApps = useMemo(() => apps.filter(app => !connectedSlugs.has(appSlugOf(app))), [apps, connectedSlugs])
  const availableCount = Math.max(
    0,
    (data.totalCount || 0) - new Set(connectedAccounts.map(accountSlugOf).filter(Boolean)).size
  )
  const allCount = connectedAccounts.length + availableCount

  const selectCategory = next => {
    setCategory(next)
    setCursor(null)
    setHistory([])
  }

  const nextPage = () => {
    if (!data.nextCursor) return
    setHistory(previous => [...previous, cursor])
    setCursor({ after: data.nextCursor })
  }

  const previousPage = () => {
    if (history.length === 0) return
    const previous = history[history.length - 1]
    setHistory(previousHistory => previousHistory.slice(0, -1))
    setCursor(previous)
  }

  const connectedBody = accountsPending
    ? jsxs('div', {
        className: 'pd-center',
        children: [jsx(GlyphSpinner, { ariaLabel: t('loading') }), t('loading')]
      })
    : connectedAccounts.length === 0
      ? accounts.length === 0
        ? jsxs('div', {
            className: 'pd-empty-stack',
            children: [
              jsx(EmptyState, { title: t('noAccounts'), description: t('noAccountsHint') }),
              jsx(Button, {
                onClick: () => setView('available'),
                size: 'sm',
                type: 'button',
                variant: 'outline',
                children: t('browseApps')
              }),
              onAddYourOwn
                ? jsx(Button, {
                    onClick: onAddYourOwn,
                    size: 'sm',
                    type: 'button',
                    variant: 'outline',
                    children: t('addYourOwn')
                  })
                : null
            ]
          })
        : jsx('div', {
            className: 'pd-section-empty',
            children: jsx(EmptyState, { title: t('noApps'), description: t('noAppsHint') })
          })
      : jsx('div', {
          className: 'pd-grid',
          children: connectedAccounts.map(account =>
            jsx(AccountRow, { account, onDisconnect, onReconnect }, account.id)
          )
        })

  const availableBody =
    appsQuery.isPending && apps.length === 0
      ? jsx('div', {
          className: 'pd-grid',
          children: Array.from({ length: 6 }, (_, index) => jsx(SkeletonCard, { index }, index))
        })
      : appsQuery.isError
        ? jsx(ErrorState, {
            title: t('errorTitle'),
            description: errorMessage(appsQuery.error),
            children: jsx(Button, {
              onClick: () => void appsQuery.refetch(),
              size: 'sm',
              variant: 'outline',
              children: t('retry')
            })
          })
        : availableApps.length === 0
          ? jsxs('div', {
              className: 'pd-empty-stack pd-section-empty',
              children: [
                jsx(EmptyState, { title: t('noApps'), description: t('noAppsHint') }),
                onAddYourOwn
                  ? jsx(Button, {
                      onClick: onAddYourOwn,
                      size: 'sm',
                      type: 'button',
                      variant: 'outline',
                      children: t('addYourOwn')
                    })
                  : null
              ]
            })
          : jsx('div', {
              className: 'pd-grid',
              children: availableApps.map(app =>
                jsx(
                  AppCard,
                  {
                    app,
                    connected: false,
                    onConnect: () => onConnect(app),
                    onOpen: () => onOpen(app)
                  },
                  app.name_slug || app.id || app.name
                )
              )
            })

  const tabs = [
    { id: 'all', label: `${t('all')} ${allCount}` },
    { id: 'onDevice', label: `${t('onThisDevice')} ${connectedAccounts.length}` },
    { id: 'available', label: `${t('available')} ${availableCount}` }
  ]

  return jsxs('div', {
    className: 'pd-directory',
    children: [
      jsxs('div', {
        className: 'pd-toolbar',
        children: [
          jsx(SearchField, {
            containerClassName: 'pd-search h-10 w-full min-w-0 rounded-2xl bg-(--dt-card) py-0',
            leadingContent: jsx(Badge, { size: 'xs', variant: 'muted', children: t('title') }),
            trailingAction:
              (view !== 'onDevice' && categories.length > 0) || onAddYourOwn
                ? jsxs('span', {
                    className: 'pd-search-actions',
                    children: [
                      view !== 'onDevice' && categories.length > 0
                        ? jsxs(Select, {
                            value: category || ALL_CATEGORIES,
                            onValueChange: value => selectCategory(value === ALL_CATEGORIES ? '' : value),
                            children: [
                              jsx(SelectTrigger, {
                                'aria-label': t('category'),
                                className: 'pd-category-select',
                                size: 'sm',
                                children: jsx(SelectValue, { placeholder: t('allCategories') })
                              }),
                              jsxs(SelectContent, {
                                children: [
                                  jsx(SelectItem, { value: ALL_CATEGORIES, children: t('allCategories') }),
                                  ...categories.map(item =>
                                    jsx(SelectItem, { value: item.id, children: item.name }, item.id)
                                  )
                                ]
                              })
                            ]
                          })
                        : null,
                      onAddYourOwn
                        ? jsx(Button, {
                            onClick: onAddYourOwn,
                            size: 'xs',
                            type: 'button',
                            variant: 'outline',
                            children: t('addYourOwn')
                          })
                        : null
                    ]
                  })
                : undefined,
            loading: appsQuery.isFetching && Boolean(appsQuery.data),
            onChange: setSearch,
            placeholder: t('search'),
            value: search,
            variant: 'box'
          }),
          scope && scopeSelector ? jsx(scopeSelector, { scope }) : null
        ]
      }),
      jsx(SegmentedControl, {
        onChange: setView,
        options: tabs,
        sizing: 'content',
        value: view
      }),
      accountsError
        ? jsxs('div', {
            className: 'pd-notice',
            children: [
              jsx('span', { children: t('accountsUnavailable') }),
              jsx(Button, {
                onClick: onRetryAccounts,
                size: 'xs',
                type: 'button',
                variant: 'outline',
                children: t('retry')
              })
            ]
          })
        : null,
      jsxs('div', {
        className: 'pd-scroll',
        children: [
          view !== 'available' && (view === 'onDevice' || connectedAccounts.length > 0)
            ? jsxs('section', {
                className: 'pd-section',
                children: [
                  jsx(SectionHeading, { count: connectedAccounts.length, title: t('onThisDevice') }),
                  connectedBody
                ]
              })
            : null,
          localMcp && view !== 'available'
            ? jsxs('section', {
                className: 'pd-section',
                children: [
                  localMcpCount > 0
                    ? jsx(SectionHeading, { count: localMcpCount, title: t('localMcpServers') })
                    : null,
                  jsx(localMcp.Panel, { ...localMcp.props, query })
                ]
              })
            : null,
          view !== 'onDevice'
            ? jsxs('section', {
                className: 'pd-section',
                children: [
                  jsx(SectionHeading, { count: availableCount, title: t('available') }),
                  availableBody,
                  showPager && !appsQuery.isError && apps.length > 0
                    ? jsxs('div', {
                        className: 'pd-pager',
                        children: [
                          jsx(Button, {
                            disabled: history.length === 0,
                            onClick: previousPage,
                            size: 'sm',
                            type: 'button',
                            variant: 'outline',
                            children: t('previous')
                          }),
                          totalPages > 1
                            ? jsx('span', { className: 'pd-page-label', children: t('page', page, totalPages) })
                            : null,
                          jsx(Button, {
                            disabled: !data.nextCursor,
                            onClick: nextPage,
                            size: 'sm',
                            type: 'button',
                            variant: 'outline',
                            children: t('next')
                          })
                        ]
                      })
                    : null
                ]
              })
            : null
        ]
      })
    ]
  })
}

function AccountRow({ account, onReconnect, onDisconnect }) {
  const t = usePluginI18n(ID)
  const tone = accountTone(account)
  const stateLabel = t(tone === 'bad' ? 'accountDead' : tone === 'warn' ? 'accountUnhealthy' : 'accountHealthy')
  const created = createdLabel(account)
  const subtitle = accountSubtitle(account)
  const app = account?.app
  const name = appNameOf(app) || t('unknownApp')

  return jsxs('div', {
    className: 'pd-account',
    children: [
      jsx(AppLogo, { app }),
      jsxs('div', {
        className: 'pd-account-copy',
        children: [
          jsxs('div', {
            className: 'pd-card-title',
            children: [
              jsx('span', { className: 'pd-account-name', children: name }),
              jsx(Badge, {
                size: 'xs',
                variant: tone === 'ok' ? 'success' : tone === 'warn' ? 'warn' : 'destructive',
                children: stateLabel
              })
            ]
          }),
          subtitle ? jsx('div', { className: 'pd-account-sub', children: subtitle }) : null,
          account?.error ? jsx('div', { className: 'pd-account-error', children: account.error }) : null,
          created ? jsx('div', { className: 'pd-account-sub', children: t('created', created) }) : null
        ]
      }),
      jsxs('div', {
        className: 'pd-account-actions',
        children: [
          tone !== 'ok'
            ? jsx(Button, {
                onClick: () => onReconnect(account),
                size: 'xs',
                type: 'button',
                variant: 'outline',
                children: t('reconnect')
              })
            : null,
          jsx(Button, {
            onClick: () => onDisconnect(account),
            size: 'xs',
            type: 'button',
            variant: 'outline',
            children: t('disconnect')
          })
        ]
      })
    ]
  })
}

export function AppDetailsDialog({ app, connected, onClose, onConnect }) {
  const t = usePluginI18n(ID)
  const auth = authLabel(app, t)

  return jsx(Dialog, {
    open: true,
    onOpenChange: open => {
      if (!open) onClose()
    },
    children: jsxs(DialogContent, {
      className: 'sm:max-w-md',
      children: [
        jsx(DialogHeader, {
          children: jsx(DialogTitle, {
            className: 'sr-only',
            children: appNameOf(app)
          })
        }),
        jsxs('div', {
          className: 'pd-dialog-body',
          children: [
            jsxs('div', {
              className: 'pd-dialog-head',
              children: [jsx(AppLogo, { app }), jsx('span', { className: 'pd-dialog-name', children: appNameOf(app) })]
            }),
            app?.description ? jsx('p', { className: 'pd-dialog-desc', children: app.description }) : null,
            jsxs('div', {
              className: 'pd-dialog-meta',
              children: [
                ...(Array.isArray(app?.categories)
                  ? app.categories.map((category, index) =>
                      jsx(Badge, { size: 'xs', variant: 'muted', children: category }, `${category}-${index}`)
                    )
                  : []),
                auth ? jsx(Badge, { size: 'xs', variant: 'outline', children: auth }) : null,
                connected ? jsx(Badge, { size: 'xs', variant: 'success', children: t('connectedState') }) : null
              ]
            })
          ]
        }),
        jsxs(DialogFooter, {
          children: [
            jsx(Button, {
              onClick: onClose,
              type: 'button',
              variant: 'outline',
              children: t('cancel')
            }),
            connected
              ? null
              : jsx(Button, {
                  onClick: onConnect,
                  type: 'button',
                  children: t('connect')
                })
          ]
        })
      ]
    })
  })
}

export function ConnectDialog({ app, api, externalUserId, openExternal, copyText, onClose, onConnected, scope }) {
  const t = usePluginI18n(ID)
  const slug = appSlugOf(app)
  const name = appNameOf(app)
  const [status, setStatus] = useState('starting')
  const [error, setError] = useState('')
  const [failureKind, setFailureKind] = useState('connect')
  const [link, setLink] = useState('')
  const [deadline, setDeadline] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const tabRef = useRef(null)

  const closeTab = useCallback(() => {
    const tab = tabRef.current
    tabRef.current = null
    if (tab && !tab.closed) tab.close()
  }, [])

  const openConnectTab = useCallback(
    url => {
      closeTab()

      // Only the browser-hosted desktop can close the tab it opened. Electron
      // hands the link to the system browser, which the app cannot reach.
      if (document.documentElement.dataset.hermesDesktopHost === 'browser') {
        const tab = window.open(url, '_blank')
        if (tab) {
          tab.opener = null
          tabRef.current = tab
          return
        }
      }

      void openExternal(url)
    },
    [closeTab, openExternal]
  )

  useEffect(() => () => closeTab(), [closeTab])

  useEffect(() => {
    if (!slug) {
      setFailureKind('connect')
      setStatus('error')
      setError(t('missingApp'))
      return undefined
    }

    let disposed = false

    closeTab()
    setStatus('starting')
    setFailureKind('connect')
    setError('')
    setLink('')
    setDeadline(0)

    void (async () => {
      try {
        const result = await api.connect({ appSlug: slug, externalUserId, scope })
        if (disposed) return
        setLink(result.connectLinkUrl)
        setDeadline(Date.now() + CONNECT_TIMEOUT_MS)
        setStatus('waiting')
        openConnectTab(result.connectLinkUrl)
      } catch (nextError) {
        if (disposed) return
        setFailureKind('connect')
        setError(errorMessage(nextError))
        setStatus('error')
      }
    })()

    return () => {
      disposed = true
    }
  }, [api, attempt, closeTab, externalUserId, openConnectTab, scope, slug, t])

  const checkAccounts = useCallback(async () => {
    try {
      const accounts = await api.accounts(externalUserId, scope)
      const match = accounts.find(account => accountSlugOf(account) === slug)
      if (match) {
        closeTab()
        onConnected(slug, name)
        return true
      }
      return false
    } catch {
      return false
    }
  }, [api, closeTab, externalUserId, name, onConnected, scope, slug])

  useEffect(() => {
    if (status !== 'waiting' || !deadline) return undefined

    let disposed = false

    const tick = async () => {
      const found = await checkAccounts()
      if (disposed || found) return
      if (Date.now() > deadline) {
        setFailureKind('timeout')
        setStatus('error')
        setError(t('timeoutBody'))
      }
    }

    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, CONNECT_POLL_MS)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [checkAccounts, deadline, status, t])

  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const refreshNow = () => {
    setRefreshing(true)
    void checkAccounts().finally(() => setRefreshing(false))
  }

  const copyLink = async () => {
    const result = await copyText(link)
    if (result !== false) setCopied(true)
  }

  return jsx(Dialog, {
    open: true,
    onOpenChange: open => {
      if (!open) onClose()
    },
    children: jsxs(DialogContent, {
      className: 'sm:max-w-md',
      children: [
        jsx(DialogHeader, {
          children: jsx(DialogTitle, {
            children:
              status === 'error'
                ? failureKind === 'timeout'
                  ? t('timeoutTitle', name)
                  : t('connectFailedTitle', name)
                : status === 'waiting'
                  ? t('waitingTitle', name)
                  : t('connectAppTitle', name)
          })
        }),
        status === 'starting'
          ? jsxs('div', {
              className: 'pd-wait',
              children: [
                jsx(GlyphSpinner, { ariaLabel: t('preparing') }),
                jsx('span', { className: 'pd-wait-copy', children: t('preparing') })
              ]
            })
          : status === 'waiting'
            ? jsxs('div', {
                className: 'pd-wait',
                children: [
                  jsx(GlyphSpinner, { ariaLabel: t('waitingTitle', name) }),
                  jsx('span', { className: 'pd-wait-copy', children: t('waitingBody') }),
                  link ? jsx('div', { className: 'pd-link', children: link }) : null
                ]
              })
            : jsx(ErrorState, {
                title: failureKind === 'timeout' ? t('timeoutTitle', name) : t('connectFailedTitle', name),
                description: error,
                children: jsxs('div', {
                  className: 'pd-actions',
                  children: [
                    link
                      ? jsx(Button, {
                          onClick: () => openConnectTab(link),
                          size: 'sm',
                          type: 'button',
                          variant: 'outline',
                          children: t('openAgain')
                        })
                      : null,
                    link && copyText
                      ? jsx(Button, {
                          onClick: () => void copyLink(),
                          size: 'sm',
                          type: 'button',
                          variant: 'outline',
                          children: copied ? t('linkCopied') : t('copyLink')
                        })
                      : null,
                    jsx(Button, {
                      onClick: () => setAttempt(value => value + 1),
                      size: 'sm',
                      type: 'button',
                      variant: 'outline',
                      children: t('retry')
                    })
                  ]
                })
              }),
        jsxs(DialogFooter, {
          children: [
            jsx(Button, {
              onClick: onClose,
              type: 'button',
              variant: 'outline',
              children: t('cancel')
            }),
            status === 'waiting'
              ? jsxs('div', {
                  className: 'pd-actions',
                  children: [
                    link
                      ? jsx(Button, {
                          onClick: () => openConnectTab(link),
                          size: 'sm',
                          type: 'button',
                          variant: 'outline',
                          children: t('openAgain')
                        })
                      : null,
                    copyText
                      ? jsx(Button, {
                          onClick: () => void copyLink(),
                          size: 'sm',
                          type: 'button',
                          variant: 'outline',
                          children: copied ? t('linkCopied') : t('copyLink')
                        })
                      : null,
                    jsx(Button, {
                      loading: refreshing,
                      onClick: refreshNow,
                      size: 'sm',
                      type: 'button',
                      children: t('refreshNow')
                    })
                  ]
                })
              : null
          ]
        })
      ]
    })
  })
}

export function PipedreamAppsTab({ api, openExternal, copyText, scope, toast }) {
  const t = usePluginI18n(ID)
  const { orgId, userId } = useClerkIdentity()
  const activeProfile = useValue(host.state.profile)
  const queryClient = useQueryClient()
  const [selectedApp, setSelectedApp] = useState(null)
  const [connectTarget, setConnectTarget] = useState(null)
  const [disconnectTarget, setDisconnectTarget] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [enabling, setEnabling] = useState(false)

  // Signed-in principal + profile scope. No anonymous fallback: the tab waits
  // for Clerk rather than inventing an id that would outlive the account.
  const identityReady = Boolean(userId && orgId)
  const profileKey = profileNameOf(scope ? scope.profile : activeProfile)
  const scopeKey = scope?.key ?? profileKey
  const externalUserId = identityReady ? scopedExternalUserId(userId, orgId, profileKey) : ''
  const apiScope = scope ? scope.profile : undefined

  // A cross-backend scope has no live socket on this window's gateway; the MCP
  // panels withhold it exactly like the built-in Connectors tab does.
  const gateway = typeof host.getGateway === 'function' ? host.getGateway() : null
  const scopedGateway = scope?.crossBackend ? null : gateway
  const localMcpProfile = scope ? scope.profile : activeProfile

  // The exact old Connectors "Add your own" dialog, opened directly. The
  // namespace read keeps the plugin loadable on older builds that do not ship
  // the export; the button just stays hidden there.
  const AddCustomMcpDialog = sdk.AddCustomMcpDialog
  const canAddCustomMcp = Boolean(AddCustomMcpDialog) && typeof host.getGateway === 'function'
  const ScopeSelector = sdk.CapabilityScopeSelector
  const canEnableBackend = typeof host.requestProfile === 'function'

  // The installed local servers as the real old Connectors cards. The
  // Pipedream-managed `pipedream_<slug>` entries stay out: the account rows
  // below already stand for them.
  const [localMcpCount, setLocalMcpCount] = useState(0)
  const LocalMcpServersPanel = sdk.LocalMcpServersPanel
  const canShowLocalMcp = Boolean(LocalMcpServersPanel) && typeof host.getGateway === 'function'
  const localMcp = canShowLocalMcp
    ? {
        Panel: LocalMcpServersPanel,
        props: {
          excludePrefixes: PIPEDREAM_SERVER_PREFIXES,
          gateway: scopedGateway,
          onCountChange: setLocalMcpCount,
          profile: localMcpProfile
        }
      }
    : null

  const configQuery = useQuery({
    queryKey: [ID, 'config', scopeKey],
    queryFn: () => api.config(apiScope),
    retry: false,
    staleTime: 5 * 60 * 1000
  })

  const configured = configQuery.data?.configured === true

  // A profile/org/user change is a different set of connected accounts; dialogs
  // opened for the previous scope must not complete against the new one.
  useEffect(() => {
    setSelectedApp(null)
    setConnectTarget(null)
    setDisconnectTarget(null)
  }, [externalUserId, scopeKey])

  const accountsQuery = useQuery({
    queryKey: [ID, 'accounts', scopeKey, externalUserId],
    queryFn: () => api.accounts(externalUserId, apiScope),
    enabled: configured && identityReady,
    refetchOnWindowFocus: true,
    staleTime: 15 * 1000
  })

  const accounts = accountsQuery.data ?? []
  const connectedSlugs = useMemo(() => new Set(accounts.map(accountSlugOf).filter(Boolean)), [accounts])

  const refreshAccounts = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [ID, 'accounts'] }),
    [queryClient]
  )

  const handleConnected = useCallback(
    async (appSlug, appName) => {
      setConnectTarget(null)
      setSelectedApp(null)
      toast.success(t('appConnected'), t('appConnectedMessage', appName))
      void refreshAccounts()

      if (!configQuery.data?.mcpBaseUrl) return

      try {
        await api.mcpEnable({ appSlug, externalUserId, scope: apiScope })
      } catch (error) {
        toast.warning(t('mcpWarningTitle'), t('mcpWarning', errorMessage(error)))
      }
    },
    [api, apiScope, configQuery.data?.mcpBaseUrl, externalUserId, refreshAccounts, t, toast]
  )

  const connectedCallback = useCallback(
    (appSlug, appName) => {
      void handleConnected(appSlug, appName)
    },
    [handleConnected]
  )

  // Explicit consent for a profile whose backend is installed but not enabled. The toggle runs
  // on the SELECTED profile's backend, so only that profile's config changes.
  const enableBackend = useCallback(async () => {
    if (enabling) return

    setEnabling(true)

    try {
      const route = await enableRouteForScope(scope, activeProfile)

      const result = await host.requestProfile(route, 'plugins.manage', {
        action: 'toggle',
        enable: true,
        key: ID
      })
      if (result && result.ok === false) {
        throw new Error(result.error || t('enableFailedTitle'))
      }
      await queryClient.invalidateQueries({ queryKey: [ID, 'config'] })
      toast.success(t('backendEnabled'), t('backendEnabledMessage', profileKey))
    } catch (error) {
      toast.warning(t('enableFailedTitle'), errorMessage(error))
    } finally {
      setEnabling(false)
    }
  }, [activeProfile, enabling, profileKey, queryClient, scope, t, toast])

  if (configQuery.isPending) {
    return jsxs('div', {
      className: 'pd-center',
      children: [jsx(GlyphSpinner, { ariaLabel: t('loading') }), t('loading')]
    })
  }

  if (configQuery.isError) {
    if (isPluginUnavailable(configQuery.error)) {
      return jsx(StatusScreen, {
        scope,
        children: jsxs('div', {
          className: 'pd-empty-stack',
          children: [
            jsx(EmptyState, { title: t('backendDisabledTitle'), description: t('backendDisabledBody', profileKey) }),
            canEnableBackend
              ? jsx(Button, {
                  disabled: enabling,
                  loading: enabling,
                  onClick: () => void enableBackend(),
                  size: 'sm',
                  type: 'button',
                  children: enabling ? t('enablingForProfile') : t('enableForProfile')
                })
              : jsx('p', { className: 'pd-dialog-desc', children: t('enableUnavailable') }),
            jsx(Button, {
              onClick: () => void configQuery.refetch(),
              size: 'sm',
              type: 'button',
              variant: 'outline',
              children: t('retry')
            })
          ]
        })
      })
    }

    return jsx(StatusScreen, {
      scope,
      children: jsxs('div', {
        className: 'pd-empty-stack',
        children: [
          jsx(EmptyState, { title: t('backendTitle'), description: t('backendHint') }),
          jsx(Button, {
            onClick: () => void configQuery.refetch(),
            size: 'sm',
            type: 'button',
            variant: 'outline',
            children: t('retry')
          })
        ]
      })
    })
  }

  if (!configured) {
    return jsx(StatusScreen, {
      scope,
      children: jsxs('div', {
        className: 'pd-empty-stack',
        children: [
          jsx(EmptyState, { title: t('unconfiguredTitle'), description: t('unconfiguredHint') }),
          jsx(Button, {
            onClick: () => void configQuery.refetch(),
            size: 'sm',
            type: 'button',
            variant: 'outline',
            children: t('retry')
          })
        ]
      })
    })
  }

  if (!identityReady) {
    return jsx(StatusScreen, {
      scope,
      children: jsxs('div', {
        className: 'pd-center',
        children: [jsx(GlyphSpinner, { ariaLabel: t('loading') }), t('loading')]
      })
    })
  }

  const accountsError = accountsQuery.isError ? accountsQuery.error : null

  return jsxs('div', {
    className: 'pd-apps capabilities-page',
    children: [
      jsx(AppsDirectory, {
        key: externalUserId,
        accounts,
        accountsError,
        accountsPending: accountsQuery.isPending,
        api,
        connectedSlugs,
        externalUserId,
        localMcp,
        localMcpCount,
        onAddYourOwn: canAddCustomMcp ? () => setAddOpen(true) : null,
        onConnect: setConnectTarget,
        onDisconnect: setDisconnectTarget,
        onOpen: setSelectedApp,
        onReconnect: account =>
          setConnectTarget(account?.app ?? { name_slug: appSlugOf(account), name: appNameOf(account?.app) }),
        onRetryAccounts: () => void accountsQuery.refetch(),
        scope,
        scopeSelector: ScopeSelector
      }),
      selectedApp
        ? jsx(AppDetailsDialog, {
            app: selectedApp,
            connected: connectedSlugs.has(appSlugOf(selectedApp)),
            onClose: () => setSelectedApp(null),
            onConnect: () => {
              setConnectTarget(selectedApp)
              setSelectedApp(null)
            }
          })
        : null,
      connectTarget
        ? jsx(ConnectDialog, {
            api,
            app: connectTarget,
            copyText,
            externalUserId,
            onClose: () => setConnectTarget(null),
            onConnected: connectedCallback,
            openExternal,
            scope: apiScope
          })
        : null,
      addOpen && canAddCustomMcp
        ? jsx(AddCustomMcpDialog, {
            gateway: scopedGateway,
            onOpenChange: setAddOpen,
            open: true,
            profile: localMcpProfile
          })
        : null,
      jsx(ConfirmDialog, {
        confirmLabel: t('disconnect'),
        description: t('disconnectBody'),
        destructive: true,
        onClose: () => setDisconnectTarget(null),
        onConfirm: async () => {
          if (!disconnectTarget) return
          await api.disconnect({ accountId: disconnectTarget.id, externalUserId, scope: apiScope })
          await refreshAccounts()
          toast.success(
            t('appDisconnected'),
            appNameOf(disconnectTarget.app) || accountSubtitle(disconnectTarget) || t('unknownApp')
          )
        },
        open: disconnectTarget !== null,
        title: t(
          'disconnectTitle',
          appNameOf(disconnectTarget?.app) || accountSubtitle(disconnectTarget) || t('unknownApp')
        )
      })
    ]
  })
}

const useCapabilityScope = sdk.useCapabilityScope

/** Plugin-contributed tabs own their own profile scope (core withholds the
 *  page's selector from them). Read the roster once here and hand the selected
 *  scope to the tab; builds without the SDK export render it unscoped. */
function ScopedPipedreamAppsPage(props) {
  const scope = useCapabilityScope({})

  return jsx(PipedreamAppsTab, { ...props, scope })
}

export default {
  id: ID,
  name: 'Pipedream Apps',
  description: 'Browse Pipedream connectors and manage connected accounts from Capabilities.',
  register(ctx) {
    ctx.i18n.register(LOCALES)

    const style = document.createElement('style')
    style.dataset.plugin = ID
    style.textContent = CSS
    document.head.append(style)
    ctx.onDispose(() => style.remove())

    const showAppsForConnectors = () => {
      const current = window.location.hash
      const next = appsTabHashFor(current)

      if (next !== current) host.navigate(next)
    }

    showAppsForConnectors()
    ctx.addEventListener(window, 'hashchange', showAppsForConnectors)

    const api = createPipedreamApi(ctx.rest)
    const toast = {
      success: (title, message) => host.notify({ kind: 'success', message, title }),
      warning: (title, message) => host.notify({ kind: 'warning', message, title })
    }
    const AppsPage =
      typeof sdk.useCapabilityScope === 'function' && typeof sdk.CapabilityScopeSelector === 'function'
        ? ScopedPipedreamAppsPage
        : PipedreamAppsTab

    ctx.register({
      area: CAPABILITIES_TABS_AREA,
      id: 'apps',
      order: 100,
      render: () =>
        jsx(AppsPage, {
          api,
          copyText: text => ctx.os.writeClipboard(text),
          openExternal: url => ctx.os.openExternal(url),
          toast
        }),
      title: ctx.i18n.t('title')
    })
  }
}
