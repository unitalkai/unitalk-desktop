// @vitest-environment jsdom
import type * as HermesSdk from '@hermes/plugin-sdk'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// @ts-expect-error - the bundled plugin is plain JavaScript without declarations.
import plugin from './plugin.js'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getToken: vi.fn(),
  notifyError: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  snapshot: null as unknown as { set: (value: HermesSdk.ClerkSessionSnapshot) => void }
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  mocks.snapshot = sdk.atom({
    activeOrganization: null,
    enabled: false,
    error: null,
    organizations: [],
    status: 'disabled',
    tokenSyncError: null,
    user: null
  })

  return {
    ...sdk,
    host: {
      ...sdk.host,
      clerk: {
        createOrganization: vi.fn(),
        getToken: mocks.getToken,
        refresh: vi.fn(),
        setActiveOrganization: vi.fn(),
        signIn: mocks.signIn,
        signOut: mocks.signOut,
        snapshot: mocks.snapshot
      },
      notifyError: mocks.notifyError
    }
  }
})

const user = {
  email: null,
  fullName: 'Ada Lovelace',
  id: 'user_1',
  imageUrl: null,
  username: 'ada'
}

const organization = {
  id: 'org_1',
  imageUrl: 'https://example.test/acme.png',
  membersCount: 3,
  name: 'Acme',
  role: 'admin',
  slug: 'acme'
}

const setSnapshot = (patch: Partial<HermesSdk.ClerkSessionSnapshot>) => {
  act(() => {
    mocks.snapshot.set({
      activeOrganization: null,
      enabled: true,
      error: null,
      organizations: [],
      status: 'signed-out',
      tokenSyncError: null,
      user: null,
      ...patch
    })
  })
}

let mount: () => ReactNode

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()

  let renderPanel: (() => ReactNode) | undefined

  plugin.register({
    os: { openExternal: vi.fn() },
    register: (contribution: { render: () => ReactNode }) => {
      renderPanel = contribution.render
    }
  })

  mount = () => renderPanel!()
})

const creditsResponse = (body: unknown) =>
  Promise.resolve({ json: async () => body, ok: true } as unknown as Response)

