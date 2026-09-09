import { useState, useEffect } from 'react'
import { Clock, Calendar, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type TimeRangeType = 'preset' | 'custom'

export interface TimeRange {
  /** 模式：'preset' 快捷预设，'custom' 绝对自定义起止时间 */
  type?: TimeRangeType
  /** 预设标识，如 '15m', '1h', '6h', '24h', '3d', '7d', '30d', 'today', 'yesterday', 'all' */
  preset?: string | null
  /** 相对窗口分钟数；null = 不限时间 (兼容模式) */
  minutes?: number | null
  /** 绝对时间起点（格式 "YYYY-MM-DDTHH:mm" 或 ISO 字符串） */
  start?: string | null
  /** 绝对时间终点（格式 "YYYY-MM-DDTHH:mm" 或 ISO 字符串） */
  end?: string | null
}

export const TIME_PRESETS: {
  label: string
  minutes?: number | null
  preset: string
}[] = [
  { label: '最近 15 分钟', minutes: 15, preset: '15m' },
  { label: '最近 1 小时', minutes: 60, preset: '1h' },
  { label: '最近 6 小时', minutes: 360, preset: '6h' },
  { label: '最近 24 小时', minutes: 1440, preset: '24h' },
  { label: '今天全天', preset: 'today' },
  { label: '昨天全天', preset: 'yesterday' },
  { label: '最近 3 天', minutes: 60 * 24 * 3, preset: '3d' },
  { label: '最近 7 天', minutes: 60 * 24 * 7, preset: '7d' },
  { label: '不限时间', minutes: null, preset: 'all' },
]

/** 辅助：将 Date 转为 datetime-local 输入框所需的 YYYY-MM-DDTHH:mm 格式 */
export function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  return `${y}-${m}-${d}T${hh}:${mm}`
}

/** 辅助：格式化简短显示用日期时间 MM-DD HH:mm */
function formatShortDate(str: string): string {
  try {
    const d = new Date(str)
    if (isNaN(d.getTime())) return str
    const pad = (n: number) => String(n).padStart(2, '0')
    const m = pad(d.getMonth() + 1)
    const day = pad(d.getDate())
    const hh = pad(d.getHours())
    const mm = pad(d.getMinutes())
    return `${m}-${day} ${hh}:${mm}`
  } catch {
    return str
  }
}

export function rangeLabel(range: TimeRange): string {
  if (range.start || range.end) {
    if (range.start && range.end) {
      return `${formatShortDate(range.start)} ~ ${formatShortDate(range.end)}`
    }
    if (range.start) return `自 ${formatShortDate(range.start)} 起`
    if (range.end) return `至 ${formatShortDate(range.end)} 止`
  }

  if (range.preset === 'today') return '今天全天'
  if (range.preset === 'yesterday') return '昨天全天'

  if (range.preset) {
    const hit = TIME_PRESETS.find((p) => p.preset === range.preset)
    if (hit) return hit.label
  }

  if (range.minutes === null) return '不限时间'

  const hit = TIME_PRESETS.find((p) => p.minutes === range.minutes)
  if (hit) return hit.label

  if (range.minutes) {
    const m = range.minutes
    if (m % (60 * 24) === 0) return `最近 ${m / (60 * 24)} 天`
    if (m % 60 === 0) return `最近 ${m / 60} 小时`
    return `最近 ${m} 分钟`
  }

  return '最近 24 小时'
}

/** 把相对窗口换算成后端要的起始毫秒时间戳；null = 不传 (向前兼容) */
export function rangeToStartMs(range: TimeRange, now = Date.now()): number | null {
  const bounds = rangeToTimeBounds(range, now)
  return bounds.startTime != null ? bounds.startTime * 1000 : null
}

/** 计算统一的查询起止时间（秒级 Unix 时间戳） */
export function rangeToTimeBounds(
  range: TimeRange,
  now = Date.now(),
): { startTime?: number; endTime?: number } {
  // 1. 自定义起止时间优先
  if (range.start || range.end) {
    const startTs = range.start ? Math.floor(new Date(range.start).getTime() / 1000) : undefined
    const endTs = range.end ? Math.floor(new Date(range.end).getTime() / 1000) : undefined
    return {
      startTime: Number.isFinite(startTs) ? startTs : undefined,
      endTime: Number.isFinite(endTs) ? endTs : undefined,
    }
  }

  // 2. 自然日快捷
  if (range.preset === 'today') {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return {
      startTime: Math.floor(d.getTime() / 1000),
      endTime: undefined,
    }
  }

  if (range.preset === 'yesterday') {
    const d1 = new Date(now)
    d1.setDate(d1.getDate() - 1)
    d1.setHours(0, 0, 0, 0)
    const d2 = new Date(now)
    d2.setDate(d2.getDate() - 1)
    d2.setHours(23, 59, 59, 999)
    return {
      startTime: Math.floor(d1.getTime() / 1000),
      endTime: Math.floor(d2.getTime() / 1000),
    }
  }

  // 3. 相对分钟数
  if (range.minutes != null && Number.isFinite(range.minutes)) {
    return {
      startTime: Math.floor((now - range.minutes * 60_000) / 1000),
      endTime: undefined,
    }
  }

  // 4. 不限时间
  return { startTime: undefined, endTime: undefined }
}

