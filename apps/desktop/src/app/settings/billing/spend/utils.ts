import type { SpendLogEntry, UniqueLogUser } from './types'

export type SpendTypeTone = 'destructive' | 'muted' | 'primary' | 'success' | 'warn'

export function formatCredits(amount: number): string {
  return (amount * 1000).toFixed(2)
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) {
    return '-'
  }

  try {
    const d = new Date(dateStr)

    if (Number.isNaN(d.getTime())) {
      return dateStr
    }

    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d)
  } catch {
    return dateStr
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Format a Date as YYYY-MM-DD (UTC) for the API + `<input type="date">`. */
export function toISODateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Validate a YYYY-MM-DD string (format + real calendar date). */
export function isValidISODate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE_RE.test(value)) {
    return false
  }

  const time = Date.parse(`${value}T00:00:00Z`)

  return !Number.isNaN(time)
}

/** Default spend range: last `days` days inclusive, ending today (UTC). */
export function getDefaultSpendRange(days = 30): { startDate: string; endDate: string } {
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000)

  return { startDate: toISODateString(start), endDate: toISODateString(end) }
}

/** Prefer `startTime`, fall back to legacy `created_at`. */
export function getLogDate(row: SpendLogEntry): string {
  return row.startTime ?? row.created_at ?? ''
}

export function getLogTimestamp(row: SpendLogEntry): number {
  const t = Date.parse(getLogDate(row))

  return Number.isNaN(t) ? 0 : t
}

/** Prefer `prompt_tokens`, fall back to legacy `input_tokens`. */
export function getInputTokens(row: SpendLogEntry): number {
  return row.prompt_tokens ?? row.input_tokens ?? 0
}

/** Prefer `completion_tokens`, fall back to legacy `output_tokens`. */
export function getOutputTokens(row: SpendLogEntry): number {
  return row.completion_tokens ?? row.output_tokens ?? 0
}

export function getTotalTokens(row: SpendLogEntry): number {
  if (typeof row.total_tokens === 'number') {
    return row.total_tokens
  }

  return getInputTokens(row) + getOutputTokens(row)
}

/** Stable user identifier used for filtering (user id when available). */
export function getLogUserKey(row: SpendLogEntry): string {
  const metadataId = row.metadata?.user_api_key_user_id

  if (typeof metadataId === 'string' && metadataId.trim()) {
    return metadataId.trim()
  }

  return (row.user_id ?? row.user ?? row.end_user ?? '').trim()
}

/** User display label: prefer an email, fall back to raw identifiers. */
export function getLogUser(row: SpendLogEntry): string {
  const email = row.user_email?.trim()

  if (email) {
    return email
  }

  const user = row.user?.trim() ?? ''

  if (user.includes('@')) {
    return user
  }

  const endUser = row.end_user?.trim() ?? ''

  if (endUser.includes('@')) {
    return endUser
  }

  return user || endUser || 'Unknown'
}

/** Attach Clerk-resolved emails to rows that do not carry one yet. */
export function attachUserEmails(data: SpendLogEntry[], emailsById: Map<string, string>): SpendLogEntry[] {
  if (emailsById.size === 0) {
    return data
  }

  let changed = false

  const rows = data.map(row => {
    if (row.user_email?.trim()) {
      return row
    }

    const email = emailsById.get(getLogUserKey(row))

    if (!email) {
      return row
    }

    changed = true

    return { ...row, user_email: email }
  })

  return changed ? rows : data
}

export function getUniqueUsers(data: SpendLogEntry[]): UniqueLogUser[] {
  const seen = new Set<string>()
  const result: UniqueLogUser[] = []

  for (const item of data) {
    const id = getLogUserKey(item)

    if (!id || seen.has(id)) {
      continue
    }

    seen.add(id)
    result.push({ id, label: getLogUser(item) })
  }

  return result.sort((a, b) => a.label.localeCompare(b.label))
}

/** Coarse request type inferred from the model slug, mirroring the web client. */
export function getSpendType(model: string): string {
  const slug = model ?? ''

  if (slug.includes('whisper') || slug.includes('transcri')) {
    return 'speech-to-text'
  }

  if (slug.includes('tts') || slug.includes('speech')) {
    return 'text-to-speech'
  }

  if (slug.includes('dall-e') || slug.includes('image')) {
    return 'image-generation'
  }

  if (slug.includes('embed')) {
    return 'embedding'
  }

  if (slug.includes('search')) {
    return 'web-search'
  }

  if (slug.includes('ocr')) {
    return 'ocr'
  }

  return 'text-generation'
}

export function getTypeTone(type: string): SpendTypeTone {
  switch (type) {
    case 'text-generation':

    case 'web-search':
      return 'primary'

    case 'embedding':
      return 'success'

    case 'image-generation':
      return 'warn'

    case 'speech-to-text':

    case 'text-to-speech':

    case 'audio-transcription':
      return 'destructive'

    default:
      return 'muted'
  }
}

export function formatTypeLabel(type: string | null): string {
  if (!type) {
    return 'Unknown'
  }

  return type
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function formatModelName(model: string): string {
  return model
    .replace('-20241022', '')
    .replace('-v1:0', '')
    .replace(/^gemini-2\.0-flash-thinking-exp.*/, 'gemini-2.0-flash-thinking-exp')
}

export function downloadCSV(data: SpendLogEntry[], filename: string): void {
  const headers = [
    'Date',
    'User',
    'Model',
    'Provider',
    'Input Tokens',
    'Output Tokens',
    'Total Tokens',
    'Cost (USD)',
    'Credits'
  ]

  const rows = data.map(row => [
    getLogDate(row),
    getLogUser(row),
    row.model,
    row.custom_llm_provider ?? '',
    String(getInputTokens(row)),
    String(getOutputTokens(row)),
    String(getTotalTokens(row)),
    (row.spend ?? 0).toFixed(6),
    formatCredits(row.spend ?? 0)
  ])

  const csvContent = [headers.join(','), ...rows.map(cells => cells.map(cell => `"${cell}"`).join(','))].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.setAttribute('href', url)
  link.setAttribute('download', `${filename}.csv`)
  link.style.visibility = 'hidden'
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
