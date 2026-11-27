import { readFileSync } from 'node:fs'

import type * as HermesSdk from '@hermes/plugin-sdk'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registerPluginLocales } from '@/i18n/plugin-i18n'
import { queryClient } from '@/lib/query-client'

// @ts-expect-error
import * as plugin from '../../../../desktop-plugins/knowledge-base/plugin.js'

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  snapshot: null as unknown as { get: () => unknown; set: (value: unknown) => void }
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  mocks.snapshot = sdk.atom({ activeOrganization: { id: 'org_1' }, status: 'signed-in', user: { id: 'user_1' } })

  return {
    ...sdk,
    host: {
      ...sdk.host,
      clerk: {
        getToken: mocks.getToken,
        snapshot: mocks.snapshot
      },
      notify: vi.fn()
    }
  }
})

const disposeI18n = registerPluginLocales(plugin.ID, plugin.LOCALES)

function renderWithQuery(ui: ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    config: vi.fn().mockResolvedValue({ configured: true, session: true }),
    clearSession: vi.fn().mockResolvedValue(undefined),
    bases: vi.fn().mockResolvedValue({ owned: [{ id: 'kb1', name: 'Contracts', shared: false }], shared: [] }),
    createBase: vi.fn().mockResolvedValue({ id: 'kb_new' }),
    renameBase: vi.fn().mockResolvedValue({ ok: true }),
    deleteBase: vi.fn().mockResolvedValue({ ok: true }),
    files: vi.fn().mockResolvedValue({ files: [] }),
    removeFiles: vi.fn().mockResolvedValue({ ok: true }),
    retryFile: vi.fn().mockResolvedValue({ ok: true }),
    downloadUrl: vi.fn().mockResolvedValue('https://bucket.example/get?sig=1'),
    search: vi.fn().mockResolvedValue({ chunks: [] }),
    activeBases: vi.fn().mockResolvedValue(null),
    setActiveBases: vi.fn(async (ids: string[]) => ids),
    uploadFile: vi.fn().mockResolvedValue({ duplicate: false, fileId: 'file_new' }),
    ...overrides
  }
}

function renderTab(api: ReturnType<typeof fakeApi>, props: Record<string, unknown> = {}) {
  const notify = vi.fn()
  const openExternal = vi.fn()

  renderWithQuery(
    <plugin.KnowledgeBaseTab
      api={api}
      canShareSession
      notify={notify}
      openExternal={openExternal}
      signIn={null}
      {...props}
    />
  )

  return { notify, openExternal }
}

function ipcError(status: number, detail: string) {
  return new Error(`Error invoking remote method 'hermes:api': Error: ${status}: {"detail":"${detail}"}`)
}

function file(overrides: Record<string, unknown>) {
  return {
    id: 'f1',
    baseId: 'kb1',
    name: 'contract.pdf',
    contentType: 'application/pdf',
    size: 2048,
    status: 'ready',
    error: null,
    chunkCount: 4,
    skippedPages: [],
    progress: { done: 0, total: 0 },
    createdAt: Date.parse('2026-11-01T00:00:00Z'),
    ...overrides
  }
}

beforeEach(() => {
  mocks.snapshot.set({ activeOrganization: { id: 'org_1' }, status: 'signed-in', user: { id: 'user_1' } })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.clearAllMocks()
  vi.useRealTimers()
})

afterAll(() => {
  disposeI18n()
})

