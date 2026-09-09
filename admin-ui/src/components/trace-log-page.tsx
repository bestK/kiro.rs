import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ScrollText,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  Unplug,
  Search,
  X,
  Copy,
  Pin,
  ArrowLeftRight,
  Shuffle,
} from 'lucide-react'
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
import {
  TimeRangePicker,
  rangeToTimeBounds,
  type TimeRange,
} from '@/components/console/time-range'
import {
  outcomeTone,
  railDotClass,
  railTextClass,
  type RailTone,
} from '@/components/console/rail'
import type { TraceQuery, TraceRecord, UsageSource } from '@/types/api'

/** 失败分类 → 中文标签 + Badge 颜色 */
function outcomeStyle(outcome: string): {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning'
} {
  switch (outcome) {
    case 'success':
      return { label: '成功', variant: 'success' }
    case 'quota_exhausted':
      return { label: '额度耗尽', variant: 'warning' }
    case 'account_throttled':
      return { label: '账号风控', variant: 'warning' }
    case 'auth_failed':
      return { label: '鉴权失败', variant: 'destructive' }
    case 'transient':
      return { label: '瞬态错误', variant: 'outline' }
    case 'network_error':
      return { label: '网络错误', variant: 'destructive' }
    case 'bad_request':
      return { label: '请求错误', variant: 'destructive' }
    case 'stream_interrupted':
      return { label: '流中断', variant: 'warning' }
    default:
      return { label: outcome || '未知', variant: 'secondary' }
  }
}

/**
 * 失败分类 → 轨迹节点圆点色。
 *
 * 委托给共享的状态轨映射：日志行的左侧色轨、凭据行的状态、这里的链路节点用同一套
 * 四档语义，异常在三个页面里是同一个颜色。原先本页自带一份 switch，与凭据卡片各判
 * 一次，账号风控在一边是 amber、另一边是 orange。
 */
function outcomeDot(outcome: string): string {
  return railDotClass(outcomeTone(outcome))
}

/** 整条 trace 的严重度 → 左侧色轨 */
function traceTone(rec: TraceRecord): RailTone {
  if (rec.finalStatus === 'success') {
    // 成功但重试过：请求被救回来了，可池子里有凭据在失败 —— 值得看一眼，但不是故障
    return rec.totalAttempts > 1 ? 'warn' : 'none'
  }
  if (rec.finalStatus === 'interrupted') return 'warn'
  return outcomeTone(rec.errorType ?? '')
}

