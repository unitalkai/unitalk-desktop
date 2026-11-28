import { describe, expect, it, vi } from 'vitest'

import { billingNavChildren, UNITALK_PRICING_URL } from './billing-nav'

const copy = {
  aiUsage: 'AI usage',
  buyCredits: 'Buy credits',
  mySubscription: 'My subscription',
  plans: 'Plans'
}

function build(overrides: Partial<Parameters<typeof billingNavChildren>[0]> = {}) {
  return billingNavChildren({
    billingView: 'spending',
    copy,
    isBillingActive: true,
    onOpenAiUsage: vi.fn(),
    onOpenBuyCredits: vi.fn(),
    onOpenPlans: vi.fn(),
    onOpenSubscription: vi.fn(),
    ...overrides
  })
}

describe('billingNavChildren', () => {
  it('lists AI usage, Buy credits, My subscription and Plans, with Overview hidden', () => {
    const labels = build().map(link => link.label)

    expect(labels).toEqual(['AI usage', 'Buy credits', 'My subscription', 'Plans'])
    expect(labels).not.toContain('Overview')
  })

  it('marks AI usage active only while the spend view is open', () => {
    expect(build({ billingView: 'spending' })[0].active).toBe(true)
    expect(build({ billingView: 'overview' })[0].active).toBe(false)
    expect(build({ isBillingActive: false })[0].active).toBe(false)
  })

  it('opens AI usage through its handler', () => {
    const onOpenAiUsage = vi.fn()

    build({ onOpenAiUsage })[0].onSelect()

    expect(onOpenAiUsage).toHaveBeenCalledTimes(1)
  })

  it('opens the buy-credits popup from Buy credits', () => {
    const onOpenBuyCredits = vi.fn()

    build({ onOpenBuyCredits })[1].onSelect()

    expect(onOpenBuyCredits).toHaveBeenCalledTimes(1)
  })

  it('opens the subscription portal from My subscription', () => {
    const onOpenSubscription = vi.fn()

    build({ onOpenSubscription })[2].onSelect()

    expect(onOpenSubscription).toHaveBeenCalledTimes(1)
  })

  it('opens the external pricing page from Plans', () => {
    const onOpenPlans = vi.fn()

    build({ onOpenPlans })[3].onSelect()

    expect(onOpenPlans).toHaveBeenCalledTimes(1)
    expect(UNITALK_PRICING_URL).toBe('https://unitalk.ai/home/tarifs')
  })
})