describe('knowledge base helpers', () => {
  it('ships identical bundled and disk copies', () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

    expect(read('../plugins/knowledge-base/plugin.js')).toBe(
      read('../../../../desktop-plugins/knowledge-base/plugin.js')
    )
  })

  it('tracks pending files, progress and skipped pages', () => {
    expect(plugin.isFilePending(file({ status: 'uploading' }))).toBe(true)
    expect(plugin.isFilePending(file({ status: 'pending' }))).toBe(true)
    expect(plugin.isFilePending(file({ status: 'processing' }))).toBe(true)
    expect(plugin.isFilePending(file({ status: 'ready' }))).toBe(false)
    expect(plugin.isFilePending(file({ status: 'error' }))).toBe(false)
    expect(plugin.fileProgress(file({ progress: { done: 3, total: 10 } }))).toEqual({ done: 3, total: 10 })
    expect(plugin.fileProgress(file({ progress: { done: 0, total: 0 } }))).toBeNull()
    expect(plugin.skippedPagesLabel(file({ skippedPages: [4, 7] }))).toBe('4, 7')
    expect(plugin.skippedPagesLabel(file({ skippedPages: [] }))).toBeNull()
  })

  it('normalizes bases and size limits', () => {
    expect(plugin.normalizeBases({ owned: [{ id: 'a' }, { name: 'no id' }], shared: [{ id: 'b' }] })).toEqual({
      owned: [{ id: 'a', shared: false }],
      shared: [{ id: 'b', shared: true }]
    })
    expect(plugin.fileExceedsSizeLimit({ name: 'big.pdf', type: 'application/pdf', size: plugin.PDF_MAX_BYTES })).toBe(
      false
    )
    expect(plugin.fileExceedsSizeLimit({ name: 'big.txt', type: 'text/plain', size: plugin.OTHER_MAX_BYTES + 1 })).toBe(
      true
    )
  })

  it('keeps a neighbour selected after deleting a base', () => {
    const bases = [{ id: 'a' }, { id: 'b' }, { id: 'c', shared: true }]

    expect(plugin.pickKnowledgeBaseAfterDelete(bases, 'a')).toBe('b')
    expect(plugin.pickKnowledgeBaseAfterDelete(bases, 'b')).toBe('c')
    expect(plugin.pickKnowledgeBaseAfterDelete([{ id: 'a' }], 'a')).toBeNull()
    expect(plugin.pickDefaultKnowledgeBaseId([{ id: 's', shared: true }, { id: 'm' }])).toBe('m')
  })

  it('reads status and code from desktop REST errors', () => {
    const error = ipcError(428, 'kb_session_invalid')

    expect(plugin.errorStatus(error)).toBe(428)
    expect(plugin.errorCode(error)).toBe('kb_session_invalid')
    expect(plugin.isSessionError(error)).toBe(true)
    expect(plugin.isSessionError(ipcError(428, 'kb_not_configured'))).toBe(false)
    expect(plugin.isNotConfiguredError(ipcError(428, 'kb_not_configured'))).toBe(true)
    expect(plugin.isSessionError(ipcError(502, 'upstream'))).toBe(false)
    expect(plugin.errorMessage(new Error("Error invoking remote method 'hermes:api': Error: offline"))).toBe('offline')
  })

  it('names the failed step and the request id to quote', () => {
    const en = plugin.LOCALES.en

    const t = (key: string, ...args: unknown[]) => {
      const value = key.split('.').reduce<any>((node, part) => node?.[part], en)

      return typeof value === 'function' ? value(...args) : (value ?? key)
    }

    const error = new Error(
      `Error invoking remote method 'hermes:api': Error: 502: {"detail":"upstream","step":"search_embed","service":"embeddings","requestId":"hermes_0123456789abcdef"}`
    )

    expect(plugin.errorCode(error)).toBe('upstream')
    expect(plugin.errorTrace(error)).toEqual({ requestId: 'hermes_0123456789abcdef', step: 'search_embed' })
    expect(plugin.localizedError(t, error)).toBe(
      'The knowledge base service is unavailable. Try again later. (Failed at search embeddings, ref hermes_0123456789abcdef)'
    )
    expect(plugin.localizedError(t, ipcError(404, 'not_found'))).toBe('This item no longer exists.')
    expect(plugin.stepLabel(t, 'brand_new_step')).toBe('brand_new_step')
    expect(plugin.fileErrorText(t, file({ status: 'error', error: 'embeddings 429: busy', errorStep: 'embed' }))).toBe(
      'Failed at embeddings: embeddings 429: busy'
    )
    expect(plugin.fileErrorText(t, file({ status: 'error', error: 'old error' }))).toBe('old error')
  })
})

