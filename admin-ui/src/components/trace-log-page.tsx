import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ScrollText,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Search,
  X,
  Copy,
  ArrowDown,
  ArrowUp,
  Database,
  PenTool,
  Info,
  ArrowLeftRight,
  Globe,
  Coins,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  Select as UiSelect,
  SelectTrigger as UiSelectTrigger,
  SelectValue as UiSelectValue,
  SelectContent as UiSelectContent,
  SelectItem as UiSelectItem,
} from '@/components/ui/select'
import { useTraces } from '@/hooks/use-traces'
import { useClientKeys } from '@/hooks/use-client-keys'
import { useGroupOptions } from '@/hooks/use-groups'
import { useUrlState } from '@/hooks/use-url-state'
import {
  ConsoleTable,
  type ConsoleColumn,
} from '@/components/console/data-table'
import { BulkBar } from '@/components/console/bulk-bar'
import { PageHeader } from '@/components/console/page-header'
import { FloatingSectionNav, type NavSectionItem } from '@/components/console/floating-section-nav'
import { DownstreamNewApiConfigDialog } from '@/components/settings/downstream-newapi-config'
import {
  TimeRangePicker,
  rangeToTimeBounds,
  type TimeRange,
} from '@/components/console/time-range'
import type { TraceQuery, TraceRecord } from '@/types/api'

/** 失败分类 → 标签 */
function outcomeStyle(outcome: string): { label: string } {
  switch (outcome) {
    case 'success':
      return { label: '成功' }
    case 'quota_exhausted':
      return { label: '额度耗尽' }
    case 'account_throttled':
      return { label: '账号风控' }
    case 'auth_failed':
      return { label: '鉴权失败' }
    case 'transient':
      return { label: '瞬态错误' }
    case 'network_error':
      return { label: '网络错误' }
    case 'bad_request':
      return { label: '请求错误' }
    case 'stream_interrupted':
      return { label: '流中断' }
    default:
      return { label: outcome || '未知' }
  }
}

function formatTime(ts: string): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  const pad = (n: number) => String(n).padStart(2, '0')
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const h = pad(d.getHours())
  const min = pad(d.getMinutes())
  const s = pad(d.getSeconds())
  return `${m}-${day} ${h}:${min}:${s}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`
  const totalSec = Math.round(ms / 1000)
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`
}

function credLabel(id: number, email?: string | null): string {
  if (id === 0) return '—'
  return email ? email : `#${id}`
}

function keyLabel(keyId: number, keyName?: string | null): string {
  if (keyName) return keyName
  return `#${keyId}`
}

function shortSession(id: string): string {
  if (id.length <= 14) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

/** 状态徽章 */
function StatusBadge({
  status,
  errorType,
  errorMessage,
}: {
  status: string
  errorType?: string | null
  errorMessage?: string | null
}) {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20">
        成功
      </span>
    )
  }

  if (status === 'interrupted') {
    return (
      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20">
        中断
      </span>
    )
  }

  const badge = (
    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20 cursor-help">
      {errorType ? outcomeStyle(errorType).label : '失败'}
    </span>
  )

  if (!errorMessage) return badge

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-md p-3 text-xs bg-gray-900 border border-gray-700 text-white shadow-xl rounded-lg dark:bg-gray-800 z-50"
      >
        <div className="space-y-1.5">
          <div className="font-semibold text-rose-400 flex items-center justify-between border-b border-gray-700 pb-1">
            <span>失败详情</span>
            {errorType && <span className="text-[10px] text-gray-400 font-mono">{errorType}</span>}
          </div>
          <div className="font-mono text-[11px] break-all whitespace-pre-wrap max-h-48 overflow-y-auto text-gray-200">
            {errorMessage}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/** 模型单元格 */
function ModelCell({ rec }: { rec: TraceRecord }) {
  return (
    <div className="space-y-1 text-xs">
      <div className="font-medium text-gray-900 dark:text-white truncate max-w-[190px]" title={rec.model}>
        {rec.model}
      </div>
      <div className="flex items-center gap-1.5">
        {rec.isStream ? (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-500/20 dark:bg-sky-500/10 dark:text-sky-400">
            流式
          </span>
        ) : (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            非流式
          </span>
        )}
      </div>
    </div>
  )
}

/** 账号单元格 */
function CredentialCell({ rec }: { rec: TraceRecord }) {
  const label = credLabel(rec.finalCredentialId, rec.finalEmail)
  const isSwitched =
    rec.previousCredentialId != null &&
    rec.previousCredentialId !== rec.finalCredentialId &&
    rec.finalCredentialId !== 0

  return (
    <div className="space-y-1 text-xs">
      <div className="font-medium text-gray-900 dark:text-white truncate max-w-[180px]" title={label}>
        {label}
      </div>
      {isSwitched && (
        <span
          className="inline-flex items-center rounded px-1.5 py-px text-[10px] font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
          title={`上一轮账号 #${rec.previousCredentialId}`}
        >
          换号
        </span>
      )}
    </div>
  )
}

