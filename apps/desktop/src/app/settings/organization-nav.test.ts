import { describe, expect, it, vi } from 'vitest'

import { ORGANIZATION_MEMBERS_PATH, organizationNavGroup } from './organization-nav'

const copy = {
  general: 'General info',
  members: 'Members',
  organization: 'Organization'
}

function build(openOrganizationProfile = vi.fn()) {
  return {
    group: organizationNavGroup({ copy, openOrganizationProfile }),
    openOrganizationProfile
  }
}

describe('organizationNavGroup', () => {
  it('is a nav-only group that toggles its two children', () => {
    const { group } = build()

    expect(group.label).toBe('Organization')
    expect(group.active).toBe(false)
    expect(group.toggleOnSelect).toBe(true)
    expect(group.children?.map(child => child.label)).toEqual(['General info', 'Members'])
  })

  it('opens the organization profile from General info', () => {
    const { group, openOrganizationProfile } = build()

    group.children?.[0].onSelect()

    expect(openOrganizationProfile).toHaveBeenCalledWith()
  })

  it('opens the members page from Members', () => {
    const { group, openOrganizationProfile } = build()

    group.children?.[1].onSelect()

    expect(openOrganizationProfile).toHaveBeenCalledWith(ORGANIZATION_MEMBERS_PATH)
    expect(ORGANIZATION_MEMBERS_PATH).toBe('/organization-members')
  })
})
