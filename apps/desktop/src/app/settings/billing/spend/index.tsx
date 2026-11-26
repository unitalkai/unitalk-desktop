import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { clerkSessionHost } from '@/store/clerk-session'

import { SettingsContent } from '../../primitives'

import { SpendFiltersBar } from './filters'
import { SpendTable } from './spend-table'
import type { SpendFilters, SpendLogEntry } from './types'
import { useOrgUsers } from './use-org-users'
import { useSpendLogs } from './use-spend-logs'
import { attachUserEmails, getDefaultSpendRange, getUniqueUsers } from './utils'

const PAGE_SIZE = 50

interface SpendSignedInViewProps {
  data: SpendLogEntry[]
  error: null | string
  filters: SpendFilters
  isLoading: boolean
  models: string[]
  onFilterChange: (patch: Partial<SpendFilters>) => void
  onPageChange: (page: number) => void
  page: number
  totalCount: number
}

// Clerk hooks only run here: this subtree mounts only once `useSpendLogs`
// reports a signed-in organization, so the ClerkProvider is always present.
function SpendSignedInView({
  data,
  error,
  filters,
  isLoading,
  models,
  onFilterChange,
  onPageChange,
  page,
  totalCount
}: SpendSignedInViewProps) {
  const { t } = useI18n()
  const s = t.settings.billing.spend
  const { emailsById } = useOrgUsers()

  // The gateway sends only Clerk user ids; resolve them to emails so both the
  // table and the user filter show people instead of ids.
  const rows = useMemo(() => attachUserEmails(data, emailsById), [data, emailsById])
  const users = useMemo(() => getUniqueUsers(rows), [rows])

  return (
    <SettingsContent>
      <div className="flex flex-col gap-4">
        <SpendFiltersBar
          disabled={isLoading}
          filters={filters}
          models={models}
          onChange={onFilterChange}
          users={users}
        />

        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-[length:var(--conversation-text-font-size)] text-destructive">
            {s.loadFailed}
          </div>
        )}

        <SpendTable
          data={rows}
          isLoading={isLoading}
          onPageChange={onPageChange}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={totalCount}
        />
      </div>
    </SettingsContent>
  )
}

export function SpendSettings() {
  const { t } = useI18n()
  const s = t.settings.billing.spend
  const defaults = useMemo(() => getDefaultSpendRange(30), [])

  const [filters, setFilters] = useState<SpendFilters>({
    startDate: defaults.startDate,
    endDate: defaults.endDate,
    model: 'all',
    user: 'all'
  })

  const [page, setPage] = useState(1)

  const { data, totalCount, isLoading, error, needsSignIn } = useSpendLogs({
    page,
    pageSize: PAGE_SIZE,
    ...filters
  })

  const models = useMemo(
    () =>
      [...new Set(data.map(row => row.model))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    [data]
  )

  const handleFilterChange = (patch: Partial<SpendFilters>) => {
    setFilters(current => ({ ...current, ...patch }))
    setPage(1)
  }

  if (needsSignIn) {
    return (
      <SettingsContent>
        <div className="grid min-h-48 place-items-center text-center">
          <div>
            <div className="text-sm font-medium">{s.signedOutTitle}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.signedOutBody}</div>
            <Button
              className="mt-3"
              onClick={() => {
                void clerkSessionHost.signIn().catch(() => undefined)
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {t.settings.billing.freeTier.signIn}
            </Button>
          </div>
        </div>
      </SettingsContent>
    )
  }

  return (
    <SpendSignedInView
      data={data}
      error={error}
      filters={filters}
      isLoading={isLoading}
      models={models}
      onFilterChange={handleFilterChange}
      onPageChange={setPage}
      page={page}
      totalCount={totalCount}
    />
  )
}