/** 故障转移单元格 */
function AttemptCell({ rec }: { rec: TraceRecord }) {
  const attempts = rec.attempts ?? []
  if (attempts.length <= 1) {
    return <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">-</span>
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 cursor-help font-mono">
          {attempts.length} 跳
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="rounded-lg border border-gray-700 bg-gray-900 p-2.5 text-xs text-white shadow-xl dark:border-gray-600 dark:bg-gray-800 max-w-sm z-50"
      >
        <div className="space-y-1.5">
          <div className="font-semibold text-gray-300 border-b border-gray-700 pb-1">重试故障转移链路</div>
          {attempts.map((a) => (
            <div key={a.attempt} className="flex items-center justify-between gap-3 text-[11px] font-mono">
              <span className="text-gray-300">
                第 {a.attempt + 1} 跳 · {a.credentialId > 0 ? `#${a.credentialId}` : '—'}
              </span>
              <span className={a.outcome === 'success' ? 'text-emerald-400' : 'text-rose-400'}>
                {outcomeStyle(a.outcome).label} {a.durationMs != null ? `(${formatDuration(a.durationMs)})` : ''}
              </span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/** Token 单元格（ArrowDown + ArrowUp + 缓存图标 + 悬浮详情圆圈） */
function TokensCell({ rec }: { rec: TraceRecord }) {
  const input = rec.inputTokens ?? 0
  const output = rec.outputTokens ?? 0
  const cacheCreation = rec.cacheCreationTokens ?? 0
  const cacheRead = rec.cacheReadTokens ?? 0
  const total = rec.totalTokens ?? input + output + cacheCreation + cacheRead
  const promptTotal = input + cacheCreation + cacheRead

  if (total === 0) {
    return <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">-</span>
  }

  const hitRatio =
    promptTotal > 0 && cacheRead > 0
      ? ((cacheRead / promptTotal) * 100).toFixed(1)
      : null

  return (
    <div className="flex items-center gap-2">
      <div className="space-y-1 text-xs">
        {/* 第一行：输入与输出 */}
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-0.5">
            <ArrowDown className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <span className="font-medium text-gray-900 dark:text-white font-mono">{input.toLocaleString()}</span>
          </div>
          <div className="inline-flex items-center gap-0.5">
            <ArrowUp className="h-3.5 w-3.5 text-violet-500 shrink-0" />
            <span className="font-medium text-gray-900 dark:text-white font-mono">{output.toLocaleString()}</span>
          </div>
        </div>
        {/* 第二行：缓存读写 */}
        {(cacheRead > 0 || cacheCreation > 0) && (
          <div className="flex items-center gap-2 text-[11px]">
            {cacheRead > 0 && (
              <div className="inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400" title="缓存读取">
                <Database className="h-3 w-3 shrink-0 text-sky-500" />
                <span className="font-medium font-mono">{cacheRead.toLocaleString()}</span>
              </div>
            )}
            {cacheCreation > 0 && (
              <div className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400" title="缓存写入">
                <PenTool className="h-3 w-3 shrink-0 text-amber-500" />
                <span className="font-medium font-mono">{cacheCreation.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 详情提示圆圈按钮 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-blue-100 dark:bg-gray-800 dark:hover:bg-blue-900/50"
            aria-label="Token 详情"
          >
            <Info className="h-2.5 w-2.5 text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="whitespace-nowrap rounded-lg border border-gray-700 bg-gray-900 px-3.5 py-2.5 text-xs text-white shadow-xl dark:border-gray-600 dark:bg-gray-800 z-50"
        >
          <div className="space-y-1.5 min-w-[200px]">
            <div className="text-xs font-semibold text-gray-300 mb-1 border-b border-gray-700 pb-1 flex items-center justify-between">
              <span>Token 详情</span>
              {rec.usageSource && (
                <span className="text-[10px] text-gray-400 font-normal">
                  {rec.usageSource === 'provider' ? '上游真值' : rec.usageSource === 'simulated' ? '本地估算' : '无断点'}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-4 font-mono">
              <span className="text-gray-400 font-sans">输入 Token</span>
              <span className="font-medium text-white">{input.toLocaleString()}</span>
            </div>
            {cacheCreation > 0 && (
              <div className="flex items-center justify-between gap-4 font-mono">
                <span className="text-gray-400 font-sans">缓存写入</span>
                <span className="font-medium text-amber-400">{cacheCreation.toLocaleString()}</span>
              </div>
            )}
            {cacheRead > 0 && (
              <div className="flex items-center justify-between gap-4 font-mono">
                <span className="text-gray-400 font-sans">缓存读取</span>
                <span className="font-medium text-sky-400">{cacheRead.toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 font-mono">
              <span className="text-gray-400 font-sans">输出 Token</span>
              <span className="font-medium text-violet-300">{output.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-gray-700 pt-1.5 font-mono">
              <span className="text-gray-400 font-sans">总计 Token</span>
              <span className="font-semibold text-blue-400">{total.toLocaleString()}</span>
            </div>
            {hitRatio && (
              <div className="flex items-center justify-between gap-6 pt-0.5 text-[11px] font-mono">
                <span className="text-gray-400 font-sans">缓存命中率</span>
                <span className="font-semibold text-emerald-400">{hitRatio}%</span>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

/** 费用与盈亏单元格（换行显示，红盈绿亏，hover 查看详细核算） */
function CostCell({
  rec,
  onFilterDownstreamUser,
}: {
  rec: TraceRecord
  onFilterDownstreamUser?: (user: string) => void
}) {
  const credits = rec.credits ?? 0
  const hasCredits = credits > 0
  const profit = rec.downstreamProfit
  const revenue = rec.downstreamRevenue
  const cost = rec.downstreamCost
  const quota = rec.downstreamQuota
  const status = rec.downstreamStatus

  if (!hasCredits && profit == null && status !== 'found') {
    return <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">-</span>
  }

  // 红盈绿亏：盈利为正显示红色，亏损为负显示绿色，零为中性灰色
  const isProfit = profit != null && profit > 0
  const isLoss = profit != null && profit < 0
  const profitColor = isProfit
    ? 'text-rose-600 dark:text-rose-400'
    : isLoss
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-gray-500 dark:text-gray-400'

  const profitSign = isProfit ? '+' : isLoss ? '-' : ''
  const profitText = profit != null ? `${profitSign}$${Math.abs(profit).toFixed(4)}` : null

  const content = (
    <div className="space-y-0.5 text-xs font-mono">
      {/* 第一行：上游计费（credits） */}
      <div className="flex items-center gap-1">
        <span className="font-medium text-gray-900 dark:text-white tabular-nums">
          ${credits.toFixed(4)}
        </span>
      </div>

      {/* 第二行：换行显示盈亏（红盈绿亏）与收入 */}
      {profitText ? (
        <div className={cn('text-[11px] font-semibold tabular-nums cursor-help flex items-center gap-0.5', profitColor)}>
          <span>{isProfit ? '盈' : isLoss ? '亏' : '平'}</span>
          <span>{profitText}</span>
        </div>
      ) : status === 'not_found' ? (
        <div className="text-[10px] text-muted-foreground/50 font-sans">
          未关联下游
        </div>
      ) : null}
    </div>
  )

  if (profit == null && status !== 'found') {
    return content
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent
        side="top"
        className="whitespace-nowrap rounded-lg border border-gray-700 bg-gray-900 px-3.5 py-2.5 text-xs text-white shadow-xl dark:border-gray-600 dark:bg-gray-800 z-50"
      >
        <div className="space-y-1.5 min-w-[220px]">
          <div className="text-xs font-semibold text-gray-300 mb-1 border-b border-gray-700 pb-1 flex items-center justify-between">
            <span>费用与盈亏核算</span>
            <span className="text-[10px] text-emerald-400 font-normal">已缓存本地</span>
          </div>
          <div className="flex items-center justify-between gap-4 font-mono">
            <span className="text-gray-400 font-sans">上游消费</span>
            <span className="font-medium text-white">${credits.toFixed(4)}</span>
          </div>
          {cost != null && (
            <div className="flex items-center justify-between gap-4 font-mono">
              <span className="text-gray-400 font-sans">采购成本</span>
              <span className="font-medium text-amber-300">${cost.toFixed(6)}</span>
            </div>
          )}
          {revenue != null && (
            <div className="flex items-center justify-between gap-4 font-mono">
              <span className="text-gray-400 font-sans">下游收入</span>
              <span className="font-medium text-sky-300">
                ${revenue.toFixed(6)}
                {quota != null ? ` (${quota.toLocaleString()} 额度)` : ''}
              </span>
            </div>
          )}
          {profit != null && (
            <div className="flex items-center justify-between gap-4 border-t border-gray-700 pt-1.5 font-mono">
              <span className="text-gray-400 font-sans">净盈亏</span>
              <span className={cn('font-bold', profitColor)}>
                {profitText} ({isProfit ? '盈利' : isLoss ? '亏损' : '持平'})
              </span>
            </div>
          )}
          {(rec.downstreamUsername || rec.downstreamTokenName) && (
            <div className="flex items-center justify-between gap-4 pt-0.5 text-[11px] text-gray-400">
              <span className="font-sans">下游用户</span>
              <span className="font-mono text-gray-300 truncate max-w-[140px]">
                {rec.downstreamUsername ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onFilterDownstreamUser?.(rec.downstreamUsername!)
                    }}
                    title={`点击过滤下游用户: ${rec.downstreamUsername}`}
                    className="hover:text-sky-300 hover:underline cursor-pointer transition-colors text-left"
                  >
                    {rec.downstreamUsername}
                  </button>
                ) : (
                  '-'
                )}
                {rec.downstreamTokenName ? ` / ${rec.downstreamTokenName}` : ''}
              </span>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/** 耗时健康度单元格（左侧细柱，右侧首字/总耗时） */
function LatencyCell({ rec }: { rec: TraceRecord }) {
  const durationMs = rec.durationMs ?? 0
  const firstTokenMs = rec.firstTokenMs

  const level =
    durationMs < 10000 ? 'fast' : durationMs < 120000 ? 'normal' : durationMs < 300000 ? 'slow' : 'verySlow'
  const barColor =
    level === 'fast' || level === 'normal'
      ? 'bg-emerald-500'
      : level === 'slow'
        ? 'bg-amber-500'
        : 'bg-rose-500'

  const ttftLevel =
    firstTokenMs != null
      ? firstTokenMs < 2000
        ? 'fast'
        : firstTokenMs < 6000
          ? 'normal'
          : firstTokenMs < 15000
            ? 'slow'
            : 'verySlow'
      : null

  const ttftColor =
    ttftLevel == null
      ? 'text-gray-400 dark:text-gray-500'
      : ttftLevel === 'fast' || ttftLevel === 'normal'
        ? 'text-emerald-600 dark:text-emerald-400'
        : ttftLevel === 'slow'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-rose-600 dark:text-rose-400'

  return (
    <div className="flex items-stretch gap-2.5">
      <span className={cn('w-1 shrink-0 rounded-full', barColor)} aria-hidden="true" />
      <div className="grid grid-cols-[max-content_max-content] items-baseline gap-x-2 gap-y-0.5 text-xs">
        <span className="text-gray-400 dark:text-gray-500 text-[11px]">首字</span>
        <span className={cn('font-medium tabular-nums font-mono', ttftColor)}>
          {firstTokenMs != null ? formatDuration(firstTokenMs) : '-'}
        </span>
        <span className="text-gray-400 dark:text-gray-500 text-[11px]">耗时</span>
        <span className="font-medium tabular-nums font-mono text-gray-900 dark:text-white">
          {formatDuration(durationMs)}
        </span>
      </div>
    </div>
  )
}

/** 请求 ID 单元格（截断显示 + 复制小图标） */
function RequestIdCell({ traceId }: { traceId: string }) {
  return (
    <div className="flex max-w-[140px] items-center gap-1.5 text-xs">
      <span className="truncate font-mono text-gray-500 dark:text-gray-400" title={traceId}>
        {traceId}
      </span>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-dark-700 dark:hover:text-gray-300"
        title="复制 Trace ID"
        onClick={(e) => {
          e.stopPropagation()
          navigator.clipboard.writeText(traceId)
          toast.success(`已复制 Trace ID: ${traceId}`)
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/** 下拉筛选器 */
function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  const SENTINEL = '__all__'
  return (
    <UiSelect
      value={value === '' ? SENTINEL : value}
      onValueChange={(v) => onChange(v === SENTINEL ? '' : v)}
    >
      <UiSelectTrigger className="h-8 w-auto min-w-[120px]">
        <UiSelectValue />
      </UiSelectTrigger>
      <UiSelectContent>
        {options.map((o) => (
          <UiSelectItem key={o.value} value={o.value === '' ? SENTINEL : o.value}>
            {o.label}
          </UiSelectItem>
        ))}
      </UiSelectContent>
    </UiSelect>
  )
}

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'success', label: '成功' },
  { value: 'error', label: '失败' },
  { value: 'interrupted', label: '中断' },
]

const ERROR_TYPE_OPTIONS = [
  { value: '', label: '全部错误类型' },
  { value: 'quota_exhausted', label: '额度耗尽' },
  { value: 'account_throttled', label: '账号风控' },
  { value: 'auth_failed', label: '鉴权失败' },
  { value: 'transient', label: '瞬态错误' },
  { value: 'network_error', label: '网络错误' },
  { value: 'bad_request', label: '请求错误' },
  { value: 'stream_interrupted', label: '流中断' },
  { value: 'unknown', label: '未知' },
]

const DEFAULT_PAGE_SIZE = '50'
const DEFAULT_RANGE_MINUTES = '1440'

const URL_DEFAULTS = {
  status: '',
  errorType: '',
  keyId: '',
  group: '',
  downstreamUser: '',
  q: '',
  session: '',
  switched: '',
  ip: '',
  range: DEFAULT_RANGE_MINUTES,
  preset: '',
  start: '',
  end: '',
  page: '0',
  pageSize: DEFAULT_PAGE_SIZE,
}

/** 搜索输入防抖：输入过程中不打请求，停手 300ms 再查 */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return debounced
}

/** `/` 聚焦搜索框 —— 手不离键盘就能开始筛 */
function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      ref.current?.focus()
      ref.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ref])
}

/** 表格列定义 */
function useTraceColumns({
  onFilterSession,
  onFilterIp,
  onFilterDownstreamUser,
}: {
  onFilterSession?: (sessionId: string) => void
  onFilterIp?: (ip: string) => void
  onFilterDownstreamUser?: (user: string) => void
} = {}): ConsoleColumn<TraceRecord>[] {
  return useMemo(
    () => [
      {
        id: 'created_at',
        header: '时间',
        cell: (r) => (
          <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
            {formatTime(r.ts)}
          </span>
        ),
      },
      {
        id: 'status',
        header: '状态',
        cell: (r) => (
          <StatusBadge
            status={r.finalStatus}
            errorType={r.errorType}
            errorMessage={r.errorMessage}
          />
        ),
      },
      {
        id: 'model',
        header: '模型',
        cell: (r) => <ModelCell rec={r} />,
      },
      {
        id: 'credential',
        header: '账号',
        cell: (r) => <CredentialCell rec={r} />,
      },
      {
        id: 'chain',
        header: '故障转移',
        hint: '重试与故障转移链路',
        cell: (r) => <AttemptCell rec={r} />,
      },
      {
        id: 'tokens',
        header: 'Token',
        hint: '输入与输出 Token 用量，悬浮查看明细与缓存构成',
        cell: (r) => <TokensCell rec={r} />,
      },
      {
        id: 'credits',
        header: '费用',
        cell: (r) => <CostCell rec={r} onFilterDownstreamUser={onFilterDownstreamUser} />,
      },
      {
        id: 'latency',
        header: '耗时',
        hint: '首字与端到端总耗时',
        cell: (r) => <LatencyCell rec={r} />,
      },
      {
        id: 'traceId',
        header: '请求 ID',
        optional: true,
        cell: (r) => <RequestIdCell traceId={r.traceId} />,
      },
      {
        id: 'key',
        header: '入口 Key',
        optional: true,
        cell: (r) => (
          <span className="text-xs font-mono text-foreground font-medium">
            {keyLabel(r.keyId, r.keyName)}
          </span>
        ),
      },

      {
        id: 'downstreamUser',
        header: '下游用户',
        optional: true,
        hint: '下游 NewAPI 用户名，点击可快速筛选',
        cell: (r) =>
          r.downstreamUsername ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onFilterDownstreamUser?.(r.downstreamUsername!)
              }}
              title={`点击过滤下游用户: ${r.downstreamUsername}`}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer truncate max-w-[120px]"
            >
              {r.downstreamUsername}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground/50 font-mono">-</span>
          ),
      },

      {
        id: 'clientIp',
        header: 'IP',
        optional: true,
        hint: '客户端 IP，点击可筛选',
        cell: (r) =>
          r.clientIp ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onFilterIp?.(r.clientIp!)
              }}
              title={`点击过滤 IP: ${r.clientIp}`}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {r.clientIp}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground/50 font-mono">-</span>
          ),
      },
      {
        id: 'session',
        header: '会话',
        optional: true,
        hint: '会话 ID，点击可过滤同一会话',
        cell: (r) =>
          r.sessionId ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onFilterSession?.(r.sessionId!)
              }}
              title={`点击过滤会话: ${r.sessionId}`}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {shortSession(r.sessionId)}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground/50 font-mono">-</span>
          ),
      },
    ],
    [onFilterSession, onFilterIp, onFilterDownstreamUser],
  )
}

export function TraceLogPage() {
  const [url, patchUrl, resetUrl] = useUrlState('traces', URL_DEFAULTS)
  const [searchDraft, setSearchDraft] = useState(url.q)
  const debouncedSearch = useDebounced(searchDraft)
  const searchRef = useRef<HTMLInputElement>(null)
  const [selectedTraceIds, setSelectedTraceIds] = useState<Set<number | string>>(new Set())
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useSlashFocus(searchRef)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // 搜索词稳定后才写进 URL / 触发查询
  useEffect(() => {
    if (debouncedSearch !== url.q) patchUrl({ q: debouncedSearch, page: '0' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const page = Number(url.page) || 0
  const pageSize = Number(url.pageSize) || 50
  const range: TimeRange = useMemo(() => {
    if (url.start || url.end) {
      return {
        type: 'custom',
        start: url.start || null,
        end: url.end || null,
      }
    }
    if (url.preset) {
      return {
        type: 'preset',
        preset: url.preset,
        minutes: url.range === '' ? null : Number(url.range) || null,
      }
    }
    return {
      type: 'preset',
      minutes: url.range === '' ? null : Number(url.range),
    }
  }, [url.range, url.preset, url.start, url.end])

  const { data: keysData } = useClientKeys()
  const groupOptions = useGroupOptions()

  const keyOptions = [
    { value: '', label: '全部 Key' },
    ...(keysData?.keys ?? []).map((k) => ({ value: String(k.id), label: k.name })),
  ]
  const groupSelectOptions = [
    { value: '', label: '全部分组' },
    ...groupOptions.map((g) => ({ value: g, label: g })),
  ]

  // 时间窗口按相对分钟数或绝对起止时间换算成秒级起止时间戳
  const timeBounds = useMemo(() => {
    return rangeToTimeBounds(range, now)
  }, [range, now])

  // 按会话看时不限时间：一个会话可能跨越好几个小时，不该被「最近 24h」切掉
  const query: TraceQuery = {
    status: url.status || undefined,
    errorType: url.errorType || undefined,
    keyId: url.keyId ? Number(url.keyId) : undefined,
    group: url.group || undefined,
    downstreamUser: url.downstreamUser || undefined,
    q: url.q || undefined,
    sessionId: url.session || undefined,
    onlySwitched: url.switched === '1' || undefined,
    clientIp: url.ip || undefined,
    startTime: url.session ? undefined : timeBounds.startTime,
    endTime: url.session ? undefined : timeBounds.endTime,
    limit: pageSize,
    offset: page * pageSize,
  }
  const { data, isLoading, isFetching, refetch } = useTraces(query)
  const records = data?.records ?? []
  const total = data?.total ?? 0
  const stats = data?.stats ?? {
    totalCredits: 0,
    totalRevenue: 0,
    totalCost: 0,
    totalProfit: 0,
    totalQuota: 0,
    matchedCount: total,
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const filterSession = (sessionId: string) => patchUrl({ session: sessionId, page: '0' })
  const filterIp = (ip: string) => patchUrl({ ip, page: '0' })
  const filterDownstreamUser = (user: string) => patchUrl({ downstreamUser: user, page: '0' })
  const columns = useTraceColumns({
    onFilterSession: filterSession,
    onFilterIp: filterIp,
    onFilterDownstreamUser: filterDownstreamUser,
  })

  const downstreamUserOptions = useMemo(() => {
    const users = data?.downstreamUsers ?? []
    const set = new Set(users)
    if (url.downstreamUser) set.add(url.downstreamUser)
    return [
      { value: '', label: '全部下游用户' },
      ...Array.from(set).map((u) => ({ value: u, label: u })),
    ]
  }, [data?.downstreamUsers, url.downstreamUser])

  const isTimeFiltered = Boolean(
    url.start ||
    url.end ||
    (url.preset && url.preset !== '24h') ||
    url.range === '' ||
    (url.range && url.range !== DEFAULT_RANGE_MINUTES)
  )

  const filterCount = [
    url.status,
    url.errorType,
    url.keyId,
    url.group,
    url.downstreamUser,
    url.q,
    url.session,
    url.switched,
    url.ip,
    isTimeFiltered ? 'time' : '',
  ].filter(Boolean).length

const TRACE_NAV_ITEMS: NavSectionItem[] = [
  { id: 'traces-header', title: '日志概览' },
  { id: 'traces-stats', title: '指标统计' },
  { id: 'traces-filter', title: '多维筛选' },
  { id: 'traces-table', title: '链路追踪表' },
]

  return (
    <div className="console-scope space-y-4">
      <FloatingSectionNav items={TRACE_NAV_ITEMS} />
      <div id="traces-header">
      <PageHeader
        breadcrumbs={[{ label: '控制台' }, { label: '请求日志', active: true }]}
        icon={<ScrollText className="h-4 w-4" />}
        title="请求日志"
        description="端到端请求链路审计追踪、模型用量与重试故障转移明细分析。"
        badge={
          <Badge variant="secondary" className="font-mono text-xs">
            {total} 条记录
          </Badge>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfigDialogOpen(true)}
              className="gap-1.5"
              title="配置下游 NewAPI 地址与采购成本，开启链路盈亏自动核算与本地缓存"
            >
              <Globe className="h-3.5 w-3.5 text-blue-500" />
              <span>下游 NewAPI 盈亏配置</span>
            </Button>
            {filterCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  resetUrl()
                  setSearchDraft('')
                }}
              >
                清除 {filterCount} 个筛选
              </Button>
            )}
            <span className="text-[11px] text-muted-foreground hidden sm:inline-flex items-center gap-1">
              <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 text-[10px] font-mono">/</kbd>
              快捷聚焦
            </span>
          </>
        }
      />
      </div>

      {/* 统计指标汇总栏 */}
      <div id="traces-stats" className="grid grid-cols-2 gap-3 max-[480px]:grid-cols-1 lg:grid-cols-4">
        {/* 1. 消耗积分 */}
        <Card className="border border-border/70 bg-card transition-all duration-200 hover:border-primary/40 hover:shadow-xs">
          <CardContent className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">消耗积分</span>
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Coins className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-1">
              <span className="font-mono text-xl sm:text-2xl font-bold tracking-tight text-foreground tabular-nums">
                {stats.totalCredits.toFixed(4)}
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">credits</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/80 border-t border-border/40 pt-2 font-mono">
              <span>匹配请求</span>
              <span className="font-semibold text-foreground">{stats.matchedCount.toLocaleString()} 次</span>
            </div>
          </CardContent>
        </Card>

        {/* 2. 下游收费总金额 */}
        <Card className="border border-border/70 bg-card transition-all duration-200 hover:border-sky-500/40 hover:shadow-xs">
          <CardContent className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">下游收费总金额</span>
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-500/10 text-sky-500">
                <DollarSign className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-1">
              <span className="font-mono text-xl sm:text-2xl font-bold tracking-tight text-sky-600 dark:text-sky-400 tabular-nums">
                ${stats.totalRevenue.toFixed(4)}
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">USD</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/80 border-t border-border/40 pt-2 font-mono">
              <span>消耗额度</span>
              <span className="font-semibold text-foreground">{stats.totalQuota.toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>

        {/* 3. 采购总成本 */}
        <Card className="border border-border/70 bg-card transition-all duration-200 hover:border-amber-500/40 hover:shadow-xs">
          <CardContent className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">采购总成本</span>
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
                <Wallet className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-1">
              <span className="font-mono text-xl sm:text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400 tabular-nums">
                ${stats.totalCost.toFixed(4)}
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">USD</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/80 border-t border-border/40 pt-2 font-mono">
              <span>折算单价</span>
              <span className="font-semibold text-foreground">
                ${stats.totalCredits > 0 ? (stats.totalCost / stats.totalCredits).toFixed(6) : '0.000000'} / 分
              </span>
            </div>
          </CardContent>
        </Card>

        {/* 4. 净盈亏（红盈绿亏） */}
        <Card className="border border-border/70 bg-card transition-all duration-200 hover:border-border hover:shadow-xs">
          <CardContent className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">核算净盈亏</span>
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md',
                  stats.totalProfit > 0
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    : stats.totalProfit < 0
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {stats.totalProfit >= 0 ? (
                  <TrendingUp className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
              </div>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-1">
              <span
                className={cn(
                  'font-mono text-xl sm:text-2xl font-bold tracking-tight tabular-nums',
                  stats.totalProfit > 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : stats.totalProfit < 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-foreground',
                )}
              >
                {stats.totalProfit > 0 ? '+' : stats.totalProfit < 0 ? '-' : ''}
                ${Math.abs(stats.totalProfit).toFixed(4)}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  'font-mono text-[10px] py-0 px-1.5 h-4',
                  stats.totalProfit > 0
                    ? 'border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/10'
                    : stats.totalProfit < 0
                      ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                      : 'text-muted-foreground',
                )}
              >
                {stats.totalProfit > 0 ? '盈利' : stats.totalProfit < 0 ? '亏损' : '持平'}
              </Badge>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/80 border-t border-border/40 pt-2 font-mono">
              <span>核算状态</span>
              <span className="font-semibold text-foreground">
                {stats.totalRevenue > 0 || stats.totalCost > 0 ? '已核算' : '无下游数据'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 筛选栏：时间范围在最前，因为排查的第一句话通常是"刚才那几分钟" */}
      <div id="traces-filter" className="flex flex-wrap items-center gap-2">
        <TimeRangePicker
          value={range}
          onChange={(next) => {
            if (next.type === 'custom') {
              patchUrl({
                start: next.start || '',
                end: next.end || '',
                range: '',
                preset: '',
                page: '0',
              })
            } else if (next.preset) {
              patchUrl({
                preset: next.preset,
                range: next.minutes != null ? String(next.minutes) : '',
                start: '',
                end: '',
                page: '0',
              })
            } else {
              patchUrl({
                range: next.minutes == null ? '' : String(next.minutes),
                preset: '',
                start: '',
                end: '',
                page: '0',
              })
            }
          }}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchDraft('')
                e.currentTarget.blur()
              }
            }}
            placeholder="搜索模型 / 报错 / Trace ID / 会话 / IP / 下游用户"
            aria-label="搜索日志"
            className="console-num h-8 w-[min(15rem,52vw)] rounded-md border border-border bg-card pl-8 pr-7 text-xs placeholder:font-sans placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {searchDraft && (
            <button
              type="button"
              onClick={() => setSearchDraft('')}
              title="清除搜索"
              className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <Select
          value={url.status}
          onChange={(v) => patchUrl({ status: v, page: '0' })}
          options={STATUS_OPTIONS}
        />
        <Select
          value={url.errorType}
          onChange={(v) => patchUrl({ errorType: v, page: '0' })}
          options={ERROR_TYPE_OPTIONS}
        />
        <Select
          value={url.keyId}
          onChange={(v) => patchUrl({ keyId: v, page: '0' })}
          options={keyOptions}
        />
        <Select
          value={url.group}
          onChange={(v) => patchUrl({ group: v, page: '0' })}
          options={groupSelectOptions}
        />
        <Select
          value={url.downstreamUser}
          onChange={(v) => patchUrl({ downstreamUser: v, page: '0' })}
          options={downstreamUserOptions}
        />
        <Button
          size="sm"
          variant={url.switched === '1' ? 'default' : 'outline'}
          onClick={() => patchUrl({ switched: url.switched === '1' ? '' : '1', page: '0' })}
          title="只看与上一轮账号不同的请求（会话换号，上游 prompt cache 大概率作废）"
          className="gap-1.5"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          仅换号
        </Button>
        {url.downstreamUser && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 pl-2.5 pr-1.5 text-xs">
            <span className="text-muted-foreground">下游用户</span>
            <span className="console-num font-medium" title={url.downstreamUser}>
              {url.downstreamUser}
            </span>
            <button
              type="button"
              onClick={() => patchUrl({ downstreamUser: '', page: '0' })}
              title="取消下游用户筛选"
              className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        {url.session && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 pl-2.5 pr-1.5 text-xs">
            <span className="text-muted-foreground">会话</span>
            <span className="console-num font-medium" title={url.session}>
              {shortSession(url.session)}
            </span>
            <button
              type="button"
              onClick={() => patchUrl({ session: '', page: '0' })}
              title="取消会话筛选"
              className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        {url.ip && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 pl-2.5 pr-1.5 text-xs">
            <span className="text-muted-foreground">IP</span>
            <span className="console-num font-medium">{url.ip}</span>
            <button
              type="button"
              onClick={() => patchUrl({ ip: '', page: '0' })}
              title="取消 IP 筛选"
              className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
          title="立即刷新（每 30 秒自动刷新）"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div id="traces-table">
        <ConsoleTable
          variant="relaxed"
          rows={records}
          columns={columns}
          rowKey={(r) => r.traceId}
          selectable
          selected={selectedTraceIds}
          onSelectedChange={setSelectedTraceIds}
          columnsStorageKey="kiro.traces.columns"
          loading={isLoading}
          empty={
            filterCount > 0 || url.range !== ''
              ? '当前筛选条件下没有记录。放宽时间范围或清除筛选试试。'
              : '暂无记录。发起几次 /v1/messages 请求后即可看到链路。'
          }
        />
      </div>

      {/* 吸底批量操作栏 */}
      <BulkBar
        count={selectedTraceIds.size}
        onClear={() => setSelectedTraceIds(new Set())}
        noun="条日志"
      >
        <Button
          onClick={() => {
            const list = Array.from(selectedTraceIds).join('\n')
            navigator.clipboard.writeText(list)
            toast.success(`已复制 ${selectedTraceIds.size} 个 Trace ID`)
          }}
          size="sm"
          variant="ghost"
          className="h-8 px-3 text-xs gap-1.5 rounded-full hover:bg-accent"
        >
          <Copy className="h-3.5 w-3.5" />
          复制 Trace ID
        </Button>
      </BulkBar>

      {/* 分页控制栏 */}
      {total > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 pt-2 sm:flex-row">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>每页</span>
            <UiSelect
              value={String(pageSize)}
              onValueChange={(v) => {
                patchUrl({ pageSize: v, page: '0' })
              }}
            >
              <UiSelectTrigger className="h-7 w-[75px] text-xs">
                <UiSelectValue />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem value="10" className="text-xs">10</UiSelectItem>
                <UiSelectItem value="20" className="text-xs">20</UiSelectItem>
                <UiSelectItem value="50" className="text-xs">50</UiSelectItem>
                <UiSelectItem value="100" className="text-xs">100</UiSelectItem>
              </UiSelectContent>
            </UiSelect>
            <span>条 · 共 {total} 条日志</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => patchUrl({ page: String(Math.max(0, page - 1)) })}
              disabled={page <= 0 || isFetching}
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              上一页
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              第 {page + 1} / {totalPages} 页
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                patchUrl({ page: String(Math.min(totalPages - 1, page + 1)) })
              }
              disabled={page >= totalPages - 1 || isFetching}
            >
              下一页
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}

      <DownstreamNewApiConfigDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
        onSaved={() => {
          refetch()
        }}
      />
    </div>
  )
}