describe('knowledge base session sync', () => {
  it('pushes a fresh token immediately, every 40 s and on organization change, then stops', async () => {
    const rest = vi.fn().mockResolvedValue({ ok: true })
    const getToken = vi.fn().mockResolvedValue('t1')
    const session = plugin.createSessionSync(rest, { getToken })
    const timers: Array<{ fn: () => void; ms: number }> = []
    const disposers: Array<() => void> = []

    plugin.startSessionSync({
      clerk: { getToken, snapshot: mocks.snapshot },
      onDispose: (fn: () => void) => disposers.push(fn),
      session,
      setInterval: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })

        return () => undefined
      }
    })

    await session.ready()
    expect(rest).toHaveBeenCalledWith('/session', { method: 'PUT', body: { token: 't1' } })
    expect(timers.map(timer => timer.ms)).toEqual([plugin.SESSION_PUSH_MS])
    expect(plugin.SESSION_PUSH_MS).toBe(40_000)

    getToken.mockResolvedValue('t2')
    timers[0].fn()
    await session.ready()
    expect(rest).toHaveBeenLastCalledWith('/session', { method: 'PUT', body: { token: 't2' } })

    getToken.mockResolvedValue('t3')
    mocks.snapshot.set({ activeOrganization: { id: 'org_2' }, status: 'signed-in', user: { id: 'user_1' } })
    await session.ready()
    expect(rest).toHaveBeenLastCalledWith('/session', { method: 'PUT', body: { token: 't3' } })

    mocks.snapshot.set({ activeOrganization: null, status: 'signed-out', user: null })
    await waitFor(() => expect(rest).toHaveBeenLastCalledWith('/session', { method: 'DELETE' }))

    const calls = rest.mock.calls.length
    disposers.forEach(dispose => dispose())
    mocks.snapshot.set({ activeOrganization: { id: 'org_3' }, status: 'signed-in', user: { id: 'user_1' } })
    await session.ready()
    expect(rest.mock.calls.length).toBe(calls)
  })

  it('skips the push while Clerk is not ready', async () => {
    const rest = vi.fn()

    const session = plugin.createSessionSync(rest, {
      getToken: vi.fn().mockRejectedValue(new Error('Clerk not ready'))
    })

    await expect(session.push(true)).resolves.toBe(false)
    expect(rest).not.toHaveBeenCalled()
  })

  it('never logs the token', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(name =>
      vi.spyOn(console, name).mockImplementation(() => undefined)
    )

    const rest = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({})
    const session = plugin.createSessionSync(rest, { getToken: vi.fn().mockResolvedValue('secret-token') })

    await session.push(true)
    await session.push(true)

    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain('secret-token')
      spy.mockRestore()
    }
  })
})

