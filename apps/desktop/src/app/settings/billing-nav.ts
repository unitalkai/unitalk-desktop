import { BarChart3, CreditCard, ExternalLink, Zap } from '@/lib/icons'

import type { OverlayNavLink } from '../overlays/overlay-split-layout'

import type { BillingSubView } from './billing'

/** External pricing page opened by the Plans entry (new browser tab). */
export const UNITALK_PRICING_URL = 'https://unitalk.ai/home/tarifs'

interface BillingNavCopy {
  aiUsage: string
  buyCredits: string
  mySubscription: string
  plans: string
}

interface BillingNavChildrenOptions {
  billingView: BillingSubView
  copy: BillingNavCopy
  isBillingActive: boolean
  onOpenAiUsage: () => void
  onOpenBuyCredits: () => void
  onOpenPlans: () => void
  onOpenSubscription: () => void
}

/**
 * Billing submenu: AI usage (opens the spend page), Buy credits (opens the
 * Unitalk checkout popup — the same dialog the titlebar user panel uses),
 * My subscription (opens the Stripe customer portal), Plans (opens the
 * external pricing page). Overview is hidden.
 */
export function billingNavChildren({
  billingView,
  copy,
  isBillingActive,
  onOpenAiUsage,
  onOpenBuyCredits,
  onOpenPlans,
  onOpenSubscription
}: BillingNavChildrenOptions): OverlayNavLink[] {
  return [
    {
      active: isBillingActive && billingView === 'spending',
      icon: BarChart3,
      id: 'bview:spending',
      label: copy.aiUsage,
      onSelect: onOpenAiUsage
    },
    {
      active: false,
      icon: Zap,
      id: 'billing:buy-credits',
      label: copy.buyCredits,
      onSelect: onOpenBuyCredits
    },
    {
      active: false,
      icon: CreditCard,
      id: 'billing:subscription',
      label: copy.mySubscription,
      onSelect: onOpenSubscription
    },
    {
      active: false,
      icon: ExternalLink,
      id: 'billing:plans',
      label: copy.plans,
      onSelect: onOpenPlans
    }
  ]
}