export function TimeRangePicker({
  value,
  onChange,
  disabled,
}: {
  value: TimeRange
  onChange: (next: TimeRange) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [startDate, setStartDate] = useState(value.start || '')
  const [endDate, setEndDate] = useState(value.end || '')
  const [dateError, setDateError] = useState<string | null>(null)

  // 当外部 value 改变且菜单关闭时同步本地状态
  useEffect(() => {
    if (!open) {
      setStartDate(value.start || '')
      setEndDate(value.end || '')
      setDateError(null)
    }
  }, [value, open])

  const isCustomActive = Boolean(value.start || value.end)

  const handleApplyCustom = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setDateError(null)

    if (!startDate && !endDate) {
      setDateError('请至少选择开始或结束时间')
      return
    }

    if (startDate && endDate) {
      const s = new Date(startDate).getTime()
      const end = new Date(endDate).getTime()
      if (s > end) {
        setDateError('开始时间不能晚于结束时间')
        return
      }
    }

    onChange({
      type: 'custom',
      start: startDate || null,
      end: endDate || null,
      preset: null,
      minutes: null,
    })
    setOpen(false)
  }

  const handleQuickSetToday = () => {
    const now = new Date()
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    setStartDate(toLocalDatetimeString(start))
    setEndDate(toLocalDatetimeString(now))
    setDateError(null)
  }

  const handleQuickSetYesterday = () => {
    const now = new Date()
    const start = new Date(now)
    start.setDate(start.getDate() - 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setDate(end.getDate() - 1)
    end.setHours(23, 59, 0, 0)
    setStartDate(toLocalDatetimeString(start))
    setEndDate(toLocalDatetimeString(end))
    setDateError(null)
  }

  const handleClear = () => {
    setStartDate('')
    setEndDate('')
    setDateError(null)
    onChange({
      type: 'preset',
      minutes: null,
      preset: 'all',
      start: null,
      end: null,
    })
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant={isCustomActive ? 'default' : 'outline'}
          disabled={disabled}
          title={`时间范围：${rangeLabel(value)}`}
          className="h-8 text-xs font-normal gap-1.5"
        >
          <Calendar className="h-3.5 w-3.5" />
          <span className="truncate max-w-[200px]">{rangeLabel(value)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[320px] p-3 space-y-3">
        {/* 标题 */}
        <div className="flex items-center justify-between">
          <DropdownMenuLabel className="p-0 font-medium text-xs flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-primary" />
            <span>选择时间范围</span>
          </DropdownMenuLabel>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={handleClear}
          >
            不限时间
          </Button>
        </div>

        {/* 预设快捷选项网格 */}
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">快捷预设</div>
          <div className="grid grid-cols-3 gap-1.5">
            {TIME_PRESETS.map((p) => {
              const isSelected =
                !isCustomActive &&
                ((p.preset && value.preset === p.preset) ||
                  (p.minutes !== undefined && value.minutes === p.minutes && !value.preset))
              return (
                <Button
                  key={p.label}
                  type="button"
                  size="sm"
                  variant={isSelected ? 'default' : 'outline'}
                  className={cn(
                    'h-7 px-1.5 text-[11px] justify-center',
                    isSelected && 'font-semibold',
                  )}
                  onClick={() => {
                    onChange({
                      type: 'preset',
                      preset: p.preset,
                      minutes: p.minutes !== undefined ? p.minutes : null,
                      start: null,
                      end: null,
                    })
                    setOpen(false)
                  }}
                >
                  {p.label}
                </Button>
              )
            })}
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* 自定义绝对时间范围 */}
        <form onSubmit={handleApplyCustom} className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">自定义起止范围</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={handleQuickSetToday}
              >
                设为今天
              </Button>
              <span className="text-[10px] text-muted-foreground/50">|</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={handleQuickSetYesterday}
              >
                设为昨天
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="space-y-0.5">
              <label className="text-[10px] text-muted-foreground">开始时间</label>
              <Input
                type="datetime-local"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  setDateError(null)
                }}
                className="h-7 text-xs font-mono"
              />
            </div>
            <div className="space-y-0.5">
              <label className="text-[10px] text-muted-foreground">结束时间</label>
              <Input
                type="datetime-local"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  setDateError(null)
                }}
                className="h-7 text-xs font-mono"
              />
            </div>
          </div>

          {dateError && (
            <p className="text-[11px] text-destructive leading-tight">{dateError}</p>
          )}

          <div className="flex items-center justify-end gap-1.5 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => {
                setStartDate('')
                setEndDate('')
                setDateError(null)
              }}
            >
              清空
            </Button>
            <Button type="submit" size="sm" className="h-7 text-xs px-3">
              <Check className="h-3 w-3 mr-1" />
              应用范围
            </Button>
          </div>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

