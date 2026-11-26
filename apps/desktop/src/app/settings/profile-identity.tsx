import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useEffect, useMemo } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { useI18n } from '@/i18n'
import { blobToDataUrl } from '@/lib/base64'
import { $clerkSession } from '@/store/clerk-session'
import { $gateway } from '@/store/gateway'
import { $profiles, normalizeProfileKey, profileLabel, refreshProfiles } from '@/store/profile'
import { $unitalkAgent, refreshUnitalkAgent } from '@/store/unitalk-agent'
import type { ProfileInfo } from '@/types/hermes'

const AVATAR_MISS_TTL_MS = 30_000
const AVATAR_EDGE = 256
const MAX_AVATAR_FILE_BYTES = 15_000_000

interface ProfileAvatarEntry {
  at: number
  url: null | string
}

export const $profileAvatars = atom<Record<string, ProfileAvatarEntry>>({})

const avatarInflight = new Map<string, Promise<null | string>>()
const avatarGenerations = new Map<string, number>()

export function useDefaultProfile(): ProfileInfo | null {
  const profiles = useStore($profiles)

  useEffect(() => {
    void refreshProfiles().catch(() => undefined)
  }, [])

  return useMemo(() => profiles.find(profile => profile.is_default) ?? null, [profiles])
}

function writeProfileAvatarUrl(name: string, url: null | string): void {
  const key = normalizeProfileKey(name)

  avatarGenerations.set(key, (avatarGenerations.get(key) ?? 0) + 1)
  $profileAvatars.set({ ...$profileAvatars.get(), [key]: { at: Date.now(), url } })
}

export async function loadProfileAvatar(
  name: string,
  { force = false }: { force?: boolean } = {}
): Promise<null | string> {
  const key = normalizeProfileKey(name)
  const cached = $profileAvatars.get()[key]

  if (!force && cached && (cached.url !== null || Date.now() - cached.at < AVATAR_MISS_TTL_MS)) {
    return cached.url
  }

  const inflight = avatarInflight.get(key)

  if (inflight) {
    return inflight
  }

  const generation = avatarGenerations.get(key) ?? 0

  const run = (async (): Promise<null | string> => {
    const gateway = $gateway.get()

    if (!gateway) {
      return null
    }

    try {
      const res = await gateway.request<{ data?: string; found?: boolean }>('profiles.get_asset', {
        asset: 'avatar',
        name: key
      })

      return res?.found && res.data ? res.data : null
    } catch {
      return null
    } finally {
      avatarInflight.delete(key)
    }
  })()

  avatarInflight.set(key, run)
  const url = await run

  if ((avatarGenerations.get(key) ?? 0) === generation) {
    writeProfileAvatarUrl(key, url)
  }

  return url
}

export async function uploadProfileAvatar(name: string, data: string): Promise<void> {
  const gateway = $gateway.get()

  if (!gateway) {
    throw new Error('Gateway is not connected')
  }

  const res = await gateway.request<{ ok?: boolean }>('profiles.set_asset', {
    asset: 'avatar',
    data,
    name
  })

  if (res?.ok === false) {
    throw new Error('Avatar upload failed')
  }

  writeProfileAvatarUrl(name, data)
}

function squareAvatarDataUrl(dataUrl: string, edge: number): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = edge
        canvas.height = edge
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          resolve(dataUrl)

          return
        }

        const side = Math.min(img.width, img.height)
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, edge, edge)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(dataUrl)
      }
    }

    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

export async function readProfileAvatarFile(file: File): Promise<string> {
  if (file.size > MAX_AVATAR_FILE_BYTES) {
    throw new Error('Image too large (max 15MB)')
  }

  return squareAvatarDataUrl(await blobToDataUrl(file), AVATAR_EDGE)
}

export function useProfileAvatar(name: null | string): null | string {
  const avatars = useStore($profileAvatars)
  const key = name ? normalizeProfileKey(name) : null

  useEffect(() => {
    if (name) {
      void loadProfileAvatar(name)
    }
  }, [name])

  return key ? (avatars[key]?.url ?? null) : null
}

/** The signed-in Unitalk agent name, or null while signed out / unavailable. */
export function useUnitalkAgentName(): null | string {
  const agent = useStore($unitalkAgent)
  const session = useStore($clerkSession)
  const orgId = session.activeOrganization?.id ?? null
  const userId = session.user?.id ?? null

  useEffect(() => {
    void refreshUnitalkAgent()
  }, [orgId, session.status, userId])

  return agent.name
}

export function SettingsIdentityHeader() {
  const { t } = useI18n()
  const profile = useDefaultProfile()
  const agentName = useUnitalkAgentName()
  const name = agentName ?? (profile ? profileLabel(profile) : 'default')
  const avatar = useProfileAvatar(profile?.name ?? 'default')

  return (
    <div className="flex items-center gap-2.5 px-0.5 pb-2 pt-0.5">
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
        {avatar ? <img alt="" className="size-full object-cover" src={avatar} /> : <BrandMark className="size-9" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
          {name}
        </span>
        <span className="truncate text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
          {t.settings.identity.aiCollaborator}
        </span>
      </div>
    </div>
  )
}
