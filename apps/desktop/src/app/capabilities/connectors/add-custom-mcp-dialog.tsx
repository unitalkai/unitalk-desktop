import type { HermesGateway, ProfileScope } from '@/hermes'

import { useMcpServers } from '../mcp/use-mcp-servers'

import { AddServerDialog } from './add-dialog'

export interface AddCustomMcpDialogProps {
  gateway: HermesGateway | null
  onOpenChange: (open: boolean) => void
  open: boolean
  profile: ProfileScope
}

/** The old Connectors page's "Add your own" dialog, standalone. The plugin
 *  door: mount it only while the user is adding a server, so a page that never
 *  opens it pays no MCP config read. */
export function AddCustomMcpDialog({ gateway, onOpenChange, open, profile }: AddCustomMcpDialogProps) {
  const controller = useMcpServers({ gateway, profile })

  return <AddServerDialog controller={controller} onOpenChange={onOpenChange} open={open} profile={profile} />
}
