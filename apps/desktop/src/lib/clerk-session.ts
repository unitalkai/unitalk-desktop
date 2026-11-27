type ClerkTokenGetter = () => Promise<string | null>

/** What a backend needs to mint fresh Clerk session JWTs on its own, from Clerk's
 *  Frontend API (`POST {frontendApi}/v1/client/sessions/{sessionId}/tokens`), for
 *  as long as the Clerk session lives. `clientToken` is the native client token
 *  `@clerk/electron` keeps encrypted at rest; treat it like a password. */
export interface ClerkSessionCredentials {
  clientToken: string
  frontendApi: string
  organizationId: null | string
  sessionId: string
}

type ClerkCredentialsGetter = () => Promise<ClerkSessionCredentials | null>

let tokenGetter: ClerkTokenGetter | null = null
let credentialsGetter: ClerkCredentialsGetter | null = null

export function setClerkTokenGetter(getter: ClerkTokenGetter | null): void {
  tokenGetter = getter
}

export async function getClerkSessionToken(): Promise<string | null> {
  if (!tokenGetter) {
    throw new Error('Clerk session is not ready')
  }

  return tokenGetter()
}

export function setClerkCredentialsGetter(getter: ClerkCredentialsGetter | null): void {
  credentialsGetter = getter
}

export async function getClerkSessionCredentials(): Promise<ClerkSessionCredentials | null> {
  if (!credentialsGetter) {
    throw new Error('Clerk session is not ready')
  }

  return credentialsGetter()
}

/** Storage key `@clerk/electron` uses for the native client token. */
export const CLERK_CLIENT_JWT_KEY = '__clerk_client_jwt'

interface ElectronTokenCache {
  getToken: (key: string) => Promise<null | string | undefined>
}

/** Read the native client token from `@clerk/electron`'s preload token cache.
 *  Null outside Electron (the browser-hosted Webapp uses cookies instead). */
export async function readClerkClientToken(): Promise<null | string> {
  const cache = (globalThis as { __clerk_internal_electron?: { tokenCache?: ElectronTokenCache } })
    .__clerk_internal_electron?.tokenCache

  if (typeof cache?.getToken !== 'function') {
    return null
  }

  const token = await cache.getToken(CLERK_CLIENT_JWT_KEY)

  return typeof token === 'string' && token.trim() ? token.trim() : null
}

/** Build the credentials for the active session, or null when signed out or not
 *  running in Electron. `frontendApi` is Clerk's host (e.g. `clerk.example.com`). */
export async function buildClerkSessionCredentials(input: {
  frontendApi: null | string | undefined
  organizationId: null | string | undefined
  sessionId: null | string | undefined
}): Promise<ClerkSessionCredentials | null> {
  const host = (input.frontendApi ?? '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')

  if (!input.sessionId || !host) {
    return null
  }

  const clientToken = await readClerkClientToken()

  if (!clientToken) {
    return null
  }

  return {
    clientToken,
    frontendApi: `https://${host}`,
    organizationId: input.organizationId || null,
    sessionId: input.sessionId
  }
}
