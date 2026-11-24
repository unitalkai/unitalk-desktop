import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useI18n } from '@/i18n'
import { openExternalLink } from '@/lib/external-link'
import { $clerkSession } from '@/store/clerk-session'
import { notify } from '@/store/notifications'

import { fetchBillingPortalUrl } from './billing-portal'

/**
 * Resolves the active organization's Stripe customer-portal URL and opens it in
 * the system browser. Prefetched while the Billing tab is open so the click can
 * open a real tab (a `window.open` after an await is blocked by popup guards in
 * browser-hosted Desktop).
 */
export function useBillingPortal(enabled: boolean) {
  const { t } = useI18n()
  const session = useStore($clerkSession)
  const orgId = session.activeOrganization?.id ?? null
  const signedIn = session.status === 'signed-in' && orgId !== null

  const { data, refetch } = useQuery({
    enabled: enabled && signedIn,
    queryFn: fetchBillingPortalUrl,
    queryKey: ['billing', 'portal', orgId, session.user?.id],
    retry: false,
    staleTime: 60_000
  })

  const openPortal = useCallback(() => {
    if (data) {
      openExternalLink(data)

      return
    }

    void refetch().then(result => {
      if (result.data) {
        openExternalLink(result.data)

        return
      }

      notify({ durationMs: 5_000, kind: 'error', message: t.settings.billing.portalUnavailable })
    })
  }, [data, refetch, t])

  return { openPortal, portalUrl: data ?? null }
}
