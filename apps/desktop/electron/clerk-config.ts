export const CLERK_RENDERER_SCHEME = 'unitalk-app'
export const CLERK_RENDERER_HOST = 'renderer'
export const CLERK_RENDERER_ORIGIN = `${CLERK_RENDERER_SCHEME}://${CLERK_RENDERER_HOST}/`
export const CLERK_TOKEN_STORAGE_NAME = 'unitalk-clerk-tokens'

declare const __UNITALK_CLERK_PUBLISHABLE_KEY__: string | undefined

export function clerkPublishableKey(): string {
  return typeof __UNITALK_CLERK_PUBLISHABLE_KEY__ === 'string' ? __UNITALK_CLERK_PUBLISHABLE_KEY__.trim() : ''
}

export function clerkEnabled(): boolean {
  return clerkPublishableKey().length > 0
}
