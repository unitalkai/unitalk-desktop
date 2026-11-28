import {
  Button,
  BuyCreditsDialog,
  cn,
  Codicon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  GlyphSpinner,
  host,
  Input,
  TITLEBAR_AREAS,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const PERSONAL_ORGANIZATION_ID = '__personal__'
/*
const CREDITS_PURPLE = '#7c3aed'
*/

const LINK_URLS = {
  aiCredits: 'https://agent.unitalk.ai/spend',
  bookDemo: 'https://cal.com/severine/unitalk-demo',
  pricing: 'https://unitalk.ai/home/tarifs'
}

// Hermes Web owns the LiteLLM gateway key, so the Desktop asks it for the
// active team's remaining credits instead of calling the gateway directly.
const TEAM_CREDITS_URL = 'https://agent.unitalk.ai/api/team'
const TEAM_CREDITS_REFRESH_MS = 60_000
const TEAM_CREDITS_FORMAT = new Intl.NumberFormat('fr-FR')
const teamCreditsCache = new Map()
const teamCreditsInflight = new Map()

const ICON = 'shrink-0 text-(--ui-text-secondary)'

const messageOf = error => (error instanceof Error && error.message) || String(error || 'Request failed')

const initials = value => {
  const words = String(value || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  return (words[0]?.[0] || '?').toUpperCase() + (words[1]?.[0] || '').toUpperCase()
}

const organizationImage = organization => organization?.imageUrl || null

function AccountAvatar({ className, imageUrl, label }) {
  return imageUrl
    ? jsx('img', {
        alt: '',
        className: cn('size-7 shrink-0 rounded-full object-cover', className),
        src: imageUrl
      })
    : jsx('span', {
        'aria-hidden': true,
        className: cn(
          'grid size-7 shrink-0 place-items-center rounded-full bg-(--ui-bg-quaternary) text-[0.6875rem] font-semibold text-(--ui-text-secondary)',
          className
        ),
        children: initials(label)
      })
}

function MenuActionRow({ icon, label, onSelect, trailing }) {
  return jsxs(DropdownMenuItem, {
    className: 'min-w-0 text-xs',
    onSelect,
    children: [icon, jsx('span', { className: 'min-w-0 flex-1 truncate', children: label }), trailing || null]
  })
}

function PublicMenuRows({ credits, onBuyCredits, onOpenSettings, openLink }) {
  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsx(MenuActionRow, {
        icon: jsx(Codicon, { className: ICON, name: 'settings', size: '0.875rem' }),
        key: 'settings',
        label: 'Settings',
        onSelect: onOpenSettings
      }),
      jsxs(MenuActionRow, {
        icon: jsx(Codicon, { className: ICON, name: 'zap', size: '0.875rem' }),
        key: 'ai-credits',
        label: 'AI Credits',
        onSelect: () => openLink(LINK_URLS.aiCredits),
        trailing: credits === null || credits === undefined ? null : jsx(AiCreditsValue, { credits })
      }),
      jsx(MenuActionRow, {
        icon: jsx(Codicon, { className: ICON, name: 'credit-card', size: '0.875rem' }),
        key: 'buy-credits',
        label: 'Buy credits',
        onSelect: onBuyCredits
      }),
      jsx(MenuActionRow, {
        icon: jsx(Codicon, { className: ICON, name: 'credit-card', size: '0.875rem' }),
        key: 'pricing',
        label: 'Pricing',
        onSelect: () => openLink(LINK_URLS.pricing)
      }),
      jsx(MenuActionRow, {
        icon: jsx(Codicon, { className: ICON, name: 'comment-discussion', size: '0.875rem' }),
        key: 'book-demo',
        label: 'Book a demo',
        onSelect: () => openLink(LINK_URLS.bookDemo)
      })
    ]
  })
}

function AiCreditsValue({ credits }) {
  return jsx('span', {
    className: 'ml-auto shrink-0 text-xs font-semibold tabular-nums text-(--ui-purple)',
    children: TEAM_CREDITS_FORMAT.format(credits)
  })
}

