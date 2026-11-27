import { afterEach, describe, expect, it, vi } from 'vitest'

import { clerkSessionHost } from '@/store/clerk-session'

import {
  buildClerkSessionCredentials,
  CLERK_CLIENT_JWT_KEY,
  getClerkSessionCredentials,
  readClerkClientToken,
  setClerkCredentialsGetter
} from './clerk-session'

type ElectronGlobal = { __clerk_internal_electron?: unknown }

function withTokenCache(token: null | string) {
  const getToken = vi.fn(async () => token)

  ;(globalThis as ElectronGlobal).__clerk_internal_electron = { tokenCache: { getToken } }

  return getToken
}

afterEach(() => {
  delete (globalThis as ElectronGlobal).__clerk_internal_electron
  setClerkCredentialsGetter(null)
})

describe('Clerk session credentials', () => {
  it('reads the native client token from the @clerk/electron token cache', async () => {
    const getToken = withTokenCache(' client-jwt ')

    expect(await readClerkClientToken()).toBe('client-jwt')
    expect(getToken).toHaveBeenCalledWith(CLERK_CLIENT_JWT_KEY)
  })

  it('has no client token outside Electron', async () => {
    expect(await readClerkClientToken()).toBeNull()
  })

  it('builds credentials for the active session and organization', async () => {
    withTokenCache('client-jwt')

    await expect(
      buildClerkSessionCredentials({
        frontendApi: 'clerk.example.com/',
        organizationId: 'org_1',
        sessionId: 'sess_1'
      })
    ).resolves.toEqual({
      clientToken: 'client-jwt',
      frontendApi: 'https://clerk.example.com',
      organizationId: 'org_1',
      sessionId: 'sess_1'
    })
  })

  it('returns null without a session, a Frontend API host or a client token', async () => {
    withTokenCache('client-jwt')
    expect(
      await buildClerkSessionCredentials({ frontendApi: 'clerk.example.com', organizationId: null, sessionId: null })
    ).toBeNull()
    expect(
      await buildClerkSessionCredentials({ frontendApi: '', organizationId: null, sessionId: 'sess_1' })
    ).toBeNull()

    withTokenCache(null)
    expect(
      await buildClerkSessionCredentials({
        frontendApi: 'clerk.example.com',
        organizationId: undefined,
        sessionId: 'sess_1'
      })
    ).toBeNull()
  })

  it('exposes the credentials through host.clerk, and rejects before Clerk is ready', async () => {
    await expect(clerkSessionHost.getSessionCredentials()).rejects.toThrow('Clerk session is not ready')

    const credentials = {
      clientToken: 'c',
      frontendApi: 'https://clerk.example.com',
      organizationId: null,
      sessionId: 's'
    }
    setClerkCredentialsGetter(async () => credentials)

    await expect(clerkSessionHost.getSessionCredentials()).resolves.toBe(credentials)
    await expect(getClerkSessionCredentials()).resolves.toBe(credentials)
  })
})
