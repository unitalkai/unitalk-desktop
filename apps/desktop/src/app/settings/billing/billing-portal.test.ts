import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getClerkSessionToken: vi.fn() }))

vi.mock('@/lib/clerk-session', () => ({ getClerkSessionToken: mocks.getClerkSessionToken }))

import { BILLING_SUBSCRIPTION_URL, fetchBillingPortalUrl } from './billing-portal'

describe('fetchBillingPortalUrl', () => {
  beforeEach(() => {
    mocks.getClerkSessionToken.mockResolvedValue('clerk-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('sends the Clerk bearer token and returns the portal URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ portalUrl: 'https://billing.stripe.com/session' }),
      ok: true
    })

    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchBillingPortalUrl()).resolves.toBe('https://billing.stripe.com/session')
    expect(fetchMock).toHaveBeenCalledWith(BILLING_SUBSCRIPTION_URL, {
      headers: { Authorization: 'Bearer clerk-token' }
    })
  })

  it('returns null when the response has no portal URL (non-admin)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ portalUrl: null }), ok: true }))

    await expect(fetchBillingPortalUrl()).resolves.toBeNull()
  })

  it('returns null without a token and does not call the API', async () => {
    mocks.getClerkSessionToken.mockResolvedValueOnce(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchBillingPortalUrl()).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null when Clerk is not ready', async () => {
    mocks.getClerkSessionToken.mockRejectedValueOnce(new Error('Clerk session is not ready'))

    await expect(fetchBillingPortalUrl()).resolves.toBeNull()
  })

  it('throws on an HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))

    await expect(fetchBillingPortalUrl()).rejects.toThrow('BILLING_PORTAL_HTTP_503')
  })
})
