import { Building2, SlidersHorizontal, Users } from '@/lib/icons'

import type { OverlayNavGroup } from '../overlays/overlay-split-layout'

/** Clerk organization-profile sub-page for the Members entry. */
export const ORGANIZATION_MEMBERS_PATH = '/organization-members'

interface OrganizationNavCopy {
  general: string
  members: string
  organization: string
}

interface OrganizationNavOptions {
  copy: OrganizationNavCopy
  openOrganizationProfile: (startPath?: string) => void
}

/**
 * Settings ▸ Organization: a nav-only group (no page of its own). Its two
 * children open Clerk's organization-profile modal instead of navigating —
 * "General info" at the default page, "Members" at the members sub-page.
 * The group is shown only while an organization is active; see SettingsView.
 */
export function organizationNavGroup({ copy, openOrganizationProfile }: OrganizationNavOptions): OverlayNavGroup {
  return {
    active: false,
    children: [
      {
        active: false,
        icon: SlidersHorizontal,
        id: 'organization:general',
        label: copy.general,
        onSelect: () => openOrganizationProfile()
      },
      {
        active: false,
        icon: Users,
        id: 'organization:members',
        label: copy.members,
        onSelect: () => openOrganizationProfile(ORGANIZATION_MEMBERS_PATH)
      }
    ],
    icon: Building2,
    id: 'organization',
    label: copy.organization,
    onSelect: () => {},
    toggleOnSelect: true
  }
}
