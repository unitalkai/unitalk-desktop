import { describe, expect, it } from 'vitest'

import type { SpendLogEntry } from './types'
import { attachUserEmails, getLogUser, getUniqueUsers } from './utils'

function spendRow(overrides: Partial<SpendLogEntry>): SpendLogEntry {
  return {
    api_key: 'sk-test',
    model: 'gpt-4o',
    request_id: 'req_1',
    spend: 0,
    ...overrides
  }
}

describe('attachUserEmails', () => {
  it('resolves the Clerk user id to an email for display', () => {
    const data = [spendRow({ metadata: { user_api_key_user_id: 'user_1' } })]

    const [row] = attachUserEmails(data, new Map([['user_1', 'ada@example.com']]))

    expect(getLogUser(row)).toBe('ada@example.com')
  })

  it('keeps an email already present on the row', () => {
    const data = [spendRow({ metadata: { user_api_key_user_id: 'user_1' }, user_email: 'row@example.com' })]

    const [row] = attachUserEmails(data, new Map([['user_1', 'clerk@example.com']]))

    expect(row.user_email).toBe('row@example.com')
  })

  it('returns the same reference when nothing changes', () => {
    const data = [spendRow({ metadata: { user_api_key_user_id: 'user_1' } })]

    expect(attachUserEmails(data, new Map())).toBe(data)
    expect(attachUserEmails(data, new Map([['user_2', 'grace@example.com']]))).toBe(data)
  })

  it('labels the user filter with emails', () => {
    const data = [
      spendRow({ metadata: { user_api_key_user_id: 'user_1' }, request_id: 'req_1' }),
      spendRow({ metadata: { user_api_key_user_id: 'user_1' }, request_id: 'req_2' }),
      spendRow({ metadata: { user_api_key_user_id: 'user_2' }, request_id: 'req_3' })
    ]

    const users = getUniqueUsers(
      attachUserEmails(
        data,
        new Map([
          ['user_1', 'ada@example.com'],
          ['user_2', 'grace@example.com']
        ])
      )
    )

    expect(users).toEqual([
      { id: 'user_1', label: 'ada@example.com' },
      { id: 'user_2', label: 'grace@example.com' }
    ])
  })
})
