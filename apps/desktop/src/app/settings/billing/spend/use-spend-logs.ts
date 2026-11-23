import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'

import { getClerkSessionToken } from '@/lib/clerk-session'
import { $clerkSession } from '@/store/clerk-session'

import type { SpendLogEntry, SpendLogsResponse } from './types'

// Hermes Web owns the LiteLLM gateway key, so the Desktop asks it for the
// active organization's spend instead of calling the gateway directly (same
// contract as the user-panel's team-credits call).
const SPEND_WEB_BASE = 'https://agent.unitalk.ai'

export interface SpendLogsQuery {
  page: number
  pageSize: number
  startDate: string
  endDate: string
  model?: string
  user?: string
}

export interface SpendLogsState {
  data: SpendLogEntry[]
  error: string | null
  isLoading: boolean
  /** No Clerk session / active organization to scope the query. */
  needsSignIn: boolean
  totalCount: number
}

interface SpendLogsResult {
  data: SpendLogEntry[]
  totalCount: number
}

async function fetchSpendLogs(query: SpendLogsQuery): Promise<SpendLogsResult> {
  const token = await getClerkSessionToken()

  if (!token) {
    throw new Error('unauthorized')
  }

  const params = new URLSearchParams({
    page: String(query.page),
    page_size: String(query.pageSize),
    start_date: query.startDate,
    end_date: query.endDate
  })

  if (query.model && query.model !== 'all') {
    params.set('model', query.model)
  }

  if (query.user && query.user !== 'all') {
    params.set('user_id', query.user)
  }

  const response = await fetch(`${SPEND_WEB_BASE}/api/spend?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (!response.ok) {
    throw new Error(`SPEND_HTTP_${response.status}`)
  }

  const payload = (await response.json()) as SpendLogsResponse
  const rows = Array.isArray(payload.data) ? payload.data : []

  return {
    data: rows,
    totalCount: payload.total_count ?? payload.total ?? rows.length
  }
}

export function useSpendLogs(query: SpendLogsQuery): SpendLogsState {
  const session = useStore($clerkSession)
  const orgId = session.activeOrganization?.id ?? null
  const sessionLoading = session.status === 'loading'
  const signedIn = session.status === 'signed-in' && orgId !== null

  // Spend is Clerk-organization data, not Hermes-profile data: the cache key
  // carries the org + user so switching either never shows a stale team's rows.
  const result = useQuery({
    enabled: signedIn,
    queryFn: () => fetchSpendLogs(query),
    queryKey: [
      'spend-logs',
      orgId,
      session.user?.id,
      query.page,
      query.pageSize,
      query.startDate,
      query.endDate,
      query.model,
      query.user
    ],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 30_000
  })

  if (sessionLoading) {
    return { data: [], error: null, isLoading: true, needsSignIn: false, totalCount: 0 }
  }

  if (!signedIn) {
    return { data: [], error: null, isLoading: false, needsSignIn: true, totalCount: 0 }
  }

  return {
    data: result.data?.data ?? [],
    error: result.error ? (result.error instanceof Error ? result.error.message : String(result.error)) : null,
    isLoading: result.isPending,
    needsSignIn: false,
    totalCount: result.data?.totalCount ?? 0
  }
}
