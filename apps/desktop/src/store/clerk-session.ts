import { atom, type ReadableAtom } from 'nanostores'

import { type ClerkSessionCredentials, getClerkSessionCredentials, getClerkSessionToken } from '@/lib/clerk-session'

export type ClerkSessionStatus = 'disabled' | 'error' | 'loading' | 'signed-in' | 'signed-out'

export interface ClerkUserSummary {
  email: null | string
  emailVerified: boolean
  fullName: null | string
  id: string
  imageUrl: null | string
  username: null | string
}

export interface ClerkOrganizationSummary {
  id: string
  imageUrl: null | string
  membersCount: number
  name: string
  role: null | string
  slug: null | string
}

export interface ClerkSessionSnapshot {
  activeOrganization: ClerkOrganizationSummary | null
  enabled: boolean
  error: null | string
  organizations: ClerkOrganizationSummary[]
  status: ClerkSessionStatus
  tokenSyncError: null | string
  user: ClerkUserSummary | null
}

export interface ClerkOrganizationInput {
  name: string
  slug?: string
}

export interface ClerkSessionActions {
  createOrganization: (input: ClerkOrganizationInput) => Promise<ClerkOrganizationSummary>
  refresh: () => Promise<void>
  setActiveOrganization: (organizationId: null | string) => Promise<void>
  signOut: () => Promise<void>
}

export const DISABLED_CLERK_SNAPSHOT: ClerkSessionSnapshot = {
  activeOrganization: null,
  enabled: false,
  error: null,
  organizations: [],
  status: 'disabled',
  tokenSyncError: null,
  user: null
}

export const $clerkSession = atom<ClerkSessionSnapshot>({ ...DISABLED_CLERK_SNAPSHOT })

let currentActions: ClerkSessionActions | null = null
let currentSignInAction: (() => void) | null = null
let currentOrganizationProfileOpener: ((startPath?: string) => void) | null = null

export function registerClerkSessionActions(actions: ClerkSessionActions | null): () => void {
  currentActions = actions

  return () => {
    if (currentActions === actions) {
      currentActions = null
    }
  }
}

/** Register the sign-in opener separately from the signed-in organization actions:
 *  a browser-hosted Desktop keeps the app usable while signed out and still needs
 *  the account panel's Login to open Clerk's modal. */
export function registerClerkSignInAction(action: (() => void) | null): () => void {
  currentSignInAction = action

  return () => {
    if (currentSignInAction === action) {
      currentSignInAction = null
    }
  }
}

/** Register the Clerk organization-profile modal opener. The Settings rail
 *  offers "General info" / "Members" actions; both route through this seam so
 *  the nav never calls Clerk hooks outside the provider. */
export function registerClerkOrganizationProfileAction(action: ((startPath?: string) => void) | null): () => void {
  currentOrganizationProfileOpener = action

  return () => {
    if (currentOrganizationProfileOpener === action) {
      currentOrganizationProfileOpener = null
    }
  }
}

export function requireClerkSessionActions(): ClerkSessionActions {
  if (!currentActions) {
    throw new Error('Clerk session is not ready')
  }

  return currentActions
}

export function publishClerkSession(snapshot: ClerkSessionSnapshot): void {
  $clerkSession.set(snapshot)
}

export function patchClerkSession(patch: Partial<ClerkSessionSnapshot>): void {
  $clerkSession.set({ ...$clerkSession.get(), ...patch })
}

export const clerkSessionHost = {
  snapshot: $clerkSession as ReadableAtom<ClerkSessionSnapshot>,
  /** Fresh Clerk session JWT for the active user/organization. Short-lived;
   *  rejects while the renderer's Clerk client is not ready. */
  getToken: async (): Promise<null | string> => getClerkSessionToken(),
  /** Credentials a backend can use to mint its own fresh session JWTs from Clerk
   *  for as long as the Clerk session lives (see `ClerkSessionCredentials`).
   *  Null when signed out or outside Electron; rejects while Clerk is not ready. */
  getSessionCredentials: async (): Promise<ClerkSessionCredentials | null> => getClerkSessionCredentials(),
  signIn: async (): Promise<void> => {
    if (!currentSignInAction) {
      throw new Error('Clerk sign-in is not available')
    }

    currentSignInAction()
  },
  setActiveOrganization: async (organizationId: null | string): Promise<void> =>
    requireClerkSessionActions().setActiveOrganization(organizationId),
  createOrganization: async (input: ClerkOrganizationInput): Promise<ClerkOrganizationSummary> =>
    requireClerkSessionActions().createOrganization(input),
  refresh: async (): Promise<void> => requireClerkSessionActions().refresh(),
  signOut: async (): Promise<void> => requireClerkSessionActions().signOut(),
  /** Open Clerk's organization-profile modal, optionally at a sub-path
   *  (e.g. `/organization-members`). No-ops until the signed-in bridge has
   *  registered the opener, so a stale nav click never crashes. */
  openOrganizationProfile: (startPath?: string): void => currentOrganizationProfileOpener?.(startPath)
} satisfies {
  snapshot: ReadableAtom<ClerkSessionSnapshot>
  getToken: () => Promise<null | string>
  getSessionCredentials: () => Promise<ClerkSessionCredentials | null>
  signIn: () => Promise<void>
  setActiveOrganization: (organizationId: null | string) => Promise<void>
  createOrganization: (input: ClerkOrganizationInput) => Promise<ClerkOrganizationSummary>
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  openOrganizationProfile: (startPath?: string) => void
}
