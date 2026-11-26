import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { OverflowTip, Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { ArrowBarToDown, ArrowBarToUp, ChevronDown, ChevronUp, Clock, Download } from '@/lib/icons'

import { Pill } from '../../primitives'

import type { SpendLogEntry } from './types'
import {
  downloadCSV,
  formatCredits,
  formatDate,
  formatModelName,
  formatTypeLabel,
  getInputTokens,
  getLogDate,
  getLogTimestamp,
  getLogUser,
  getOutputTokens,
  getSpendType,
  getTotalTokens,
  getTypeTone
} from './utils'

type SortKey = 'credits' | 'date' | 'model' | 'provider' | 'tokens' | 'type' | 'user'
type SortState = { dir: 'asc' | 'desc'; key: SortKey } | null

interface SpendTableProps {
  data: SpendLogEntry[]
  isLoading: boolean
  onPageChange: (page: number) => void
  page: number
  pageSize: number
  totalCount: number
}

function sortValue(row: SpendLogEntry, key: SortKey): number | string {
  switch (key) {
    case 'date':
      return getLogTimestamp(row)

    case 'user':
      return getLogUser(row).toLowerCase()

    case 'model':
      return row.model.toLowerCase()

    case 'provider':
      return (row.custom_llm_provider ?? '').toLowerCase()

    case 'type':
      return formatTypeLabel(getSpendType(row.model)).toLowerCase()

    case 'tokens':
      return getTotalTokens(row)

    case 'credits':
      return row.spend ?? 0
  }
}

function HeadCell({
  active,
  dir,
  label,
  onSort,
  sortKey
}: {
  active: boolean
  dir: 'asc' | 'desc' | undefined
  label: string
  onSort: (key: SortKey) => void
  sortKey: SortKey
}) {
  return (
    <th className="px-3 py-2 text-left font-medium" scope="col">
      <button
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => onSort(sortKey)}
        type="button"
      >
        {label}
        {active && (dir === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
      </button>
    </th>
  )
}

export function SpendTable({ data, isLoading, onPageChange, page, pageSize, totalCount }: SpendTableProps) {
  const { t } = useI18n()
  const s = t.settings.billing.spend
  const [sort, setSort] = useState<SortState>(null)

  const totalPages = Math.ceil(totalCount / pageSize)

  const rows = useMemo(() => {
    if (!sort) {
      return data
    }

    const factor = sort.dir === 'asc' ? 1 : -1

    return [...data].sort((a, b) => {
      const av = sortValue(a, sort.key)
      const bv = sortValue(b, sort.key)

      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * factor
      }

      return String(av).localeCompare(String(bv)) * factor
    })
  }, [data, sort])

  const totalCredits = useMemo(() => data.reduce((sum, row) => sum + (row.spend ?? 0), 0), [data])

  const toggleSort = (key: SortKey) =>
    setSort(current =>
      current?.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )

  const handleDownload = () => downloadCSV(data, `spend_report_${new Date().toISOString().slice(0, 10)}`)

  return (
    <div className="rounded-md border border-(--ui-stroke-secondary)">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-stroke-tertiary) px-4 py-2.5">
        <h2 className="text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
          {s.spendDetails}
        </h2>
        <div className="flex items-center gap-3">
          <Button disabled={data.length === 0} onClick={handleDownload} size="sm" type="button" variant="outline">
            <Download className="size-3.5" />
            {s.downloadCsv}
          </Button>
          <div className="flex items-center gap-1.5 rounded-md bg-(--ui-bg-quaternary) px-2.5 py-1 text-[length:var(--conversation-caption-font-size)]">
            <span className="text-(--ui-text-tertiary)">{s.totalCredits}:</span>
            <span className="font-semibold tabular-nums">{formatCredits(totalCredits)}</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[length:var(--conversation-caption-font-size)]">
          <thead className="bg-(--ui-bg-tertiary) text-(--ui-text-tertiary)">
            <tr>
              <HeadCell
                active={sort?.key === 'date'}
                dir={sort?.dir}
                label={s.date}
                onSort={toggleSort}
                sortKey="date"
              />
              <HeadCell
                active={sort?.key === 'user'}
                dir={sort?.dir}
                label={s.username}
                onSort={toggleSort}
                sortKey="user"
              />
              <HeadCell
                active={sort?.key === 'model'}
                dir={sort?.dir}
                label={s.model}
                onSort={toggleSort}
                sortKey="model"
              />
              <HeadCell
                active={sort?.key === 'provider'}
                dir={sort?.dir}
                label={s.provider}
                onSort={toggleSort}
                sortKey="provider"
              />
              <HeadCell
                active={sort?.key === 'type'}
                dir={sort?.dir}
                label={s.type}
                onSort={toggleSort}
                sortKey="type"
              />
              <HeadCell
                active={sort?.key === 'tokens'}
                dir={sort?.dir}
                label={s.tokens}
                onSort={toggleSort}
                sortKey="tokens"
              />
              <HeadCell
                active={sort?.key === 'credits'}
                dir={sort?.dir}
                label={s.credits}
                onSort={toggleSort}
                sortKey="credits"
              />
            </tr>
          </thead>
          <tbody className="text-[length:var(--conversation-text-font-size)]">
            {isLoading ? (
              <tr>
                <td className="px-3 py-8 text-center text-(--ui-text-tertiary)" colSpan={7}>
                  {s.loadingData}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-(--ui-text-tertiary)" colSpan={7}>
                  {s.noData}
                </td>
              </tr>
            ) : (
              rows.map(row => {
                const user = getLogUser(row)
                const type = getSpendType(row.model)
                const output = getOutputTokens(row)
                const input = getInputTokens(row)
                const total = getTotalTokens(row)
                const cacheRead = row.cache_read_input_tokens ?? 0

                return (
                  <tr
                    className="border-t border-(--ui-stroke-tertiary) hover:bg-(--ui-bg-tertiary)"
                    key={row.request_id}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-(--ui-text-secondary)">
                      {formatDate(getLogDate(row))}
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-secondary)">
                      <OverflowTip label={user}>
                        <div className="max-w-[10rem] truncate">{user}</div>
                      </OverflowTip>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[0.6875rem] text-foreground">
                      {formatModelName(row.model)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 capitalize text-(--ui-text-secondary)">
                      {row.custom_llm_provider || '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Pill tone={getTypeTone(type)}>{formatTypeLabel(type)}</Pill>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-center gap-1 text-(--ui-text-tertiary)">
                        <Tip label={s.totalTokens}>
                          <span className="rounded bg-(--ui-bg-tertiary) px-2 py-0.5 tabular-nums">
                            {total.toLocaleString()}
                          </span>
                        </Tip>
                        <span>=</span>
                        <Tip label={s.outputTokens}>
                          <span className="inline-flex items-center gap-1 rounded bg-(--ui-bg-tertiary) px-1.5 py-0.5 tabular-nums">
                            <ArrowBarToDown className="size-3" />
                            {output.toLocaleString()}
                          </span>
                        </Tip>
                        <span>+</span>
                        <Tip label={s.inputTokens}>
                          <span className="inline-flex items-center gap-1 rounded bg-(--ui-bg-tertiary) px-1.5 py-0.5 tabular-nums">
                            <ArrowBarToUp className="size-3" />
                            {input.toLocaleString()}
                          </span>
                        </Tip>
                        {cacheRead > 0 && (
                          <>
                            <span>+</span>
                            <Tip label={s.cacheReadTokens}>
                              <span className="inline-flex items-center gap-1 rounded bg-(--ui-bg-tertiary) px-1.5 py-0.5 tabular-nums">
                                <Clock className="size-3" />
                                {cacheRead.toLocaleString()}
                              </span>
                            </Tip>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums text-foreground">
                      {formatCredits(row.spend ?? 0)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-(--ui-stroke-tertiary) px-4 py-2.5 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
          <span>{s.pageOf(page, totalPages, totalCount)}</span>
          <div className="flex items-center gap-2">
            <Button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              size="sm"
              type="button"
              variant="outline"
            >
              {t.ui.pagination.previous}
            </Button>
            <Button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              size="sm"
              type="button"
              variant="outline"
            >
              {t.ui.pagination.next}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
