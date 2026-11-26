import { atom } from 'nanostores'

import { getClerkSessionToken } from '@/lib/clerk-session'
import { getUnitalkAgentName } from '@/lib/unitalk-instance-api'

import { $clerkSession, type ClerkSessionSnapshot } from './clerk-session'

export type UnitalkAgentStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'

export interface UnitalkAgentState {
  error: null | string
  name: null | string
  status: UnitalkAgentStatus
}

export const $unitalkAgent = atom<UnitalkAgentState>({ error: null, name: null, status: 'idle' })

let generation = 0
let inFlight: null | Promise<void> = null
let inFlightKey: null | string = null

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sessionKey(session: ClerkSessionSnapshot): null | string {
  const orgId = session.activeOrganization?.id
  const userId = session.user?.id

  return session.status === 'signed-in' && orgId && userId ? `${orgId}:${userId}` : null
}

/**
 * Load the Unitalk agent name (`/api/instance` → `instance.agentName`) for the
 * signed-in user/organization. Concurrent callers share one request; a session
 * change invalidates the in-flight read so a stale name can never win.
 */
export function refreshUnitalkAgent(): Promise<void> {
  const key = sessionKey($clerkSession.get())

  if (!key) {
    generation += 1
    inFlight = null
    inFlightKey = null
    $unitalkAgent.set({ error: null, name: null, status: 'unavailable' })

    return Promise.resolve()
  }

  if (inFlight && inFlightKey === key) {
    return inFlight
  }

  const current = ++generation
  inFlightKey = key
  $unitalkAgent.set({ error: null, name: null, status: 'loading' })

  const run = (async () => {
    try {
      const token = await getClerkSessionToken()
      const name = await getUnitalkAgentName(fetch, token)

      if (current === generation) {
        $unitalkAgent.set({ error: null, name, status: 'ready' })
      }
    } catch (error) {
      if (current === generation) {
        $unitalkAgent.set({ error: messageOf(error), name: null, status: 'error' })
      }
    } finally {
      if (current === generation) {
        inFlight = null
        inFlightKey = null
      }
    }
  })()

  inFlight = run

  return run
}

export function resetUnitalkAgent(): void {
  generation += 1
  inFlight = null
  inFlightKey = null
  $unitalkAgent.set({ error: null, name: null, status: 'idle' })
}
