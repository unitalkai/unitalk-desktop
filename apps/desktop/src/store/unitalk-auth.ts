import { atom } from 'nanostores'

/**
 * Clerk Electron SDK integration for Unitalk Desktop.
 *
 * Instead of a localhost callback server or custom OAuth plumbing, we
 * open the system browser (or an Electron BrowserWindow) that loads the
 * Clerk-hosted sign-in page (clerk.unitalk.ai).  Clerk handles the full
 * OAuth flow (Google, Microsoft, email) and redirects to a custom
 * protocol URL:
 *
 *   unitalk://callback?token=<clerk_session_jwt>
 *
 * The Electron main process already intercepts unitalk:// deeplinks
 * (see electron/main.ts → DEEPLINK_SCHEMES) and forwards the token to
 * the renderer via the 'unitalk-oauth-callback' IPC channel.
 *
 * This module listens for that IPC event, persists the token, and
 * exposes atoms that the rest of the app can subscribe to.
 */

// ── Constants ────────────────────────────────────────────────────────

const CLERK_TOKEN_KEY = 'unitalk-clerk-token'

/** Clerk publishable key – identifies the Unitalk Clerk instance. */
const CLERK_PUBLISHABLE_KEY = 'pk_live_Y2xlcmsudW5pdGFsay5haSQ'

/** Base URL of the Clerk-hosted sign-in page. */
const CLERK_SIGN_IN_URL = 'https://clerk.unitalk.ai/sign-in'

/**
 * After sign-in, Clerk will redirect the browser to this URL with the
 * session token as a query parameter.  Electron's deeplink handler
 * forwards it to us via IPC.
 */
const CLERK_REDIRECT_URL = 'unitalk://callback'

// ── Atoms (reactive state) ──────────────────────────────────────────

/** True when a Clerk session JWT is stored (does NOT validate expiry). */
export const $isAuthenticated = atom<boolean>(hasClerkToken())

/** Email extracted from the stored Clerk JWT payload, or null. */
export const $userEmail = atom<null | string>(readEmailFromToken())

// ── Token helpers ────────────────────────────────────────────────────

function hasClerkToken(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(CLERK_TOKEN_KEY) !== null
  } catch {
    return false
  }
}

function readClerkToken(): null | string {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(CLERK_TOKEN_KEY) : null
  } catch {
    return null
  }
}

function readEmailFromToken(): null | string {
  const token = readClerkToken()
  if (!token) return null

  try {
    const segments = token.split('.')
    if (segments.length !== 3) return null
    const payload = JSON.parse(atob(segments[1]))
    return typeof payload.email === 'string' ? payload.email : null
  } catch {
    return null
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Open the Clerk sign-in page in the system browser.
 *
 * The sign-in URL includes:
 *   - after_sign_in_url  → where Clerk redirects after success
 *   - after_sign_up_url  → same for new accounts
 *   - redirect_url       → the custom protocol the Desktop listens on
 *
 * Clerk handles the full OAuth flow (Google, Microsoft, email/password).
 * No localhost server, no manual token exchange – just open the URL and
 * wait for the IPC callback.
 */
export async function startClerkAuth(): Promise<void> {
  const params = new URLSearchParams({
    after_sign_in_url: CLERK_REDIRECT_URL,
    after_sign_up_url: CLERK_REDIRECT_URL,
    redirect_url: CLERK_REDIRECT_URL,
    client_id: CLERK_PUBLISHABLE_KEY
  })

  const signInUrl = `${CLERK_SIGN_IN_URL}?${params.toString()}`

  if (window.hermesDesktop?.openExternal) {
    await window.hermesDesktop.openExternal(signInUrl)
  } else {
    window.open(signInUrl, '_blank', 'noopener,noreferrer')
  }
}

/** Retrieve the stored Clerk session JWT, or null. */
export function getClerkToken(): null | string {
  return readClerkToken()
}

/** The Clerk publishable key (public – safe to ship in the client). */
export function getClerkPublishableKey(): string {
  return CLERK_PUBLISHABLE_KEY
}

/**
 * Persist a Clerk session token and update reactive atoms.
 * Called by the IPC listener (startListeningForCallback) when
 * Electron's main process delivers a deeplink token.
 */
export function storeClerkToken(token: string): void {
  try {
    window.localStorage.setItem(CLERK_TOKEN_KEY, token)
  } catch {
    // localStorage unavailable — auth is session-only
  }

  $isAuthenticated.set(true)
  $userEmail.set(readEmailFromToken())
}

/** Clear stored token and reset atoms (sign-out). */
export function clearClerkToken(): void {
  try {
    window.localStorage.removeItem(CLERK_TOKEN_KEY)
  } catch {
    // localStorage unavailable
  }

  $isAuthenticated.set(false)
  $userEmail.set(null)
}

/**
 * Start listening for the Electron main-process deep-link callback.
 * When Clerk redirects to `unitalk://callback?token=…`, the main process
 * extracts the token and sends it via IPC to the renderer.
 *
 * Returns an unsubscribe function.
 */
export function startListeningForCallback(): () => void {
  return window.hermesDesktop?.onUnitalkOauthCallback?.(token => {
    if (token && String(token).trim()) {
      storeClerkToken(String(token).trim())
    }
  }) ?? (() => undefined)
}

/**
 * Return the Clerk session token as the Unitalk AI Gateway API key.
 * This wires Clerk SSO directly to the LiteLLM gateway – the user
 * never sees or configures an API key.  The token is submitted as
 * the `UNITALK_API_KEY` env var to the backend and passed as
 * `Authorization: Bearer <token>` to llmgateway.unitalk.ai.
 */
export function getGatewayApiKey(): null | string {
  return getClerkToken()
}
