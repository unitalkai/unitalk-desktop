import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'

import type { SpendFilters, UniqueLogUser } from './types'

interface SpendFiltersBarProps {
  disabled?: boolean
  filters: SpendFilters
  models: string[]
  onChange: (patch: Partial<SpendFilters>) => void
  users: UniqueLogUser[]
}

const LABEL = 'text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)'

export function SpendFiltersBar({ disabled, filters, models, onChange, users }: SpendFiltersBarProps) {
  const { t } = useI18n()
  const s = t.settings.billing.spend

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-quaternary) px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={LABEL}>{s.period}</span>
        <div className="flex items-center gap-1.5">
          <Input
            aria-label={s.period}
            className="w-[9.5rem]"
            disabled={disabled}
            onChange={event => onChange({ startDate: event.target.value })}
            size="sm"
            type="date"
            value={filters.startDate}
          />
          <span className={LABEL}>{s.to}</span>
          <Input
            aria-label={s.period}
            className="w-[9.5rem]"
            disabled={disabled}
            onChange={event => onChange({ endDate: event.target.value })}
            size="sm"
            type="date"
            value={filters.endDate}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className={LABEL}>{s.model}</span>
        <Select disabled={disabled} onValueChange={value => onChange({ model: value })} value={filters.model}>
          <SelectTrigger className="w-[11rem]" size="sm">
            <SelectValue placeholder={s.allModels} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{s.allModels}</SelectItem>
            {models.map(model => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {users.length > 0 && (
        <div className="flex items-center gap-2">
          <span className={LABEL}>{s.user}</span>
          <Select disabled={disabled} onValueChange={value => onChange({ user: value })} value={filters.user}>
            <SelectTrigger className="w-[11rem]" size="sm">
              <SelectValue placeholder={s.allUsers} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{s.allUsers}</SelectItem>
              {users.map(user => (
                <SelectItem key={user.id} value={user.id}>
                  {user.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
