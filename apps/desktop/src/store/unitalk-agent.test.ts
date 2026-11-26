import { beforeEach, describe, expect, it, vi } from 'vitest'

import { $clerkSession, DISABLED_CLERK_SNAPSHOT } from './clerk-session'
import { $unitalkAgent, refreshUnitalkAgent, resetUnitalkAgent } from './unitalk-agent'

const mocks = vi.hoisted(() => ({
  getAgentName: vi.fn(),
  getToken: vi.fn()
}))

vi.mock('@/lib/clerk-session', () => ({ getClerkSessionToken: mocks.getToken }))

vi.mock('@/lib/unitalk-instance-api', () => ({ getUnitalkAgentName: mocks.getAgentName }))

function signIn(orgId = 'org_1', userId = 'user_1'): void {
  $clerkSession.set({
    ...DISABLED_CLERK_SNAPSHOT,
    activeOrganization: {
      id: orgId,
      imageUrl: null,
      membersCount: 1,
      name: 'Acme',
      role: 'admin',
      slug: 'acme'
    },
    enabled: true,
    organizations: [],
    status: 'signed-in',
    user: {
      email: 'ada@example.test',
      emailVerified: true,
      fullName: 'Ada Lovelace',
      id: userId,
      imageUrl: null,
      username: 'ada'
    }
  })
}

function signOut(): void {
  $clerkSession.set({ ...DISABLED_CLERK_SNAPSHOT })
}

beforeEach(() => {
  mocks.getAgentName.mockReset().mockResolvedValue(null)
  mocks.getToken.mockReset().mockResolvedValue('clerk-token')
  signOut()
  resetUnitalkAgent()
})

describe('unitalk agent store', () => {
  it('is unavailable while signed out and never asks for a token', async () => {
    await refreshUnitalkAgent()

    expect($unitalkAgent.get()).toEqual({ error: null, name: null, status: 'unavailable' })
    expect(mocks.getToken).not.toHaveBeenCalled()
    expect(mocks.getAgentName).not.toHaveBeenCalled()
  })

  it('loads the agent name for the signed-in organization', async () => {
    signIn()
    mocks.getAgentName.mockResolvedValue('med-inc')

    await refreshUnitalkAgent()

    expect($unitalkAgent.get()).toEqual({ error: null, name: 'med-inc', status: 'ready' })
    expect(mocks.getAgentName.mock.calls[0][1]).toBe('clerk-token')
  })

  it('stays ready with no name when the account has no agent name', async () => {
    signIn()

    await refreshUnitalkAgent()

    expect($unitalkAgent.get()).toEqual({ error: null, name: null, status: 'ready' })
  })

  it('records failed reads without throwing', async () => {
    signIn()
    mocks.getAgentName.mockRejectedValue(new Error('Unitalk request failed (503)'))

    await refreshUnitalkAgent()

    expect($unitalkAgent.get()).toEqual({
      error: 'Unitalk request failed (503)',
      name: null,
      status: 'error'
    })
  })

  it('shares one request between concurrent callers', async () => {
    signIn()
    mocks.getAgentName.mockResolvedValue('med-inc')

    await Promise.all([refreshUnitalkAgent(), refreshUnitalkAgent()])

    expect(mocks.getAgentName).toHaveBeenCalledTimes(1)
  })

  it('never lets a stale organization response overwrite a newer one', async () => {
    signIn('org_1', 'user_1')
    let resolveFirst: (value: null | string) => void = () => undefined
    mocks.getAgentName.mockReturnValueOnce(
      new Promise<null | string>(resolve => {
        resolveFirst = resolve
      })
    )

    const first = refreshUnitalkAgent()

    signIn('org_2', 'user_2')
    mocks.getAgentName.mockResolvedValueOnce('new-agent')
    const second = refreshUnitalkAgent()

    await second
    resolveFirst('old-agent')
    await first

    expect($unitalkAgent.get().name).toBe('new-agent')
  })
})
