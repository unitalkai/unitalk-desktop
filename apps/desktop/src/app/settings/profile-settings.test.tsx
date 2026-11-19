import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Hermes from '@/hermes'
import { en } from '@/i18n/en'
import { $clerkSession, DISABLED_CLERK_SNAPSHOT } from '@/store/clerk-session'
import type * as GatewayStore from '@/store/gateway'
import { $profiles } from '@/store/profile'
import type * as ProfileStore from '@/store/profile'

import type * as ProfileIdentity from './profile-identity'
import { SettingsIdentityHeader } from './profile-identity'
import { ProfileSettings } from './profile-settings'

const mocks = vi.hoisted(() => ({
  readProfileAvatarFile: vi.fn(),
  refreshProfiles: vi.fn(),
  renameProfile: vi.fn(),
  request: vi.fn()
}))

vi.mock('@/store/gateway', async importOriginal => {
  const actual = await importOriginal<typeof GatewayStore>()
  const { atom } = await import('nanostores')

  return {
    ...actual,
    $gateway: atom({ request: mocks.request } as unknown as Hermes.HermesGateway)
  }
})

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<typeof Hermes>()),
  renameProfile: mocks.renameProfile
}))

vi.mock('@/store/profile', async importOriginal => ({
  ...(await importOriginal<typeof ProfileStore>()),
  refreshProfiles: mocks.refreshProfiles
}))

vi.mock('./profile-identity', async importOriginal => ({
  ...(await importOriginal<typeof ProfileIdentity>()),
  readProfileAvatarFile: mocks.readProfileAvatarFile
}))

const defaultProfile = {
  display_name: 'Lumi',
  has_env: false,
  is_default: true,
  model: null,
  name: 'default',
  path: '/tmp/default',
  provider: null,
  skill_count: 0
}

function signIn({ emailVerified = true }: { emailVerified?: boolean } = {}): void {
  $clerkSession.set({
    ...DISABLED_CLERK_SNAPSHOT,
    activeOrganization: {
      id: 'org_1',
      imageUrl: null,
      membersCount: 3,
      name: 'Acme',
      role: 'admin',
      slug: 'acme'
    },
    enabled: true,
    organizations: [],
    status: 'signed-in',
    user: {
      email: 'ada@example.test',
      emailVerified,
      fullName: 'Ada Lovelace',
      id: 'user_1',
      imageUrl: null,
      username: 'ada'
    }
  })
}

beforeEach(() => {
  mocks.readProfileAvatarFile.mockReset().mockResolvedValue('data:image/png;base64,AAAA')
  mocks.refreshProfiles.mockReset().mockResolvedValue([])
  mocks.renameProfile.mockReset().mockResolvedValue({ name: 'default', ok: true, path: '/tmp/default' })
  mocks.request
    .mockReset()
    .mockImplementation(async (method: string) => (method === 'profiles.get_asset' ? { found: false } : { ok: true }))
  $profiles.set([defaultProfile])
  signIn()
})

afterEach(() => {
  cleanup()
  $clerkSession.set({ ...DISABLED_CLERK_SNAPSHOT })
  $profiles.set([])
})

describe('ProfileSettings', () => {
  it('renders the default profile name and AI Collaborator subtitle in the sidebar header', () => {
    render(<SettingsIdentityHeader />)

    expect(screen.getByText('Lumi')).toBeTruthy()
    expect(screen.getByText(en.settings.identity.aiCollaborator)).toBeTruthy()
  })

  it('renders the identity and ownership sections without appearance controls', () => {
    render(<ProfileSettings />)

    expect((screen.getByLabelText(en.settings.identity.nameLabel) as HTMLInputElement).value).toBe('Lumi')
    expect(screen.getByText(en.settings.identity.ownershipTitle)).toBeTruthy()
    expect(screen.getByText(en.settings.identity.verifiedOwner)).toBeTruthy()
    expect(screen.getByDisplayValue('Ada Lovelace')).toBeTruthy()
    expect(screen.getByDisplayValue('ada@example.test')).toBeTruthy()
    expect(screen.getByDisplayValue('Acme')).toBeTruthy()

    expect(screen.queryByText(en.language.label)).toBeNull()
    expect(screen.queryByText(en.settings.appearance.colorMode)).toBeNull()
  })

  it('saves a changed display name on blur and refreshes the profile list', async () => {
    render(<ProfileSettings />)

    const input = screen.getByLabelText(en.settings.identity.nameLabel)
    fireEvent.change(input, { target: { value: '  Nova  ' } })
    fireEvent.blur(input)

    await waitFor(() => expect(mocks.renameProfile).toHaveBeenCalledWith('default', 'Nova'))
    expect(mocks.refreshProfiles).toHaveBeenCalled()
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('Nova'))
  })

  it('uploads a chosen avatar through the profile asset RPC', async () => {
    const { container } = render(<ProfileSettings />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('profiles.set_asset', {
        asset: 'avatar',
        data: 'data:image/png;base64,AAAA',
        name: 'default'
      })
    )
    expect(mocks.readProfileAvatarFile).toHaveBeenCalledWith(file)
  })

  it('shows an unverified badge when the Clerk email is not verified', () => {
    signIn({ emailVerified: false })
    render(<ProfileSettings />)

    expect(screen.getByText(en.settings.identity.unverifiedEmail)).toBeTruthy()
    expect(screen.getByText(en.settings.identity.unverified)).toBeTruthy()
  })
})
