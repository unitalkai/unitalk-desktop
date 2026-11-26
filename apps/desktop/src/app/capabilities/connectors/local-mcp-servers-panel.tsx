import { useEffect, useMemo, useState } from 'react'

import type { HermesGateway, ProfileScope } from '@/hermes'

import { useMcpServers } from '../mcp/use-mcp-servers'

import { ConnectorRowCard } from './connector-row-card'
import { joinLocalServers } from './data/join'
import { cardKey, deriveCards, localServerName } from './derive'
import { cardMatchesQuery } from './derive-page'
import { LocalConnectorDialog } from './local-dialog'
import { RemoveServerConfirm } from './local-slots'
import type { ConnectorCardModel } from './types'

export interface LocalMcpServersPanelProps {
  /** Config-key prefixes to omit (Pipedream passes its own `pipedream_`). */
  excludePrefixes?: readonly string[]
  gateway: HermesGateway | null
  /** Visible card count after `query` and `excludePrefixes`; the page heading
   *  reads this so it can hide itself when nothing is left. */
  onCountChange?: (count: number) => void
  profile: ProfileScope
  /** The surrounding page's search, applied to name/slug like the core page. */
  query?: string
}

/** Installed local MCP servers as the old Connectors "On this device" cards:
 *  on/off, authenticate, tools/logs/mcp.json, remove. No search chrome, no
 *  hosted connectors — a plugin embeds this beside its own catalog. */
export function LocalMcpServersPanel({
  excludePrefixes,
  gateway,
  onCountChange,
  profile,
  query = ''
}: LocalMcpServersPanelProps) {
  const mcp = useMcpServers({ gateway, profile })
  const [openKey, setOpenKey] = useState<null | string>(null)
  const [removeServer, setRemoveServer] = useState<null | ConnectorCardModel>(null)

  const local = useMemo(() => {
    const servers = joinLocalServers({
      catalog: mcp.catalog,
      servers: mcp.servers,
      status: mcp.statuses,
      toolCounts: mcp.toolCounts,
      usage: mcp.usageByServer
    })

    return excludePrefixes && excludePrefixes.length > 0
      ? servers.filter(server => !excludePrefixes.some(prefix => server.name.startsWith(prefix)))
      : servers
  }, [excludePrefixes, mcp.catalog, mcp.servers, mcp.statuses, mcp.toolCounts, mcp.usageByServer])

  const cards = useMemo(() => deriveCards({ bundled: [], hosted: [], local }), [local])
  const visible = useMemo(() => cards.filter(card => cardMatchesQuery(card, query)), [cards, query])
  const count = visible.length

  useEffect(() => {
    onCountChange?.(count)
  }, [count, onCountChange])

  const openCard = useMemo(() => visible.find(card => cardKey(card) === openKey) ?? null, [openKey, visible])

  if (mcp.configLoading && cards.length === 0) {
    return null
  }

  if (visible.length === 0) {
    return null
  }

  const runVerb = (card: ConnectorCardModel) => {
    if (card.verb === 'authenticate') {
      void mcp.authenticate(localServerName(card))

      return
    }

    setOpenKey(cardKey(card))
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map(card => (
          <ConnectorRowCard
            card={card}
            key={cardKey(card)}
            onOpen={() => setOpenKey(cardKey(card))}
            onServerToggle={next => void mcp.setServerEnabled(localServerName(card), next)}
            onVerb={() => runVerb(card)}
            selected={openKey === cardKey(card)}
          />
        ))}
      </div>

      {openCard ? (
        <LocalConnectorDialog
          card={openCard}
          controller={mcp}
          installing={false}
          onClose={() => setOpenKey(null)}
          onConnect={() => undefined}
          onInstall={() => undefined}
          onReconnect={() => undefined}
          onRemoveServer={() => setRemoveServer(openCard)}
          profile={profile}
        />
      ) : null}

      <RemoveServerConfirm
        card={removeServer}
        controller={mcp}
        onClose={() => setRemoveServer(null)}
        onRemoved={() => setOpenKey(null)}
      />
    </>
  )
}