describe('knowledge base REST client', () => {
  it('maps every call to the plugin routes', async () => {
    const rest = vi.fn().mockResolvedValue({ url: 'https://bucket.example/x' })
    const api = plugin.createKnowledgeApi(rest)

    await api.files('kb 1')
    await api.renameBase('kb1', 'New')
    await api.deleteBase('kb1')
    await api.removeFiles(['f1', 'f2'])
    await api.retryFile('f1')
    await expect(api.downloadUrl('f1')).resolves.toBe('https://bucket.example/x')
    await api.search('what', ['kb1'])
    await api.createBase({ name: 'A', description: undefined })

    expect(rest.mock.calls).toEqual([
      ['/bases/kb%201/files', undefined],
      ['/bases/kb1', { method: 'PATCH', body: { name: 'New' } }],
      ['/bases/kb1', { method: 'DELETE' }],
      ['/files/remove', { method: 'POST', body: { ids: ['f1', 'f2'] } }],
      ['/files/f1/retry', { method: 'POST' }],
      ['/files/f1/download', undefined],
      ['/search', { method: 'POST', body: { query: 'what', baseIds: ['kb1'] } }],
      ['/bases', { method: 'POST', body: { name: 'A', description: undefined } }]
    ])
  })

  it('tags shared bases', async () => {
    const rest = vi.fn().mockResolvedValue({ owned: [{ id: 'a' }], shared: [{ id: 'b' }] })

    await expect(plugin.createKnowledgeApi(rest).bases()).resolves.toEqual({
      owned: [{ id: 'a', shared: false }],
      shared: [{ id: 'b', shared: true }]
    })
  })

  it('re-pushes the token and retries once when the backend asks for a session', async () => {
    const rest = vi
      .fn()
      .mockRejectedValueOnce(ipcError(428, 'kb_session_required'))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ owned: [], shared: [] })

    const session = plugin.createSessionSync(rest, { getToken: vi.fn().mockResolvedValue('t1') })
    const api = plugin.createKnowledgeApi(rest, session)

    await expect(api.bases()).resolves.toEqual({ owned: [], shared: [] })
    expect(rest.mock.calls.map(call => call[0])).toEqual(['/bases', '/session', '/bases'])
  })

  it('does not retry when the backend is not configured', async () => {
    const rest = vi.fn().mockRejectedValue(ipcError(428, 'kb_not_configured'))
    const session = plugin.createSessionSync(rest, { getToken: vi.fn().mockResolvedValue('t1') })
    const api = plugin.createKnowledgeApi(rest, session)

    await expect(api.bases()).rejects.toThrow('kb_not_configured')
    expect(rest).toHaveBeenCalledTimes(1)
  })

  it('uploads files as single-file multipart', async () => {
    const rest = vi.fn().mockResolvedValue({})
    const api = plugin.createKnowledgeApi(rest)
    const upload = new File(['hello'], 'notes.txt', { type: 'text/plain' })

    await api.uploadFile('kb1', upload)

    const [path, options] = rest.mock.calls[0]
    expect(path).toBe('/bases/kb1/files')
    expect(options.method).toBe('POST')
    expect(options.timeoutMs).toBeGreaterThan(60_000)
    expect(options.upload.filename).toBe('notes.txt')
    expect(options.upload.contentType).toBe('text/plain')
    expect(new TextDecoder().decode(options.upload.bytes)).toBe('hello')
  })
})

