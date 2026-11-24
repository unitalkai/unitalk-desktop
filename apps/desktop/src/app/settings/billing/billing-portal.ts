import { getClerkSessionToken } from '@/lib/clerk-session'

/** Unitalk's Stripe customer-portal endpoint (the app served at unitalk.ai). */
export const BILLING_SUBSCRIPTION_URL = 'https://unitalk.ai/api/billing/subscription'

interface BillingSubscriptionResponse {
  portalUrl?: null | string
}

/**
 * Fetch the active organization's Stripe customer-portal URL. Returns `null` when
 * the endpoint has no portal for this member (non-admins get no URL) or when no
 * Clerk token is available yet.
 */
export async function fetchBillingPortalUrl(): Promise<null | string> {
  const token = await getClerkSessionToken().catch(() => null)

  if (!token) {
    return null
  }

  const response = await fetch(BILLING_SUBSCRIPTION_URL, {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (!response.ok) {
    throw new Error(`BILLING_PORTAL_HTTP_${response.status}`)
  }

  const payload = (await response.json()) as BillingSubscriptionResponse
  const url = payload?.portalUrl

  return typeof url === 'string' && url.length > 0 ? url : null
}
