import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// Unitalk Cloud owns the checkout flow, so the Desktop just builds the checkout
// URL (with the user's chosen amount) and hands it to the host's external
// opener. Shared by the titlebar user panel and Settings > Billing > Buy credits
// so both surfaces show the exact same popup.
const CHECKOUT_URL = 'https://unitalk.ai/api/checkout/credits'
const CREDITS_DETAILS_URL = 'https://unitalk.ai/credits'
const CREDITS_PER_EURO = 500
const MAX_CUSTOM_AMOUNT = 9000
const MIN_CUSTOM_AMOUNT = 5
const PRESET_AMOUNTS = [5, 10, 25, 50, 100, 250]

const CREDITS_FORMAT = new Intl.NumberFormat('de-DE')
const EURO_FORMAT = new Intl.NumberFormat('de-DE', { currency: 'EUR', style: 'currency' })

const formatCredits = (amount: number) => CREDITS_FORMAT.format(amount * CREDITS_PER_EURO)
const formatEuro = (amount: number) => EURO_FORMAT.format(amount)

const clampAmount = (value: number | string) => {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return MIN_CUSTOM_AMOUNT
  }

  return Math.min(MAX_CUSTOM_AMOUNT, Math.max(MIN_CUSTOM_AMOUNT, parsed))
}

interface BuyCreditsDialogProps {
  onOpenChange: (open: boolean) => void
  onOpenUrl: (url: string) => void
  open: boolean
}

export function BuyCreditsDialog({ onOpenChange, onOpenUrl, open }: BuyCreditsDialogProps) {
  const [amount, setAmount] = useState(PRESET_AMOUNTS[0])
  const [custom, setCustom] = useState(false)
  const [draft, setDraft] = useState(String(PRESET_AMOUNTS[0]))

  useEffect(() => {
    if (open) {
      return
    }

    setAmount(PRESET_AMOUNTS[0])
    setCustom(false)
    setDraft(String(PRESET_AMOUNTS[0]))
  }, [open])

  const effectiveAmount = custom ? clampAmount(draft) : amount

  const choosePreset = (value: number) => {
    setAmount(value)
    setCustom(false)
  }

  const startCustom = () => {
    setDraft(String(amount))
    setCustom(true)
  }

  const blurCustom = () => {
    const next = clampAmount(draft)

    setAmount(next)
    setDraft(String(next))
  }

  const buy = () => {
    const referral = (window as { promotekit_referral?: unknown }).promotekit_referral
    const refCode = typeof referral === 'string' ? `&refCode=${encodeURIComponent(referral)}` : ''

    onOpenUrl(`${CHECKOUT_URL}?amount=${encodeURIComponent(effectiveAmount)}${refCode}`)
    onOpenChange(false)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader className="items-center">
          <div className="mb-1 grid size-16 place-items-center rounded-full bg-primary text-primary-foreground">
            <Codicon name="zap" size="2rem" />
          </div>
          <DialogTitle className="w-full text-center">Buy AI credits</DialogTitle>
          <DialogDescription className="text-center">
            Credits are the currency you use to chat, search the web, talk with your apps or generate images and video
            with any model in Unitalk{' '}
            <button
              className="cursor-pointer text-(--ui-blue) hover:underline"
              onClick={() => onOpenUrl(CREDITS_DETAILS_URL)}
              type="button"
            >
              View details
            </button>
          </DialogDescription>
        </DialogHeader>
        <div className="my-2 text-center text-3xl font-semibold text-primary">{formatEuro(effectiveAmount)}</div>
        <div className="grid grid-cols-3 gap-2">
          {PRESET_AMOUNTS.map(value => (
            <Button
              className={cn(
                'h-auto w-full flex-col gap-1 py-3',
                !custom &&
                  amount === value &&
                  'bg-(--ui-bg-quaternary) text-(--ui-text-primary) shadow-[inset_0_0_0_1.5px_var(--ui-purple)]'
              )}
              key={value}
              onClick={() => choosePreset(value)}
              type="button"
              variant="outline"
            >
              <span className="text-base font-semibold">{formatEuro(value)}</span>
              <span className="text-[0.6875rem] text-primary">{formatCredits(value)} AI credits</span>
            </Button>
          ))}
        </div>
        {custom ? (
          <Input
            aria-label="Custom credit amount"
            autoFocus
            className="w-full"
            max={MAX_CUSTOM_AMOUNT}
            min={MIN_CUSTOM_AMOUNT}
            onBlur={blurCustom}
            onChange={event => setDraft(event.target.value)}
            placeholder="Enter an amount (5 – 9,000)"
            type="number"
            value={draft}
          />
        ) : (
          <Button className="w-full" onClick={startCustom} type="button" variant="outline">
            Custom
          </Button>
        )}
        <DialogFooter>
          <Button className="w-full" onClick={buy} type="button">
            Buy credits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