describe('knowledge base tab', () => {
  it('lists files with status, progress, skipped pages, errors and retry', async () => {
    const api = fakeApi({
      files: vi.fn().mockResolvedValue({
        files: [
          file({ skippedPages: [3, 9] }),
          file({
            id: 'f2',
            name: 'draft.pdf',
            status: 'error',
            error: 'unstructured 500: Parser crashed',
            errorStep: 'partition',
            chunkCount: 0
          }),
          file({ id: 'f3', name: 'big.pdf', status: 'processing', progress: { done: 2, total: 5 } })
        ]
      })
    })

    renderTab(api)

    expect(await screen.findByText('contract.pdf')).toBeTruthy()
    expect(screen.getAllByText('Contracts').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2.0 KB').length).toBe(3)
    expect(screen.getByText('Pages skipped: 3, 9')).toBeTruthy()
    expect(screen.getByText('Failed at text extraction: unstructured 500: Parser crashed')).toBeTruthy()
    expect(screen.getByText('2/5 batches')).toBeTruthy()
    expect(api.files).toHaveBeenCalledWith('kb1')

    fireEvent.click(screen.getByRole('button', { name: 'Error, retry' }))
    await waitFor(() => expect(api.retryFile).toHaveBeenCalledWith('f2'))
  })

  it('polls the file list every 5 s while a file is being processed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const files = vi
      .fn()
      .mockResolvedValueOnce({ files: [file({ status: 'pending' })] })
      .mockResolvedValue({ files: [file({ status: 'ready' })] })

    const api = fakeApi({ files })

    renderTab(api)

    await waitFor(() => expect(files).toHaveBeenCalledTimes(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(plugin.FILES_POLL_MS + 100)
    })
    await waitFor(() => expect(files).toHaveBeenCalledTimes(2))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(plugin.FILES_POLL_MS * 2)
    })
    expect(files).toHaveBeenCalledTimes(2)
  })

  it('opens the presigned download URL', async () => {
    const api = fakeApi({ files: vi.fn().mockResolvedValue({ files: [file({})] }) })
    const { openExternal } = renderTab(api)

    await screen.findByText('contract.pdf')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'contract.pdf' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByText('Download'))

    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://bucket.example/get?sig=1'))
    expect(api.downloadUrl).toHaveBeenCalledWith('f1')
  })

  it('shows shared bases read-only', async () => {
    const api = fakeApi({
      bases: vi.fn().mockResolvedValue({
        owned: [{ id: 'kb1', name: 'Contracts', shared: false }],
        shared: [{ id: 'kb2', name: 'Team docs', shared: true, role: 'MEMBER' }]
      })
    })

    renderTab(api)

    fireEvent.click(await screen.findByText('Team docs'))

    expect(await screen.findByText('Shared, read-only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Upload files' })).toBeNull()
    await waitFor(() => expect(api.files).toHaveBeenCalledWith('kb2'))
  })

  it('asks the user to sign in when there is no Clerk user', async () => {
    mocks.snapshot.set({ activeOrganization: null, status: 'signed-out', user: null })
    const api = fakeApi()

    renderTab(api)

    expect(await screen.findByText('Sign in to Unitalk')).toBeTruthy()
    expect(api.bases).not.toHaveBeenCalled()
  })

  it('explains when the backend is not configured', async () => {
    const api = fakeApi({ config: vi.fn().mockResolvedValue({ configured: false, session: false }) })

    renderTab(api)

    expect(await screen.findByText('Knowledge base not configured')).toBeTruthy()
    expect(api.bases).not.toHaveBeenCalled()
  })

  it('creates the default base once, even when creation fails', async () => {
    const api = fakeApi({
      bases: vi.fn().mockResolvedValue({ owned: [], shared: [] }),
      createBase: vi.fn().mockRejectedValue(ipcError(502, 'upstream'))
    })

    const { notify } = renderTab(api)

    await waitFor(() => expect(api.createBase).toHaveBeenCalledTimes(1))
    expect(api.createBase).toHaveBeenCalledWith({ description: undefined, name: 'My first knowledge base' })
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', message: plugin.LOCALES.en.errors.upstream })
      )
    )
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    expect(api.createBase).toHaveBeenCalledTimes(1)
  })

  it('uploads picked files, skips files over the limit and reports duplicates', async () => {
    const api = fakeApi({
      uploadFile: vi
        .fn()
        .mockResolvedValueOnce({ duplicate: false, fileId: 'f_new' })
        .mockResolvedValueOnce({ duplicate: true, fileId: 'f_old' })
    })

    const { notify } = renderTab(api)

    await screen.findByText('Drag and drop your files here')
    const input = window.document.querySelector('input[type="file"]') as HTMLInputElement
    const small = new File(['data'], 'notes.txt', { type: 'text/plain' })
    const again = new File(['data'], 'copy.txt', { type: 'text/plain' })
    const big = new File(['x'], 'huge.txt', { type: 'text/plain' })
    Object.defineProperty(big, 'size', { value: plugin.OTHER_MAX_BYTES + 1 })

    fireEvent.change(input, { target: { files: [small, again, big] } })

    await waitFor(() => expect(api.uploadFile).toHaveBeenCalledTimes(2))
    expect(api.uploadFile).toHaveBeenCalledWith('kb1', small)
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', message: plugin.LOCALES.en.duplicateMessage(1) })
      )
    )
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', message: plugin.LOCALES.en.fileTooLarge })
    )
  })

  it('registers a Capabilities tab and starts the session sync', async () => {
    mocks.getToken.mockResolvedValue('t1')
    const register = vi.fn()
    const rest = vi.fn().mockResolvedValue({ ok: true })
    const setInterval = vi.fn(() => () => undefined)

    const ctx = {
      i18n: { register: vi.fn(), t: (key: string) => key },
      onDispose: vi.fn(),
      os: { openExternal: vi.fn(), writeClipboard: vi.fn() },
      register,
      rest,
      setInterval
    }

    plugin.default.register(ctx)

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ area: 'capabilities.tabs', id: 'bases', title: 'tabTitle' })
    )
    expect(window.document.querySelector('style[data-plugin="knowledge-base"]')?.textContent).toContain(
      'tab-knowledge-base:bases'
    )
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), plugin.SESSION_PUSH_MS)
    await waitFor(() => expect(rest).toHaveBeenCalledWith('/session', { method: 'PUT', body: { token: 't1' } }))
    expect(ctx.onDispose).toHaveBeenCalled()
  })
})