beforeEach(() => {
  mocks.fetch.mockReset().mockImplementation(() => creditsResponse({ credits: 0 }))
  mocks.getToken.mockReset().mockResolvedValue('clerk-token')
  mocks.signIn.mockReset().mockResolvedValue(undefined)
  mocks.signOut.mockReset().mockResolvedValue(undefined)
  mocks.notifyError.mockReset()
  vi.stubGlobal('fetch', mocks.fetch)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const openMenu = (name: RegExp = /Open account menu/) => {
  const trigger = screen.getByRole('button', { name })

  expect(trigger.hasAttribute('disabled')).toBe(false)

  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
  fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
  fireEvent.click(trigger)

  return trigger
}

const selectRow = (name: string) => {
  const row = screen.getByRole('menuitem', { name })

  fireEvent.pointerDown(row, { button: 0, pointerType: 'mouse' })
  fireEvent.pointerUp(row, { button: 0, pointerType: 'mouse' })
  fireEvent.click(row)

  return row
}

const menuLabels = () =>
  screen.getAllByRole('menuitem').map(item => item.querySelector('span.flex-1')?.textContent?.trim())

const aiCreditsRow = () => screen.getByRole('menuitem', { name: /AI Credits/ })
const aiCreditsValue = () => aiCreditsRow().querySelector('span.ml-auto')?.textContent ?? null

const PUBLIC_ROWS = ['Settings', 'AI Credits', 'Buy credits', 'Pricing', 'Book a demo']

describe('user panel menu', () => {
  it('shows the menu while Clerk is still loading', () => {
    setSnapshot({ status: 'loading' })

    render(mount())

    expect(screen.queryByLabelText('Loading account')).toBeNull()

    openMenu()

    expect(menuLabels()).toEqual(['Log in', ...PUBLIC_ROWS])
  })

  it('shows the menu when Clerk is not configured at all', () => {
    setSnapshot({ enabled: false, status: 'disabled' })

    render(mount())
    openMenu()

    expect(menuLabels()).toEqual(['Log in', ...PUBLIC_ROWS])
  })

  it('opens Clerk sign-in from the signed-out menu', async () => {
    setSnapshot({ status: 'signed-out' })

    render(mount())
    openMenu()
    selectRow('Log in')

    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1))
  })

  it('shows the organization switcher and logs out from the bottom of the menu', async () => {
    setSnapshot({
      activeOrganization: organization,
      organizations: [organization],
      status: 'signed-in',
      user
    })

    render(mount())
    openMenu(/Open account menu for Acme/)

    expect(menuLabels()).toEqual(['Acme', ...PUBLIC_ROWS, 'Log out'])

    selectRow('Log out')

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1))
  })

  it('shows the remaining team credits beside AI Credits', async () => {
    const paidOrganization = { ...organization, id: 'org_paid', name: 'Paid Org' }

    mocks.fetch.mockImplementation(() => creditsResponse({ credits: 6500 }))
    setSnapshot({
      activeOrganization: paidOrganization,
      organizations: [paidOrganization],
      status: 'signed-in',
      user
    })

    render(mount())
    openMenu(/Open account menu for Paid Org/)

    await waitFor(() => expect(aiCreditsValue()?.replace(/\s/g, '')).toBe('6500'))
    expect(mocks.fetch).toHaveBeenCalledWith('https://agent.unitalk.ai/api/team', {
      headers: { Authorization: 'Bearer clerk-token' }
    })
  })

  it('hides credits on a personal account without querying the gateway', async () => {
    setSnapshot({ activeOrganization: null, organizations: [], status: 'signed-in', user })

    render(mount())
    openMenu()

    await waitFor(() => expect(aiCreditsValue()).toBeNull())
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('hides credits while signed out', async () => {
    setSnapshot({ status: 'signed-out' })

    render(mount())
    openMenu()

    expect(aiCreditsValue()).toBeNull()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('hides credits when the request fails', async () => {
    const failedOrganization = { ...organization, id: 'org_fail', name: 'Fail Org' }

    mocks.fetch.mockImplementation(() => Promise.reject(new Error('offline')))
    setSnapshot({
      activeOrganization: failedOrganization,
      organizations: [failedOrganization],
      status: 'signed-in',
      user
    })

    render(mount())
    openMenu(/Open account menu for Fail Org/)

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
    expect(aiCreditsValue()).toBeNull()
    expect(mocks.notifyError).not.toHaveBeenCalled()
  })

  it('hides credits when the gateway rejects the token', async () => {
    const unauthorizedOrganization = { ...organization, id: 'org_unauthorized', name: 'Unauthorized Org' }

    mocks.fetch.mockImplementation(() => Promise.resolve({ ok: false, status: 401 } as unknown as Response))
    setSnapshot({
      activeOrganization: unauthorizedOrganization,
      organizations: [unauthorizedOrganization],
      status: 'signed-in',
      user
    })

    render(mount())
    openMenu(/Open account menu for Unauthorized Org/)

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
    expect(aiCreditsValue()).toBeNull()
  })

  it('reuses fresh team credits instead of refetching on remount', async () => {
    const cachedOrganization = { ...organization, id: 'org_cache', name: 'Cache Org' }

    mocks.fetch.mockImplementation(() => creditsResponse({ credits: 15000 }))
    setSnapshot({
      activeOrganization: cachedOrganization,
      organizations: [cachedOrganization],
      status: 'signed-in',
      user
    })

    const first = render(mount())

    openMenu(/Open account menu for Cache Org/)

    await waitFor(() => expect(aiCreditsValue()?.replace(/\s/g, '')).toBe('15000'))
    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    first.unmount()

    render(mount())
    openMenu(/Open account menu for Cache Org/)

    await waitFor(() => expect(aiCreditsValue()?.replace(/\s/g, '')).toBe('15000'))
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
