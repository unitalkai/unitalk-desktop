import { useStore } from '@nanostores/react'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { renameProfile } from '@/hermes'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { AlertCircle, Check, Globe, Loader2, Mail, ShieldCheck, Upload, User } from '@/lib/icons'
import { $clerkSession } from '@/store/clerk-session'
import { notifyError } from '@/store/notifications'
import { profileLabel, refreshProfiles } from '@/store/profile'

import { SettingsContent } from './primitives'
import { readProfileAvatarFile, uploadProfileAvatar, useDefaultProfile, useProfileAvatar } from './profile-identity'

export function ProfileSettings() {
  const { t } = useI18n()
  const copy = t.settings.identity
  const clerk = useStore($clerkSession)
  const profile = useDefaultProfile()
  const profileName = profile?.name ?? 'default'
  const currentName = profile ? profileLabel(profile) : 'default'
  const avatar = useProfileAvatar(profileName)
  const [name, setName] = useState(currentName)
  const [savingName, setSavingName] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setName(currentName)
  }, [currentName])

  const handleAvatarClick = () => {
    if (!uploading) {
      fileInputRef.current?.click()
    }
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setUploading(true)

    try {
      await uploadProfileAvatar(profileName, await readProfileAvatarFile(file))
      triggerHaptic('success')
    } catch (error) {
      notifyError(error, copy.avatarUploadFailed)
    } finally {
      setUploading(false)

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleNameBlur = async () => {
    const next = name.trim()

    if (!next || next === currentName) {
      setName(currentName)

      return
    }

    setSavingName(true)

    try {
      await renameProfile(profileName, next)
      setName(next)
      await refreshProfiles()
      triggerHaptic('selection')
    } catch (error) {
      notifyError(error, copy.saveFailed)
      setName(currentName)
    } finally {
      setSavingName(false)
    }
  }

  const user = clerk.user
  const userFullName = user?.fullName ?? user?.username ?? '—'
  const userEmail = user?.email ?? '—'
  const userOrganization = clerk.activeOrganization?.name ?? '—'
  const emailVerified = user?.emailVerified === true

  return (
    <SettingsContent>
      <div className="mx-auto grid w-full max-w-4xl gap-8">
        <section>
          <div className="flex items-center gap-6">
            <button
              aria-busy={uploading}
              aria-label={copy.avatarAlt}
              className="group relative size-20 shrink-0 overflow-hidden rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary)"
              disabled={uploading}
              onClick={handleAvatarClick}
              type="button"
            >
              {avatar ? (
                <img alt="" className="size-full object-cover" src={avatar} />
              ) : (
                <BrandMark className="size-20" />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-focus-visible:opacity-100 group-hover:opacity-100">
                {uploading ? (
                  <Loader2 className="size-5 animate-spin text-white" />
                ) : (
                  <Upload className="size-5 text-white" />
                )}
              </span>
            </button>
            <input
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={uploading}
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
            <div className="min-w-0 flex-1">
              <Field htmlFor="settings-profile-name" label={copy.nameLabel}>
                <Input
                  className="md:max-w-60"
                  disabled={savingName}
                  id="settings-profile-name"
                  onBlur={() => void handleNameBlur()}
                  onChange={event => setName(event.target.value)}
                  placeholder={copy.namePlaceholder}
                  size="lg"
                  type="text"
                  value={name}
                />
              </Field>
              {uploading && (
                <p className="mt-1.5 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                  {copy.uploading}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="border-t border-(--ui-stroke-tertiary) pt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
                {copy.ownershipTitle}
              </h3>
              <p className="mt-0.5 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                {copy.ownershipDesc}
              </p>
            </div>
            {emailVerified ? (
              <Badge className="gap-1.5" variant="success">
                <ShieldCheck />
                {copy.verifiedOwner}
              </Badge>
            ) : (
              <Badge className="gap-1.5" variant="warn">
                <AlertCircle />
                {copy.unverifiedEmail}
              </Badge>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 border-t border-(--ui-stroke-tertiary) pt-4 md:grid-cols-2">
            <Field
              label={
                <span className="flex items-center gap-1.5">
                  <User className="size-3.5" /> {copy.creatorName}
                </span>
              }
            >
              <Input disabled type="text" value={userFullName} />
            </Field>

            <Field
              label={
                <span className="flex items-center gap-1.5">
                  <Mail className="size-3.5" /> {copy.creatorEmail}
                </span>
              }
            >
              <Input
                disabled
                suffix={
                  emailVerified ? (
                    <span className="flex items-center gap-1 text-[0.6875rem] font-medium text-emerald-600 dark:text-emerald-300">
                      <Check className="size-3" /> {copy.verified}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[0.6875rem] font-medium text-amber-600 dark:text-amber-300">
                      <AlertCircle className="size-3" /> {copy.unverified}
                    </span>
                  )
                }
                type="email"
                value={userEmail}
              />
            </Field>

            <div className="md:col-span-2">
              <Field
                label={
                  <span className="flex items-center gap-1.5">
                    <Globe className="size-3.5" /> {copy.owner}
                  </span>
                }
              >
                <Input disabled type="text" value={userOrganization} />
              </Field>
            </div>
          </div>
        </section>
      </div>
    </SettingsContent>
  )
}
