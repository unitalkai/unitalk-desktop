import { pathToFileURL } from 'node:url'

import { type ClerkBridge, createClerkBridge } from '@clerk/electron'
import { storage } from '@clerk/electron/storage'
import { app, net, protocol } from 'electron'

import { CLERK_RENDERER_HOST, CLERK_RENDERER_SCHEME, CLERK_TOKEN_STORAGE_NAME, clerkEnabled } from './clerk-config'
import { resolveRendererFileRequest } from './renderer-url'

export interface ClerkRuntime {
  bridge: ClerkBridge | null
  enabled: boolean
}

export function installClerkBridge({
  devServer,
  registerProtocol = true
}: {
  devServer: string | null
  registerProtocol?: boolean
}): ClerkRuntime {
  if (!clerkEnabled()) {
    return { bridge: null, enabled: false }
  }

  try {
    const bridge = createClerkBridge({
      manageSingleInstanceLock: false,
      renderer:
        devServer || !registerProtocol ? undefined : { scheme: CLERK_RENDERER_SCHEME, host: CLERK_RENDERER_HOST },
      storage: storage({ name: CLERK_TOKEN_STORAGE_NAME }),
      userAgent: `Unitalk/${app.getVersion()}`
    })

    if (!bridge.isPrimaryInstance) {
      bridge.cleanup()

      return { bridge: null, enabled: false }
    }

    console.log(
      `[clerk] bridge installed${devServer ? ' (development: OAuth transport disabled)' : registerProtocol ? '' : ' (protocol registration skipped)'}`
    )

    return { bridge, enabled: true }
  } catch (error) {
    console.error(`[clerk] bridge setup failed: ${(error as Error).message}`)

    return { bridge: null, enabled: false }
  }
}

export function cleanupClerkBridge(runtime: ClerkRuntime): void {
  runtime.bridge?.cleanup()
}

export function registerClerkRendererProtocol(root: string): void {
  if (!clerkEnabled()) {
    return
  }

  protocol.handle(CLERK_RENDERER_SCHEME, async request => {
    const file = resolveRendererFileRequest(request.url, root)

    if (!file) {
      return new Response('Not found', { status: 404 })
    }

    try {
      return await net.fetch(pathToFileURL(file).toString())
    } catch (error) {
      console.error(`[clerk] renderer protocol failed for ${request.url}: ${(error as Error).message}`)

      return new Response('Renderer asset unavailable', { status: 500 })
    }
  })
}
