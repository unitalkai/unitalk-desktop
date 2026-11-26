import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import { LocalMcpServersPanel } from './local-mcp-servers-panel'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  removeServer: vi.fn().mockResolvedValue(true),
  setServerEnabled: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../mcp/use-mcp-servers', () => ({
  useMcpServers: () => ({
    authenticate: mocks.authenticate,
    catalog: [],
    configLoading: false,
    removeServer: mocks.removeServer,
    servers: {
      'my-server': { command: 'npx', args: ['-y', 'my-server'] },
      pipedream_slack: { url: 'https://pipedream.example/slack' }
    },
    setServerEnabled: mocks.setServerEnabled,
    statuses: { 'my-server': 'ok', pipedream_slack: 'ok' },
    toolCounts: { 'my-server': { on: 2, total: 3 } },
    usageByServer: {}
  })
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPanel(onCountChange = vi.fn()) {
  return render(
    <I18nProvider>
      <LocalMcpServersPanel
        excludePrefixes={['pipedream_']}
        gateway={null}
        onCountChange={onCountChange}
        profile="default"
      />
    </I18nProvider>
  )
}

describe('LocalMcpServersPanel', () => {
  it('renders installed custom servers and omits Pipedream-managed entries', async () => {
    const onCountChange = vi.fn()

    renderPanel(onCountChange)

    expect(await screen.findByText('My Server')).toBeTruthy()
    expect(screen.getByText('MCP · Custom')).toBeTruthy()
    expect(screen.queryByText('Pipedream Slack')).toBeNull()
    await waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(1))
  })

  it('toggles the server through the controller', async () => {
    renderPanel()

    fireEvent.click(await screen.findByRole('switch', { name: 'Turn My Server off' }))

    await waitFor(() => expect(mocks.setServerEnabled).toHaveBeenCalledWith('my-server', false))
  })
})