async function loadTeamCredits(organizationId) {
  const token = await host.clerk.getToken()

  if (!token) {
    return null
  }

  const response = await fetch(TEAM_CREDITS_URL, {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (!response.ok) {
    return null
  }

  const data = await response.json()
  const value = Number(data?.credits)

  if (!Number.isFinite(value)) {
    return null
  }

  const credits = Math.max(0, Math.floor(value))

  teamCreditsCache.set(organizationId, { credits, fetchedAt: Date.now() })

  return credits
}

function useTeamCredits({ menuOpen, organizationId, signedIn }) {
  const [credits, setCredits] = useState(null)

  useEffect(() => {
    if (!signedIn || !organizationId) {
      setCredits(null)

      return
    }

    const cached = teamCreditsCache.get(organizationId)

    if (cached) {
      setCredits(cached.credits)
    }

    if (cached && Date.now() - cached.fetchedAt < TEAM_CREDITS_REFRESH_MS) {
      return
    }

    if (!menuOpen && cached) {
      return
    }

    if (typeof host.clerk?.getToken !== 'function') {
      setCredits(cached?.credits ?? null)

      return
    }

    let cancelled = false
    let request = teamCreditsInflight.get(organizationId)

    if (!request) {
      request = loadTeamCredits(organizationId)
      teamCreditsInflight.set(organizationId, request)
      request
        .catch(() => undefined)
        .finally(() => {
          if (teamCreditsInflight.get(organizationId) === request) {
            teamCreditsInflight.delete(organizationId)
          }
        })
    }

    request
      .then(next => {
        if (!cancelled) {
          setCredits(next === null ? (cached?.credits ?? null) : next)
        }
      })
      .catch(() => {
        if (!cancelled && !cached) {
          setCredits(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [menuOpen, organizationId, signedIn])

  return credits
}

function CreateOrganizationDialog({ onOpenChange, open }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) {
      return
    }

    setName('')
    setSlug('')
    setError(null)
    setBusy(false)
  }, [open])

  const submit = async event => {
    event.preventDefault()

    if (busy || !name.trim()) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      await host.clerk.createOrganization({
        name: name.trim(),
        slug: slug.trim() || undefined
      })
      onOpenChange(false)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return jsx(Dialog, {
    onOpenChange,
    open,
    children: jsx(DialogContent, {
      className: 'sm:max-w-md',
      children: jsxs('form', {
        className: 'flex flex-col gap-4',
        onSubmit: submit,
        children: [
          jsxs(DialogHeader, {
            children: [
              jsx(DialogTitle, { children: 'Create organization' }),
              jsx(DialogDescription, {
                children: 'Create a new organization and make it the active one.'
              })
            ]
          }),
          jsxs('div', {
            className: 'flex flex-col gap-2',
            children: [
              jsx(Input, {
                'aria-label': 'Organization name',
                autoFocus: true,
                disabled: busy,
                onChange: event => setName(event.target.value),
                placeholder: 'Organization name',
                value: name
              }),
              jsx(Input, {
                'aria-label': 'Organization slug',
                disabled: busy,
                onChange: event => setSlug(event.target.value),
                placeholder: 'Slug (optional)',
                value: slug
              }),
              error
                ? jsx('div', {
                    className: 'rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive',
                    children: error
                  })
                : null
            ]
          }),
          jsxs(DialogFooter, {
            children: [
              jsx(Button, {
                disabled: busy,
                onClick: () => onOpenChange(false),
                type: 'button',
                variant: 'outline',
                children: 'Cancel'
              }),
              jsx(Button, {
                disabled: busy || !name.trim(),
                type: 'submit',
                children: busy ? 'Creating…' : 'Create'
              })
            ]
          })
        ]
      })
    })
  })
}

function UserPanelContent({ onOpenUrl }) {
  const snapshot = useValue(host.clerk.snapshot)
  const [menuOpen, setMenuOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [buyOpen, setBuyOpen] = useState(false)
  const [pendingOrganizationId, setPendingOrganizationId] = useState(null)
  const [organizationError, setOrganizationError] = useState(null)
  const [signingOut, setSigningOut] = useState(false)
  const [retryingSync, setRetryingSync] = useState(false)

  const openLink = url => {
    setMenuOpen(false)
    onOpenUrl(url)
  }

  const openSettings = () => {
    setMenuOpen(false)
    host.navigate('/settings?tab=profile')
  }

  const signedIn = snapshot.enabled && snapshot.status === 'signed-in' && Boolean(snapshot.user)
  const organizationId = signedIn ? (snapshot.activeOrganization?.id ?? null) : null
  const teamCredits = useTeamCredits({ menuOpen, organizationId, signedIn })

  // Signed out (or Clerk unavailable): keep the same panel, but replace the
  // organization switcher with a Login row that opens Clerk's sign-in modal.
  if (!signedIn) {
    const openSignIn = () => {
      if (typeof host.clerk.signIn !== 'function') {
        host.notifyError(new Error('Sign-in is not available in this app'), 'Could not open sign-in')
        return
      }

      void host.clerk.signIn().catch(error => host.notifyError(error, 'Could not open sign-in'))
    }

    return jsxs(DropdownMenu, {
      onOpenChange: setMenuOpen,
      open: menuOpen,
      children: [
        jsx(DropdownMenuTrigger, {
          asChild: true,
          children: jsx(Button, {
            'aria-label': 'Open account menu',
            className: 'text-(--ui-text-secondary)',
            size: 'icon-titlebar',
            style: { order: -1 },
            title: 'Sign in',
            type: 'button',
            variant: 'ghost',
            children: jsx(Codicon, { name: 'account', size: '1rem' })
          })
        }),
        jsxs(DropdownMenuContent, {
          align: 'start',
          className: 'min-w-52 max-w-72',
          side: 'bottom',
          sideOffset: 6,
          style: { width: '260px' },
          children: [
            jsx(MenuActionRow, {
              icon: jsx(Codicon, { className: ICON, name: 'sign-in', size: '0.875rem' }),
              key: 'sign-in',
              label: 'Log in',
              onSelect: () => {
                setMenuOpen(false)
                openSignIn()
              }
            }),
            jsx(DropdownMenuSeparator, {}),
            jsx(PublicMenuRows, {
              onBuyCredits: () => {
                setMenuOpen(false)
                setBuyOpen(true)
              },
              onOpenSettings: openSettings,
              openLink
            })
          ]
        }),
        jsx(BuyCreditsDialog, {
          onOpenChange: setBuyOpen,
          onOpenUrl,
          open: buyOpen
        })
      ]
    })
  }

  const user = snapshot.user
  const activeOrganization = snapshot.activeOrganization
  const currentLabel = activeOrganization?.name || 'Personal account'
  const currentImage = activeOrganization ? organizationImage(activeOrganization) : user.imageUrl
  const pending = pendingOrganizationId !== null

  const switchTo = async organizationId => {
    setOrganizationError(null)
    setPendingOrganizationId(organizationId ?? PERSONAL_ORGANIZATION_ID)

    try {
      await host.clerk.setActiveOrganization(organizationId)
      setMenuOpen(false)
    } catch (error) {
      setOrganizationError(messageOf(error))
    } finally {
      setPendingOrganizationId(null)
    }
  }

  const signOut = async () => {
    setSigningOut(true)

    try {
      await host.clerk.signOut()
    } catch (error) {
      host.notifyError(error, 'Sign-out failed')
      setSigningOut(false)
    }
  }

  const retryTokenSync = async () => {
    setRetryingSync(true)

    try {
      await host.clerk.refresh()
    } catch (error) {
      host.notifyError(error, 'Could not refresh the account token')
    } finally {
      setRetryingSync(false)
    }
  }

  return jsxs(DropdownMenu, {
    onOpenChange: next => {
      setMenuOpen(next)

      if (!next) {
        setOrganizationError(null)
      }
    },
    open: menuOpen,
    children: [
      jsx(DropdownMenuTrigger, {
        asChild: true,
        children: jsx(Button, {
          'aria-label': `Open account menu for ${currentLabel}`,
          className: 'text-(--ui-text-secondary)',
          size: 'icon-titlebar',
          style: { order: -1 },
          title: currentLabel,
          type: 'button',
          variant: 'ghost',
          children: jsx(AccountAvatar, {
            className: 'size-5',
            imageUrl: currentImage,
            label: currentLabel
          })
        })
      }),
      jsxs(DropdownMenuContent, {
        align: 'start',
        className: 'min-w-52 max-w-72',
        side: 'bottom',
        sideOffset: 6,
        style: { width: '260px' },
        children: [
          jsxs(DropdownMenuSub, {
            children: [
              jsx(DropdownMenuSubTrigger, {
                hideChevron: true,
                children: [
                  jsx(AccountAvatar, {
                    className: 'size-5',
                    imageUrl: currentImage,
                    label: currentLabel
                  }),
                  jsx('span', { className: 'min-w-0 flex-1 truncate', children: currentLabel }),
                  jsx(Codicon, {
                    className: 'ml-auto shrink-0 text-(--ui-text-tertiary)',
                    name: 'chevron-down',
                    size: '0.75rem'
                  })
                ]
              }),
              jsxs(DropdownMenuSubContent, {
                className: 'min-w-48 max-w-72',
                sideOffset: 8,
                children: [
                  organizationError
                    ? jsx('div', {
                        className: 'mx-1 mb-1 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive',
                        children: organizationError
                      })
                    : null,
                  jsxs('div', {
                    className: 'flex flex-col gap-1',
                    children: [
                      jsxs(
                        DropdownMenuItem,
                        {
                          className: 'min-w-0',
                          disabled: pending,
                          onSelect: event => {
                            event.preventDefault()
                            void switchTo(null)
                          },
                          children: [
                            jsx(AccountAvatar, {
                              className: 'size-5',
                              imageUrl: user.imageUrl,
                              label: user.fullName || user.email || user.username || 'Personal'
                            }),
                            jsx('span', {
                              className: 'min-w-0 flex-1 truncate',
                              children: 'Personal account'
                            }),
                            pendingOrganizationId === PERSONAL_ORGANIZATION_ID
                              ? jsx(GlyphSpinner, { className: 'ml-auto shrink-0' })
                              : !activeOrganization
                                ? jsx(Codicon, {
                                    className: 'ml-auto shrink-0 text-foreground',
                                    name: 'check',
                                    size: '0.75rem'
                                  })
                                : null
                          ]
                        },
                        'personal'
                      ),
                      ...snapshot.organizations.map(organization => {
                        const active = activeOrganization?.id === organization.id

                        return jsxs(
                          DropdownMenuItem,
                          {
                            className: 'min-w-0',
                            disabled: pending,
                            onSelect: event => {
                              event.preventDefault()
                              void switchTo(organization.id)
                            },
                            children: [
                              jsx(AccountAvatar, {
                                className: 'size-5',
                                imageUrl: organizationImage(organization),
                                label: organization.name
                              }),
                              jsx('span', {
                                className: 'min-w-0 flex-1 truncate',
                                children: organization.name
                              }),
                              pendingOrganizationId === organization.id
                                ? jsx(GlyphSpinner, { className: 'ml-auto shrink-0' })
                                : active
                                  ? jsx(Codicon, {
                                      className: 'ml-auto shrink-0 text-foreground',
                                      name: 'check',
                                      size: '0.75rem'
                                    })
                                  : null
                            ]
                          },
                          organization.id
                        )
                      })
                    ]
                  }),
                  jsx(DropdownMenuSeparator, {}),
                  jsxs(DropdownMenuItem, {
                    className: 'min-w-0',
                    disabled: pending,
                    onSelect: () => {
                      setMenuOpen(false)
                      setCreateOpen(true)
                    },
                    children: [
                      jsx(Codicon, { className: ICON, name: 'add', size: '0.875rem' }),
                      jsx('span', { className: 'min-w-0 flex-1 truncate', children: 'Create organization' })
                    ]
                  })
                ]
              })
            ]
          }),
          jsx(DropdownMenuSeparator, {}),
          jsx(PublicMenuRows, {
            credits: teamCredits,
            onBuyCredits: () => {
              setMenuOpen(false)
              setBuyOpen(true)
            },
            onOpenSettings: openSettings,
            openLink
          }),
          snapshot.tokenSyncError
            ? jsxs('div', {
                className: 'mx-2 my-1 rounded-md bg-(--ui-yellow)/10 px-2 py-1.5',
                children: [
                  jsx('div', {
                    className: 'text-xs text-(--ui-yellow)',
                    children: 'Organization switched, but the cloud credential did not sync.'
                  }),
                  jsx(Button, {
                    className: 'mt-1',
                    disabled: retryingSync,
                    onClick: () => void retryTokenSync(),
                    size: 'xs',
                    type: 'button',
                    variant: 'ghost',
                    children: retryingSync ? 'Retrying…' : 'Retry sync'
                  })
                ]
              })
            : null,
          snapshot.error
            ? jsx('div', {
                className: 'mx-2 my-1 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive',
                children: snapshot.error
              })
            : null,
          jsx(DropdownMenuSeparator, {}),
          jsxs(DropdownMenuItem, {
            disabled: signingOut,
            onSelect: () => void signOut(),
            children: [
              jsx(Codicon, { className: ICON, name: 'sign-out', size: '0.875rem' }),
              jsx('span', { className: 'min-w-0 flex-1 truncate', children: signingOut ? 'Logging out…' : 'Log out' })
            ]
          })
        ]
      }),
      jsx(CreateOrganizationDialog, {
        onOpenChange: setCreateOpen,
        open: createOpen
      }),
      jsx(BuyCreditsDialog, {
        onOpenChange: setBuyOpen,
        onOpenUrl,
        open: buyOpen
      })
    ]
  })
}

function UserPanel({ onOpenUrl }) {
  return host.clerk ? jsx(UserPanelContent, { onOpenUrl }) : null
}

export default {
  id: 'user-panel',
  name: 'User Panel',
  description: 'Account and organization switcher for Unitalk Cloud.',
  register(ctx) {
    const openUrl = url => void ctx.os.openExternal(url)

    ctx.register({
      id: 'header',
      area: TITLEBAR_AREAS.center,
      render: () => jsx(UserPanel, { onOpenUrl: openUrl })
    })
  }
}
