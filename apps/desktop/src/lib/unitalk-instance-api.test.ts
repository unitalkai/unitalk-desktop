import { describe, expect, it, vi } from 'vitest'

import { getUnitalkAgentName, UnitalkResponseError } from './unitalk-instance-api'

function jsonFetcher(body: unknown, status = 200) {
  return vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
        status
      })
  )
}

const asFetch = (fetcher: ReturnType<typeof jsonFetcher>) => fetcher as unknown as typeof fetch

describe('getUnitalkAgentName', () => {
  it('reads the agent name with a Bearer session token, never cookies', async () => {
    const fetcher = jsonFetcher({ instance: { agentName: '  med-inc  ' } })

    await expect(getUnitalkAgentName(asFetch(fetcher), 'token-1')).resolves.toBe('med-inc')

    const [url, init] = fetcher.mock.calls[0]

    expect(String(url)).toBe('https://unitalk.ai/api/instance')
    expect(init).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'application/json', Authorization: 'Bearer token-1' }
    })
  })

  it('returns null without a token', async () => {
    const fetcher = jsonFetcher({ instance: { agentName: 'med-inc' } })

    await expect(getUnitalkAgentName(asFetch(fetcher), null)).resolves.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns null when the account has no instance or no agent name', async () => {
    await expect(getUnitalkAgentName(asFetch(jsonFetcher({ instance: null })), 'token-1')).resolves.toBeNull()
    await expect(
      getUnitalkAgentName(asFetch(jsonFetcher({ instance: { agentName: null } })), 'token-1')
    ).resolves.toBeNull()
  })

  it('rejects a malformed agent name', async () => {
    await expect(
      getUnitalkAgentName(asFetch(jsonFetcher({ instance: { agentName: 42 } })), 'token-1')
    ).rejects.toThrow('Invalid Hermes instance response')
  })

  it('surfaces the Unitalk error message', async () => {
    const error = await getUnitalkAgentName(
      asFetch(jsonFetcher({ error: 'Instance not found' }, 404)),
      'token-1'
    ).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(UnitalkResponseError)
    expect(error).toMatchObject({ status: 404, message: 'Instance not found' })
  })
})