describe('knowledge base session credentials', () => {
  const credentials = {
    clientToken: 'client-secret',
    frontendApi: 'https://clerk.example.test',
    organizationId: 'org_1',
    sessionId: 'sess_1'
  }

  it('hands the backend Clerk credentials once instead of pushing tokens', async () => {
    const rest = vi.fn().mockResolvedValue({ ok: true })
    const getCredentials = vi.fn().mockResolvedValue(credentials)
    const getToken = vi.fn().mockResolvedValue('t1')
    const session = plugin.createSessionSync(rest, { getCredentials, getToken })

    await session.push(true)
    expect(rest).toHaveBeenCalledWith('/session', { method: 'PUT', body: { credentials } })
    expect(getToken).not.toHaveBeenCalled()

    await session.push(false) // the 40 s tick: unchanged credentials are not re-sent
    expect(rest).toHaveBeenCalledTimes(1)

    getCredentials.mockResolvedValue({ ...credentials, organizationId: 'org_2' })
    await session.push(false)
    expect(rest).toHaveBeenLastCalledWith('/session', {
      method: 'PUT',
      body: { credentials: { ...credentials, organizationId: 'org_2' } }
    })
  })

  it('re-sends unchanged credentials after a while so a backend that lost them recovers', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const rest = vi.fn().mockResolvedValue({ ok: true })
    const session = plugin.createSessionSync(rest, { getCredentials: vi.fn().mockResolvedValue(credentials) })

    await session.push(true)
    now.mockReturnValue(1_000_000 + plugin.CREDENTIALS_RESEND_MS + 1)
    await session.push(false)

    expect(rest).toHaveBeenCalledTimes(2)
    now.mockRestore()
  })

  it('falls back to pushing the session token when credentials are unavailable', async () => {
    const rest = vi.fn().mockResolvedValue({ ok: true })

    const session = plugin.createSessionSync(rest, {
      getCredentials: vi.fn().mockResolvedValue(null),
      getToken: vi.fn().mockResolvedValue('t1')
    })

    await session.push(true)

    expect(rest).toHaveBeenCalledWith('/session', { method: 'PUT', body: { token: 't1' } })
  })

  it('never logs the client token', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(name =>
      vi.spyOn(console, name).mockImplementation(() => undefined)
    )

    const rest = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({})
    const session = plugin.createSessionSync(rest, { getCredentials: vi.fn().mockResolvedValue(credentials) })

    await session.push(true)
    await session.push(true)

    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain('client-secret')
      spy.mockRestore()
    }
  })

  it('shares the session when the host offers either credentials or tokens', () => {
    expect(plugin.canShareClerkSession({ getSessionCredentials: vi.fn() })).toBe(true)
    expect(plugin.canShareClerkSession({ getToken: vi.fn() })).toBe(true)
    expect(plugin.canShareClerkSession({})).toBe(false)
  })
})

describe('knowledge base active selection', () => {
  it('maps the active-bases routes', async () => {
    const rest = vi
      .fn()
      .mockResolvedValueOnce({ baseIds: null })
      .mockResolvedValueOnce({ baseIds: ['kb1'] })

    const api = plugin.createKnowledgeApi(rest)

    await expect(api.activeBases()).resolves.toBeNull()
    await expect(api.setActiveBases(['kb1'])).resolves.toEqual(['kb1'])
    expect(rest.mock.calls).toEqual([
      ['/active-bases', undefined],
      ['/active-bases', { method: 'PUT', body: { baseIds: ['kb1'] } }]
    ])
  })

  it('toggles from "all" to an explicit list and drops bases that no longer exist', () => {
    expect(plugin.isBaseActive(null, 'a')).toBe(true)
    expect(plugin.isBaseActive(['b'], 'a')).toBe(false)
    expect(plugin.nextActiveBases(null, ['a', 'b', 'c'], 'b', false)).toEqual(['a', 'c'])
    expect(plugin.nextActiveBases(['gone', 'a'], ['a', 'b'], 'b', true)).toEqual(['a', 'b'])
    expect(plugin.nextActiveBases(['a'], ['a', 'b'], 'a', false)).toEqual([])
  })
})

