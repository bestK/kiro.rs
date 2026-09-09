import { useState } from 'react'
import { Calculator, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { DownstreamRatioBalancer } from '@/components/downstream-ratio-balancer'

export interface CreditPriceInputProps {
  /** 存储的单积分价格（USD / 积分），如 "0.002" 或 "" */
  value: string
  /** 当修改时触发，传入单积分价格字符串（如 "0.002"）或 ""（留空） */
  onChange: (val: string) => void
  disabled?: boolean
  placeholder?: string
  /** 是否允许清空（用于分组/Key 继承上一级） */
  allowClear?: boolean
  className?: string
}

function toDisplay(val: string, u: 'k' | 'single'): string {
  if (!val || val.trim() === '') return ''
  const num = Number(val)
  if (!Number.isFinite(num)) return ''
  if (u === 'k') {
    return String(+(num * 1000).toFixed(4))
  }
  return String(num)
}

export function CreditPriceInput({
  value,
  onChange,
  disabled,
  placeholder,
  allowClear = true,
  className,
}: CreditPriceInputProps) {
  const [unit, setUnit] = useState<'k' | 'single'>('k')
  const [draft, setDraft] = useState(() => toDisplay(value, 'k'))
  const [lastExternalVal, setLastExternalVal] = useState(value)
  const [showBalancer, setShowBalancer] = useState(false)

  // 外部 value 变更时同步
  if (value !== lastExternalVal) {
    setLastExternalVal(value)
    setDraft(toDisplay(value, unit))
  }

  const handleUnitSwitch = (newUnit: 'k' | 'single') => {
    if (newUnit === unit) return
    setUnit(newUnit)
    setDraft(toDisplay(value, newUnit))
  }

  const handleInputChange = (raw: string) => {
    setDraft(raw)
    if (raw.trim() === '') {
      onChange('')
      return
    }
    const num = Number(raw)
    if (!Number.isFinite(num) || num < 0) {
      return
    }
    if (unit === 'k') {
      const perOne = +(num / 1000).toFixed(6)
      onChange(String(perOne))
    } else {
      onChange(raw)
    }
  }

  const handlePresetClick = (presetVal: number) => {
    setDraft(String(presetVal))
    if (unit === 'k') {
      onChange(String(+(presetVal / 1000).toFixed(6)))
    } else {
      onChange(String(presetVal))
    }
  }

  const parsedNum = Number(draft)
  let conversionPreview: string | null = null
  if (draft.trim() !== '' && Number.isFinite(parsedNum) && parsedNum >= 0) {
    if (unit === 'k') {
      conversionPreview = `折合单积分价格：$${(parsedNum / 1000).toFixed(6)} / 积分`
    } else {
      conversionPreview = `折合每千分价格：$${(parsedNum * 1000).toFixed(4)} / 千分`
    }
  } else if (allowClear) {
    conversionPreview = '留空则继承上一级（分组或全局）单价'
  }

  const kPresets = [1, 1.5, 2, 2.5, 3]
  const singlePresets = [0.001, 0.0015, 0.002, 0.0025, 0.003]
  const presets = unit === 'k' ? kPresets : singlePresets
  const currentNum = Number(draft)

  return (
    <div className={cn('space-y-2', className)}>
      {/* 计价单位切换与快捷预设 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {presets.map((p) => {
            const isActive = Number.isFinite(currentNum) && currentNum === p
            return (
              <Button
                key={p}
                type="button"
                size="sm"
                variant={isActive ? 'default' : 'outline'}
                className="h-6 px-1.5 text-[11px] font-mono"
                disabled={disabled}
                onClick={() => handlePresetClick(p)}
              >
                ${p}
              </Button>
            )
          })}
        </div>
        <div className="inline-flex h-6 items-center rounded-md border border-border bg-secondary/50 p-0.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleUnitSwitch('k')}
            className={cn(
              'inline-flex h-5 items-center rounded px-2 text-[11px] font-medium transition-colors',
              unit === 'k'
                ? 'bg-card text-foreground shadow-xs border border-border/80'
                : 'text-muted-foreground hover:text-foreground border border-transparent'
            )}
          >
            $/千分 (推荐)
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleUnitSwitch('single')}
            className={cn(
              'inline-flex h-5 items-center rounded px-2 text-[11px] font-medium transition-colors',
              unit === 'single'
                ? 'bg-card text-foreground shadow-xs border border-border/80'
                : 'text-muted-foreground hover:text-foreground border border-transparent'
            )}
          >
            $/积分
          </button>
        </div>
      </div>

      {/* 数值输入框 */}
      <div className="relative flex items-center">
        <Input
          type="number"
          step="any"
          min="0"
          value={draft}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={
            placeholder ??
            (unit === 'k' ? '例如 2.0 (留空继承全局)' : '例如 0.002 (留空继承全局)')
          }
          disabled={disabled}
          className="pr-20 font-mono text-xs"
        />
        <span className="pointer-events-none absolute right-2.5 text-[11px] text-muted-foreground">
          {unit === 'k' ? 'USD / 千分' : 'USD / 积分'}
        </span>
      </div>

      {/* 实时换算与说明 */}
      {conversionPreview && (
        <p className="text-[11px] text-muted-foreground font-mono">
          {conversionPreview}
        </p>
      )}

      {/* 下游倍率自动配平助手展开按钮 */}
      <div className="pt-0.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShowBalancer((prev) => !prev)}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
        >
          <Calculator className="h-3 w-3" />
          <span>下游倍率配平助手</span>
          <span className="text-[10px] text-muted-foreground font-normal">
            (输入期望实收与倍率自动配平)
          </span>
          <ChevronDown
            className={cn(
              'h-3 w-3 transition-transform duration-200 text-muted-foreground',
              showBalancer && 'rotate-180 text-primary'
            )}
          />
        </button>
      </div>

      {/* 展开的配平助手 */}
      {showBalancer && (
        <DownstreamRatioBalancer
          compact
          currentUnit={unit}
          onApply={(singleVal, kVal) => {
            if (unit === 'k') {
              setDraft(String(kVal))
            } else {
              setDraft(String(singleVal))
            }
            onChange(String(singleVal))
            toast.success(`已应用配平单价: $${kVal}/千分 ($${singleVal}/积分)`)
          }}
        />
      )}
    </div>
  )
}