/** 最终状态 → 徽章，异常时支持 hover 预览具体报错 */
function StatusBadge({
  status,
  errorType,
  errorMessage,
}: {
  status: string
  errorType?: string | null
  errorMessage?: string | null
}) {
  let badge = null
  if (status === 'success') {
    badge = (
      <Badge variant="success" className="font-semibold h-5 px-1.5 text-[11px] gap-1 shadow-2xs">
        <CheckCircle2 className="h-3 w-3" />
        成功
      </Badge>
    )
  } else if (status === 'interrupted') {
    badge = (
      <Badge variant="warning" className="font-semibold h-5 px-1.5 text-[11px] gap-1 shadow-2xs">
        <Unplug className="h-3 w-3" />
        中断
      </Badge>
    )
  } else {
    const s = errorType ? outcomeStyle(errorType) : null
    badge = (
      <Badge variant="destructive" className="font-semibold h-5 px-1.5 text-[11px] gap-1 shadow-2xs">
        <AlertTriangle className="h-3 w-3" />
        {s ? s.label : '失败'}
      </Badge>
    )
  }

  if (!errorMessage) {
    return <div className="inline-flex min-w-[62px]">{badge}</div>
  }

  return (
    <div className="inline-flex min-w-[62px]">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex cursor-help">{badge}</div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-md z-50 p-2.5 text-xs bg-popover border-destructive/40 text-popover-foreground shadow-xl"
        >
          <div className="space-y-1.5">
            <div className="font-semibold text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>失败原因 {errorType ? `(${outcomeStyle(errorType).label})` : ''}</span>
            </div>
            <div className="font-mono text-[11px] break-all whitespace-pre-wrap max-h-48 overflow-y-auto bg-destructive/10 p-2 rounded text-foreground">
              {errorMessage}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  )
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

/** 耗时的两种量级：首字（流式第一个 token）与总耗时（端到端），阈值各一套 */
type LatencyKind = 'ttft' | 'total'

type LatencyLevel = 'fast' | 'normal' | 'slow' | 'verySlow'

/**
 * 分档阈值（毫秒），取自本项目实测分布，不是拍脑袋的整数。
 *
 * 首字 TTFT —— 中位数 2~3s，正常区间 1.8~5s，偶发 20s+ 属异常：
 *   - `<2s`    压在中位数以下：选号一次命中、上游没排队
 *   - `2~6s`   正常。上界从实测的 5s 放宽 1s，给日常抖动留余量，免得正常请求闪黄
 *   - `6~15s`  超出正常上界一倍以上，通常是并发排队或多走了一跳重试
 *   - `>15s`   实测 20s+ 才确定异常，门槛提前到 15s 半档预警
 *
 * 总耗时 —— 短请求几秒，正常几十秒，长会话 1~2 分钟仍属正常，5 分钟以上才可疑：
 *   - `<10s`     短请求：工具调用、单轮短回复
 *   - `10s~2min` 正常。上界取 120s 而非直觉的 60s —— 长会话本就要跑 1~2 分钟，
 *                按 60s 切会让日常长会话整片标黄，黄色也就失去了意义
 *   - `2~5min`   偏长：超出常规长会话，但按实测口径还够不上可疑
 *   - `>5min`    可疑：卡在上游、超长生成，或多次重试串联起来的累计耗时
 */
const LATENCY_THRESHOLDS: Record<LatencyKind, { fast: number; normal: number; slow: number }> = {
  ttft: { fast: 2_000, normal: 6_000, slow: 15_000 },
  total: { fast: 10_000, normal: 120_000, slow: 300_000 },
}

const LATENCY_META: Record<
  LatencyKind,
  { name: string; normalRange: string; reason: Record<LatencyLevel, string> }
> = {
  ttft: {
    name: '首字',
    normalRange: '正常 2-6s',
    reason: {
      fast: '上游响应很快',
      normal: '',
      slow: '可能是并发排队或上游抖动',
      verySlow: '并发排队严重或上游抖动，值得查一下这条链路',
    },
  },
  total: {
    name: '总耗时',
    normalRange: '正常 10s-2min',
    reason: {
      fast: '短请求',
      normal: '',
      slow: '超出常规长会话的时长',
      verySlow: '疑似上游卡顿、超长生成，或多次重试累计',
    },
  },
}

const LATENCY_LEVEL_LABEL: Record<LatencyLevel, string> = {
  fast: '快',
  normal: '正常',
  slow: '偏慢',
  verySlow: '很慢',
}

function latencyLevel(ms: number, kind: LatencyKind): LatencyLevel {
  const t = LATENCY_THRESHOLDS[kind]
  if (ms < t.fast) return 'fast'
  if (ms < t.normal) return 'normal'
  if (ms < t.slow) return 'slow'
  return 'verySlow'
}

/**
 * 耗时数值的文字色与悬浮说明，列表单元格与展开详情共用同一套判定。
 *
 * 颜色直接借状态色轨的语义色（`ok` 绿 / `warn` 琥珀 / `dead` 红），异常在本页
 * 的三处（色轨、链路节点、耗时）说的是同一种颜色语言。快与正常两档都用绿色：
 * 绿色在这里表达「这条耗时没问题」，只有偏慢和很慢才需要被区分出来。
 *
 * `ms` 为 null 表示非流式请求没有首 token 时间，只占位不参与着色。
 */
function latencyStyle(
  ms: number | null | undefined,
  kind: LatencyKind,
): { className: string; title: string } {
  const meta = LATENCY_META[kind]
  if (ms == null) {
    return {
      className: 'text-muted-foreground',
      title: `${meta.name}：非流式请求，无首个 token 时间`,
    }
  }
  const level = latencyLevel(ms, kind)
  const className =
    level === 'fast' || level === 'normal'
      ? railTextClass('ok')
      : level === 'slow'
        ? railTextClass('warn')
        : railTextClass('dead')
  const reason = meta.reason[level]
  const title = `${meta.name} ${formatDuration(ms)}：${LATENCY_LEVEL_LABEL[level]}（${meta.normalRange}）${reason ? `，${reason}` : ''}`
  return { className, title }
}

/** 千位分隔的完整数值 */
function formatTokenFull(n: number): string {
  return n.toLocaleString('en-US')
}

function credLabel(id: number, email?: string | null): string {
  if (id === 0) return '—'
  return email ? email : `#${id}`
}

function keyLabel(keyId: number, keyName?: string | null): string {
  if (keyName) return keyName
  return `#${keyId}`
}

/** 会话 id 缩写：UUID 只留头尾，够辨认又不占地 */
function shortSession(id: string): string {
  if (id.length <= 14) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

/**
 * 会话路由判定：这条请求相对该会话的上一轮，账号是沿用了还是换了。
 *
 * - switched：有上一轮绑定且本轮落到了不同账号 —— 上游 prompt cache 大概率作废，值得关注
 * - hit：粘性命中，沿用上一轮账号
 * - first：该会话此前无绑定（首轮 / 绑定过期），无从比较
 * - off：粘性路由关闭
 * - unknown：老记录，没有路由信息
 */
type RouteKind = 'switched' | 'hit' | 'first' | 'off' | 'unknown'

function routeKind(rec: TraceRecord): RouteKind {
  if (!rec.stickyOutcome) return 'unknown'
  if (rec.stickyOutcome === 'off') return 'off'
  const prev = rec.previousCredentialId
  if (prev != null && prev !== rec.finalCredentialId && rec.finalCredentialId !== 0) {
    return 'switched'
  }
  if (rec.stickyOutcome === 'hit') return 'hit'
  return 'first'
}

/** 换号原因（仅 switched 时有意义） */
function switchReason(rec: TraceRecord): string {
  switch (rec.stickyOutcome) {
    case 'miss_unavailable':
      return '上一轮账号当前不可用（禁用 / 冷却 / RPM 打满 / 不支持该模型 / 不在分组）'
    case 'hit':
      return '粘性命中后上游失败，重试时故障转移到了其他账号'
    default:
      return '未知原因'
  }
}

/**
 * 会话粘性标记：紧跟在「最终凭据」后面的小图标。
 * 只在需要注意的时候出声：换号用橙色，命中用绿色小图钉，其余情况不显示或灰显。
 */
function StickyMarker({ rec, verbose = false }: { rec: TraceRecord; verbose?: boolean }) {
  const kind = routeKind(rec)
  if (kind === 'unknown') return null

  if (kind === 'switched') {
    const prev = rec.previousCredentialId
    const title = `账号切换：上一轮 #${prev} → 本轮 #${rec.finalCredentialId}\n${switchReason(rec)}\n上游 prompt cache 按账号隔离，本轮大概率冷启动`
    return (
      <span
        title={title}
        className="inline-flex shrink-0 items-center gap-0.5 rounded border border-orange-500/40 bg-orange-500/10 px-1 py-px text-[10px] font-medium text-orange-600 dark:text-orange-400"
      >
        <ArrowLeftRight className="h-3 w-3" />
        {verbose ? `换号 #${prev} → #${rec.finalCredentialId}` : '换号'}
      </span>
    )
  }
  if (kind === 'hit') {
    return (
      <span
        title="会话粘性命中：沿用上一轮账号，上游 prompt cache 可复用"
        className="inline-flex shrink-0 items-center gap-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
      >
        <Pin className="h-3 w-3" />
        {verbose ? '粘性命中' : null}
      </span>
    )
  }
  if (kind === 'off') {
    return verbose ? (
      <span
        title="会话粘性路由已关闭"
        className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border/60 px-1 py-px text-[10px] text-muted-foreground"
      >
        <Shuffle className="h-3 w-3" />
        粘性关闭
      </span>
    ) : null
  }
  // first：首轮或绑定过期，只在详情里说明
  return verbose ? (
    <span
      title="该会话此前无账号绑定（首轮或绑定已过期），本轮按负载均衡选号"
      className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border/60 px-1 py-px text-[10px] text-muted-foreground"
    >
      首轮
    </span>
  ) : null
}

/** usage 三项来源标签：区分「上游真值」和「我们自己算的」 */
function UsageSourceBadge({ source }: { source?: UsageSource | null }) {
  if (!source) return null
  const map: Record<UsageSource, { label: string; title: string; cls: string }> = {
    provider: {
      label: '上游真值',
      title: 'token / cache 三项来自 Kiro metadataEvent.tokenUsage，精确',
      cls: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
    },
    simulated: {
      label: '本地估算',
      title: '上游未下发精确用量；按客户端 cache_control 断点在本地模拟缓存命中，反映的是「前缀是否稳定」而非上游真实缓存',
      cls: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    },
    none: {
      label: '无断点',
      title: '请求未声明 cache_control 断点或计量已关闭，全量计入输入',
      cls: 'border-border/60 text-muted-foreground',
    },
  }
  const m = map[source]
  return (
    <Badge variant="outline" className={`h-5 px-1.5 text-[10px] font-medium ${m.cls}`} title={m.title}>
      {m.label}
    </Badge>
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

/**
 * 故障转移轨迹（本页签名元素）：把一次请求的 attempts[] 画成横向重试链路，
 * 按每跳结果着色。单次成功只显示一个安静的圆点；重试/故障转移时展开为带凭据号
 * 的节点串，hover 可查看每跳明细。
 */
function AttemptChain({ rec }: { rec: TraceRecord }) {
  const attempts = rec.attempts ?? []
  if (attempts.length === 0) {
    return <span className="text-muted-foreground/50 font-mono text-xs">—</span>
  }
  if (attempts.length === 1 && rec.finalStatus === 'success') {
    return (
      <span
        title="1 次尝试即成功"
        className={`inline-block h-2.5 w-2.5 rounded-full ${outcomeDot(attempts[0].outcome)} shadow-2xs`}
      />
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      {attempts.map((a, i) => {
        const style = outcomeStyle(a.outcome)
        return (
          <span key={a.attempt} className="inline-flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground/60 font-semibold text-[10px]">→</span>}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-help items-center gap-1 rounded border border-border/70 bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums hover:bg-secondary transition-colors">
                  <span className={`h-1.5 w-1.5 rounded-full ${outcomeDot(a.outcome)}`} />
                  {a.credentialId > 0 ? `#${a.credentialId}` : '—'}
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="z-50 p-2.5 text-xs bg-popover border-border text-popover-foreground shadow-xl max-w-sm"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-foreground">
                    <span>第 {a.attempt + 1} 跳 · {style.label}</span>
                    {a.httpStatus != null && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">
                        HTTP {a.httpStatus}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    凭据: <span className="text-foreground font-medium">{credLabel(a.credentialId, a.email)}</span>
                    {a.endpoint && <span> · {a.endpoint}</span>}
                    {a.durationMs != null && <span> · {formatDuration(a.durationMs)}</span>}
                  </div>
                  {a.errorSnippet && (
                    <div className="mt-1 font-mono text-[10.5px] p-1.5 rounded bg-destructive/10 text-destructive break-all max-h-32 overflow-y-auto">
                      {a.errorSnippet}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </span>
        )
      })}
    </span>
  )
}

/**
 * Token 与缓存构成 Hover 浮层：
 * 鼠标悬浮时展示完整的缓存命中/读取/写入/常规输入/输出与费用明细，高对比度视觉化占比。
 */
function TokenCacheHoverContent({ rec }: { rec: TraceRecord }) {
  const freshInput = rec.inputTokens ?? 0
  const cacheCreation = rec.cacheCreationTokens ?? 0
  const cacheRead = rec.cacheReadTokens ?? 0
  const promptTotal = freshInput + cacheCreation + cacheRead
  const output = rec.outputTokens ?? 0
  const total = rec.totalTokens ?? promptTotal + output
  const credit = rec.credits ?? 0

  const hitRatio =
    promptTotal > 0 && cacheRead > 0
      ? (() => {
          const pct = (cacheRead / promptTotal) * 100
          if (pct >= 100) return '100'
          if (pct >= 99.95) return '99.9'
          return pct.toFixed(1)
        })()
      : null

  const readPct = promptTotal > 0 ? (cacheRead / promptTotal) * 100 : 0
  const creationPct = promptTotal > 0 ? (cacheCreation / promptTotal) * 100 : 0
  const freshPct = promptTotal > 0 ? (freshInput / promptTotal) * 100 : 0

  return (
    <div className="w-[320px] space-y-2.5 p-1 text-xs">
      {/* 头部：标题与命中率 */}
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground text-[13px]">
          <span>Token 与缓存构成</span>
          <UsageSourceBadge source={rec.usageSource} />
        </div>
        {hitRatio != null ? (
          <Badge variant="success" className="h-5 px-1.5 text-[11px] font-mono font-semibold gap-1">
            <span>命中 {hitRatio}%</span>
          </Badge>
        ) : (
          <Badge variant="outline" className="h-5 px-1.5 text-[10.5px] text-muted-foreground">
            未命中缓存
          </Badge>
        )}
      </div>

      {/* 视觉化占比条 */}
      {promptTotal > 0 && (
        <div className="space-y-1">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary/80">
            {readPct > 0 && (
              <div
                style={{ width: `${readPct}%` }}
                className="bg-emerald-500 transition-all"
              />
            )}
            {creationPct > 0 && (
              <div
                style={{ width: `${creationPct}%` }}
                className="bg-amber-500 transition-all"
              />
            )}
            {freshPct > 0 && (
              <div
                style={{ width: `${freshPct}%` }}
                className="bg-sky-500 transition-all"
              />
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono pt-0.5">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
              命中 {readPct.toFixed(1)}%
            </span>
            <span className="text-amber-600 dark:text-amber-400 font-semibold">
              写入 {creationPct.toFixed(1)}%
            </span>
            <span className="text-sky-600 dark:text-sky-400 font-semibold">
              常规 {freshPct.toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {/* 4 格分项明细卡片（高对比度） */}
      <div className="grid grid-cols-2 gap-1.5 pt-0.5 text-[12px] font-mono">
        <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 p-2">
          <div className="text-[10.5px] text-emerald-700 dark:text-emerald-300 font-sans font-medium">
            缓存读取 (命中省钱)
          </div>
          <div className="font-bold text-emerald-600 dark:text-emerald-400 text-[13.5px] tabular-nums mt-0.5">
            {formatTokenFull(cacheRead)}
          </div>
          <div className="text-[9.5px] text-muted-foreground mt-0.5 font-sans">
            {hitRatio != null ? `占比 ${hitRatio}% (省钱)` : '无命中'}
          </div>
        </div>

        <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-2">
          <div className="text-[10.5px] text-amber-700 dark:text-amber-300 font-sans font-medium">
            缓存写入 (创建断点)
          </div>
          <div className="font-bold text-amber-600 dark:text-amber-400 text-[13.5px] tabular-nums mt-0.5">
            {formatTokenFull(cacheCreation)}
          </div>
          <div className="text-[9.5px] text-muted-foreground mt-0.5 font-sans">
            初次断点写入
          </div>
        </div>

        <div className="rounded-md border border-border/70 bg-secondary/50 p-2">
          <div className="text-[10.5px] text-muted-foreground font-sans font-medium">
            常规未缓存输入
          </div>
          <div className="font-bold text-foreground text-[13.5px] tabular-nums mt-0.5">
            {formatTokenFull(freshInput)}
          </div>
          <div className="text-[9.5px] text-muted-foreground mt-0.5 font-sans">
            全价计费部分
          </div>
        </div>

        <div className="rounded-md border border-violet-500/25 bg-violet-500/10 p-2">
          <div className="text-[10.5px] text-violet-700 dark:text-violet-300 font-sans font-medium">
            模型输出 Token
          </div>
          <div className="font-bold text-violet-600 dark:text-violet-400 text-[13.5px] tabular-nums mt-0.5">
            {formatTokenFull(output)}
          </div>
          <div className="text-[9.5px] text-muted-foreground mt-0.5 font-sans">
            模型生成内容
          </div>
        </div>
      </div>

      {/* 底部汇总 */}
      <div className="flex items-center justify-between border-t border-border/60 pt-2 text-[11.5px] text-muted-foreground">
        <span>
          总计: <span className="font-mono font-bold text-foreground">{formatTokenFull(total)}</span> Token
        </span>
        {credit > 0 && (
          <span>
            上游计费: <span className="font-mono font-bold text-sky-600 dark:text-sky-400">{credit.toFixed(4)}</span> 积分
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Token 用量单元格：
 * 采用最小宽度排列整齐，鼠标 hover 浮层展示完整缓存与 Token 构成。
 */
function TokenCell({ rec }: { rec: TraceRecord }) {
  const input = rec.inputTokens ?? 0
  const output = rec.outputTokens ?? 0
  const cacheCreation = rec.cacheCreationTokens ?? 0
  const cacheRead = rec.cacheReadTokens ?? 0
  const total = rec.totalTokens ?? input + output + cacheCreation + cacheRead

  if (total === 0) {
    return <span className="text-muted-foreground/50 font-mono text-xs">—</span>
  }

  const promptTotal = input + cacheCreation + cacheRead
  const hitRatio =
    promptTotal > 0 && cacheRead > 0
      ? (() => {
          const pct = (cacheRead / promptTotal) * 100
          if (pct >= 100) return '100'
          if (pct >= 99.95) return '99.9'
          return pct.toFixed(1)
        })()
      : null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex flex-col justify-center font-mono text-[11.5px] tabular-nums min-w-[136px] leading-tight py-0.5 cursor-pointer rounded px-1.5 -mx-1.5 hover:bg-secondary/60 transition-colors">
          {/* 第一行：输入 / 输出 */}
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[10px] text-muted-foreground/80 font-sans select-none min-w-[28px]">Token</span>
            <span className="font-semibold text-foreground min-w-[96px] text-right">
              {formatTokenFull(input)}
              <span className="text-muted-foreground/50 mx-0.5">/</span>
              <span className="text-violet-600 dark:text-violet-400">{formatTokenFull(output)}</span>
            </span>
          </div>
          {/* 第二行：缓存状态 */}
          <div className="flex items-center justify-between gap-1.5 mt-0.5">
            <span className="text-[10px] text-muted-foreground/80 font-sans select-none min-w-[28px]">缓存</span>
            <span className="min-w-[96px] text-right">
              {cacheRead > 0 ? (
                <span className="inline-flex items-center justify-end gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>命中 {hitRatio}%</span>
                  <span className="text-[10px] text-muted-foreground/80 font-normal">({formatTokenFull(cacheRead)})</span>
                </span>
              ) : cacheCreation > 0 ? (
                <span className="inline-flex items-center justify-end gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span>写入</span>
                  <span className="text-[10px] text-muted-foreground/80 font-normal">({formatTokenFull(cacheCreation)})</span>
                </span>
              ) : (
                <span className="text-[10.5px] text-muted-foreground/60 font-sans">
                  未命中
                </span>
              )}
            </span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        className="z-50 p-2.5 shadow-2xl border-border bg-popover text-popover-foreground rounded-xl"
      >
        <TokenCacheHoverContent rec={rec} />
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * 耗时单元格：首字与总耗时采用严格最小宽度对齐，高对比度色彩。
 */
function DurationCell({ rec }: { rec: TraceRecord }) {
  const ttft = latencyStyle(rec.firstTokenMs, 'ttft')
  const total = latencyStyle(rec.durationMs, 'total')
  return (
    <div className="inline-flex flex-col justify-center font-mono text-[11.5px] tabular-nums min-w-[96px] leading-tight py-0.5">
      <div className="flex items-center justify-between gap-2" title={ttft.title}>
        <span className="text-[10px] text-muted-foreground/80 font-sans select-none min-w-[24px]">首字</span>
        <span className={cn('min-w-[56px] text-right font-medium', ttft.className)}>
          {rec.firstTokenMs != null ? formatDuration(rec.firstTokenMs) : '—'}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-0.5" title={total.title}>
        <span className="text-[10px] text-muted-foreground/80 font-sans select-none min-w-[24px]">耗时</span>
        <span className={cn('min-w-[56px] text-right font-semibold', total.className)}>
          {formatDuration(rec.durationMs)}
        </span>
      </div>
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
  // radix Select 不允许空字符串 value，用哨兵 "__all__" 代表「空/全部」，对外透明。
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

const DEFAULT_PAGE_SIZE = '50'
const DEFAULT_RANGE_MINUTES = '1440'

const URL_DEFAULTS = {
  status: '',
  errorType: '',
  keyId: '',
  group: '',
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

/** 表格列定义。默认 8 列，其余进列控制菜单 —— 12 列全摆开必然横向滚动。 */
function useTraceColumns({
  onFilterSession,
  onFilterIp,
}: {
  onFilterSession?: (sessionId: string) => void
  onFilterIp?: (ip: string) => void
} = {}): ConsoleColumn<TraceRecord>[] {
  return useMemo(
    () => [
      {
        id: 'ts',
        header: '时间',
        cell: (r) => (
          <span className="console-num text-muted-foreground whitespace-nowrap min-w-[68px]">
            {formatTime(r.ts)}
          </span>
        ),
      },
      {
        id: 'model',
        header: '模型',
        cell: (r) => (
          <div className="inline-flex min-w-[130px] max-w-[200px] items-center gap-1.5 font-medium text-foreground">
            <span className="truncate" title={r.model}>
              {r.model}
            </span>
            {r.isStream ? (
              <span
                className="shrink-0 rounded bg-sky-500/10 px-1 py-0.5 text-[10px] font-mono text-sky-600 dark:text-sky-400 border border-sky-500/20"
                title="流式响应 (SSE)"
              >
                流
              </span>
            ) : (
              <span
                className="shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] font-mono text-muted-foreground border border-border/40"
                title="非流式响应"
              >
                非流
              </span>
            )}
          </div>
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
        id: 'credential',
        header: '最终凭据',
        hint: '绿色图钉 = 沿用上一轮账号（粘性命中）；橙色 = 与上一轮不同账号（换号，上游缓存大概率作废）',
        cell: (r) => (
          <span className="inline-flex min-w-[140px] max-w-[210px] items-center gap-1.5 font-medium text-foreground">
            <span className="truncate" title={credLabel(r.finalCredentialId, r.finalEmail)}>
              {credLabel(r.finalCredentialId, r.finalEmail)}
            </span>
            <StickyMarker rec={r} />
          </span>
        ),
      },
      {
        id: 'chain',
        header: '故障转移',
        hint: '这次请求走过的重试链路，顺序即尝试次序',
        cell: (r) => (
          <div className="inline-flex min-w-[64px] items-center">
            <AttemptChain rec={r} />
          </div>
        ),
      },
      {
        id: 'tokens',
        header: 'Token',
        hint: '输入 / 输出，鼠标 hover 查看缓存命中率与分项明细',
        cell: (r) => <TokenCell rec={r} />,
      },
      {
        id: 'credits',
        header: '费用',
        align: 'right',
        hint: 'credit —— 上游 metering 的真实计费',
        cell: (r) => (
          <span className="console-num min-w-[56px] text-right inline-block text-foreground font-medium">
            {r.credits != null && r.credits > 0 ? r.credits.toFixed(4) : '—'}
          </span>
        ),
      },
      {
        id: 'duration',
        header: '耗时',
        hint: '首字 = 首个 token 到达耗时（仅流式有值，非流式为 —）；耗时 = 端到端总耗时。悬浮查看分级判定',
        cell: (r) => <DurationCell rec={r} />,
      },
      {
        id: 'key',
        header: '入口 Key',
        optional: true,
        cell: (r) => (
          <Badge variant="outline" className="font-mono text-xs">
            {keyLabel(r.keyId, r.keyName)}
          </Badge>
        ),
      },
      {
        id: 'errorType',
        header: '错误类型',
        optional: true,
        cell: (r) => {
          if (!r.errorType) return <span className="text-muted-foreground font-mono">—</span>
          const s = outcomeStyle(r.errorType)
          return <Badge variant={s.variant}>{s.label}</Badge>
        },
      },
      {
        id: 'clientIp',
        header: 'IP',
        optional: true,
        hint: '客户端 IP；点击按此 IP 快速过滤',
        cell: (r) =>
          r.clientIp ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onFilterIp?.(r.clientIp!)
              }}
              title={`点击过滤 IP: ${r.clientIp}`}
              className="console-num text-[11.5px] text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            >
              {r.clientIp}
            </button>
          ) : (
            <span className="text-muted-foreground/50 font-mono">—</span>
          ),
      },
      {
        id: 'session',
        header: '会话',
        optional: true,
        hint: '发给上游的 conversationId；点击按此会话过滤完整链路',
        cell: (r) =>
          r.sessionId ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onFilterSession?.(r.sessionId!)
              }}
              title={`点击过滤会话: ${r.sessionId}`}
              className="console-num text-[11.5px] text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            >
              {shortSession(r.sessionId)}
            </button>
          ) : (
            <span className="text-muted-foreground/50 font-mono">—</span>
          ),
      },
      {
        id: 'usageSource',
        header: '用量来源',
        optional: true,
        hint: '上游真值 / 本地估算 / 无断点',
        cell: (r) => <UsageSourceBadge source={r.usageSource} />,
      },
      {
        id: 'traceId',
        header: 'Trace ID',
        optional: true,
        hint: '点击复制完整 Trace ID',
        cell: (r) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              navigator.clipboard.writeText(r.traceId)
              toast.success(`已复制 Trace ID: ${r.traceId}`)
            }}
            title={`点击复制: ${r.traceId}`}
            className="console-num text-[11.5px] text-muted-foreground hover:text-primary transition-colors cursor-pointer"
          >
            {r.traceId.slice(0, 12)}…
          </button>
        ),
      },
    ],
    [onFilterSession, onFilterIp],
  )
}

export function TraceLogPage() {
  const [url, patchUrl, resetUrl] = useUrlState('traces', URL_DEFAULTS)
  const [searchDraft, setSearchDraft] = useState(url.q)
  const debouncedSearch = useDebounced(searchDraft)
  const searchRef = useRef<HTMLInputElement>(null)
  const [selectedTraceIds, setSelectedTraceIds] = useState<Set<number | string>>(new Set())
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
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const filterSession = (sessionId: string) => patchUrl({ session: sessionId, page: '0' })
  const filterIp = (ip: string) => patchUrl({ ip, page: '0' })
  const columns = useTraceColumns({ onFilterSession: filterSession, onFilterIp: filterIp })

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
    url.q,
    url.session,
    url.switched,
    url.ip,
    isTimeFiltered ? 'time' : '',
  ].filter(Boolean).length

const TRACE_NAV_ITEMS: NavSectionItem[] = [
  { id: 'traces-header', title: '日志概览' },
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
            placeholder="搜索模型 / 报错 / Trace ID / 会话 / IP"
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
          rows={records}
          columns={columns}
          rowKey={(r) => r.traceId}
          tone={traceTone}
          selectable
          selected={selectedTraceIds}
          onSelectedChange={setSelectedTraceIds}
          rowActions={(rec) => (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="复制 Trace ID"
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(rec.traceId)
                toast.success(`已复制 Trace ID: ${rec.traceId}`)
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          )}
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
    </div>
  )
}