describe('knowledge base composer menu', () => {
  function renderMenu(api: ReturnType<typeof fakeApi>) {
    const navigate = vi.fn()
    const notify = vi.fn()

    renderWithQuery(<plugin.KnowledgeComposerMenu api={api} canShareSession navigate={navigate} notify={notify} />)

    return { navigate, notify }
  }

  function menuApi(overrides: Record<string, unknown> = {}) {
    return fakeApi({
      activeBases: vi.fn().mockResolvedValue(null),
      bases: vi.fn().mockResolvedValue({
        owned: [{ id: 'kb1', name: 'Contracts', shared: false }],
        shared: [{ id: 'kb2', name: 'Team docs', shared: true }]
      }),
      setActiveBases: vi.fn(async (ids: string[]) => ids),
      ...overrides
    })
  }

  async function openMenu() {
    const trigger = await screen.findByRole('button', { name: /Knowledge: All knowledge bases/ })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })

    return trigger
  }

  it('renders nothing when the backend is not configured', async () => {
    const api = menuApi({ config: vi.fn().mockResolvedValue({ configured: false, session: false }) })
    renderMenu(api)

    await waitFor(() => expect(api.config).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Knowledge/ })).toBeNull()
  })

  it('lists owned and shared bases, all active until the user chooses', async () => {
    renderMenu(menuApi())
    await openMenu()

    const rows = await screen.findAllByRole('menuitemcheckbox')
    expect(rows.map(row => [row.textContent, row.getAttribute('aria-checked')])).toEqual([
      ['Contracts', 'true'],
      ['Team docs', 'true']
    ])
  })

  it('saves the selection when a base is unticked', async () => {
    const api = menuApi()
    renderMenu(api)
    await openMenu()

    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Team docs/ }))

    await waitFor(() => expect(api.setActiveBases).toHaveBeenCalledWith(['kb1']))
    expect(await screen.findByText('1 knowledge base')).toBeTruthy() // the menu header's summary
    expect(screen.getByRole('menuitemcheckbox', { name: /Team docs/ }).getAttribute('aria-checked')).toBe('false')
  })

  it('shows the saved selection and opens the manage tab', async () => {
    const api = menuApi({ activeBases: vi.fn().mockResolvedValue([]) })
    const { navigate } = renderMenu(api)

    const trigger = await screen.findByRole('button', { name: 'Knowledge: Knowledge bases off' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    const rows = await screen.findAllByRole('menuitemcheckbox')
    expect(rows.every(row => row.getAttribute('aria-checked') === 'false')).toBe(true)

    fireEvent.click(screen.getByText('Manage knowledge bases'))
    expect(navigate).toHaveBeenCalledWith(plugin.MANAGE_ROUTE)
  })

  it('reports a failed save and reloads the selection', async () => {
    const api = menuApi({ setActiveBases: vi.fn().mockRejectedValue(new Error('offline')) })
    const { notify } = renderMenu(api)
    await openMenu()

    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Contracts/ }))

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Could not update the active knowledge bases' })
      )
    )
    await waitFor(() => expect(api.activeBases).toHaveBeenCalledTimes(2))
  })
})

describe('knowledge base composer menu across organizations', () => {
  it('loads the selection of the organization that is active', async () => {
    const activeBases = vi.fn().mockResolvedValue(null)
    const api = fakeApi({ activeBases, bases: vi.fn().mockResolvedValue({ owned: [], shared: [] }) })

    renderWithQuery(<plugin.KnowledgeComposerMenu api={api} canShareSession navigate={vi.fn()} notify={vi.fn()} />)
    await waitFor(() => expect(activeBases).toHaveBeenCalledTimes(1))

    act(() => mocks.snapshot.set({ activeOrganization: { id: 'org_2' }, status: 'signed-in', user: { id: 'user_1' } }))

    await waitFor(() => expect(activeBases).toHaveBeenCalledTimes(2))
    act(() => mocks.snapshot.set({ activeOrganization: { id: 'org_1' }, status: 'signed-in', user: { id: 'user_1' } }))
  })
})
