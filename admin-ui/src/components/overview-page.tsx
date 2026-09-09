import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Activity,
  Calendar,
  Coins,
  Cpu,
  KeyRound,
  Server,
  Zap,
  Flame,
  PieChart as PieChartIcon,
  X,
  SlidersHorizontal,
} from 'lucide-react'
import { useByCredential, useByKey, useByModel, useOverview, useTimeSeries } from '@/hooks/use-stats'
import { AutoRefreshControl } from '@/components/console/auto-refresh-control'
import { FloatingSectionNav, type NavSectionItem } from '@/components/console/floating-section-nav'
import { PageHeader } from '@/components/console/page-header'
import { useClientKeys } from '@/hooks/use-client-keys'
import { useGroupOptions } from '@/hooks/use-groups'
import { useCredentials } from '@/hooks/use-credentials'
import type {
  ClientKeyItem,
  CredentialDistribution,
  KeyDistribution,
  ModelDistribution,
  StatsFilter,
  StatsGranularity,
  StatsRange,
  StatsTimeFilter,
  TimeSeriesPoint,
} from '@/types/api'
import { TimeSeriesChart, type ChartMetricMode } from '@/components/charts/time-series-chart'
import { ModelPieChart } from '@/components/charts/model-pie-chart'
import { CredentialBarChart } from '@/components/charts/credential-bar-chart'
import { KeyBarChart } from '@/components/charts/key-bar-chart'
import { cn, formatCredits, formatNumber } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const RANGES: { label: string; value: StatsRange }[] = [
  { label: '24 小时', value: '24h' },
  { label: '7 天', value: '7d' },
  { label: '30 天', value: '30d' },
]

const GRANULARITIES: { label: string; value: StatsGranularity }[] = [
  { label: '按小时', value: 'hour' },
  { label: '按天', value: 'day' },
]

function toDateInputValue(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function customTimeFilter(
  startDate: string,
  endDate: string,
  granularity: StatsGranularity,
): StatsTimeFilter {
  return { startDate, endDate, granularity }
}

function presetStartDate(range: StatsRange, endDate: string): string {
  const days = range === '24h' ? 1 : range === '7d' ? 6 : 29
  const d = new Date(`${endDate}T00:00:00`)
  d.setDate(d.getDate() - days)
  return toDateInputValue(d)
}

function formatDateText(value: string): string {
  return value.replace(/-/g, '/')
}

function timeLabel(filter: StatsTimeFilter): string {
  const suffix = filter.granularity === 'day' ? '按天' : '按小时'
  if (filter.range) {
    const range = RANGES.find((r) => r.value === filter.range)?.label ?? filter.range
    return `近 ${range} · ${suffix}`
  }
  return `${formatDateText(filter.startDate ?? '')} - ${formatDateText(filter.endDate ?? '')} · ${suffix}`
}

const OVERVIEW_NAV_ITEMS: NavSectionItem[] = [
  { id: 'overview-summary', title: '实时状态' },
  { id: 'overview-kpi', title: '核心指标' },
  { id: 'overview-filter', title: '综合筛选' },
  { id: 'overview-trend', title: '趋势分析' },
  { id: 'overview-distribution', title: '分布洞察' },
  { id: 'overview-keys', title: 'Key 审计' },
]

export function OverviewPage() {
  const filters = useOverviewFilters()
  const overviewQuery = useOverview()
  const keysQuery = useClientKeys()
  const groupOptions = useGroupOptions()
  const credentialsQuery = useCredentials()
  const seriesQuery = useTimeSeries(filters.timeFilter, filters.statsFilter)
  const modelQuery = useByModel(filters.timeFilter, filters.statsFilter)
  const credentialQuery = useByCredential(filters.timeFilter, filters.statsFilter)
  const keyQuery = useByKey(filters.timeFilter, filters.statsFilter)

  const refreshStats = useCallback(async () => {
    await Promise.all([
      overviewQuery.refetch(),
      keysQuery.refetch(),
      credentialsQuery.refetch(),
      seriesQuery.refetch(),
      modelQuery.refetch(),
      credentialQuery.refetch(),
      keyQuery.refetch(),
    ])
  }, [credentialQuery, credentialsQuery, keyQuery, keysQuery, modelQuery, overviewQuery, seriesQuery])

  const isRefreshing = [
    overviewQuery,
    keysQuery,
    credentialsQuery,
    seriesQuery,
    modelQuery,
    credentialQuery,
    keyQuery,
  ].some((query) => query.isFetching)

  const overview = overviewQuery.data
  const keysData = keysQuery.data
  const credentialsData = credentialsQuery.data
  const series = seriesQuery.data
  const byModel = modelQuery.data
  const byCred = credentialQuery.data
  const byKey = keyQuery.data

  const seriesData = useMemo(() => series ?? [], [series])
  const modelData = useMemo(() => byModel ?? [], [byModel])
  const credData = useMemo(() => byCred ?? [], [byCred])
  const keyData = useMemo(() => byKey ?? [], [byKey])
  const rangeStats = useMemo(() => aggregateSeries(seriesData), [seriesData])
  const selectedKeyLabel = selectedStatsKeyLabel(filters.keyFilter, keysData?.keys ?? [])
  const groupFilterActive = filters.groupFilter !== 'all'

  // 上游凭据与并发指标汇总
  const credsList = credentialsData?.credentials ?? []
  const totalCreds = credentialsData?.total ?? credsList.length
  const healthyCreds = credsList.filter((c) => !c.disabled && !c.throttledRemainingSecs).length
  const throttledCreds = credsList.filter((c) => !!c.throttledRemainingSecs).length
  const disabledCreds = credsList.filter((c) => c.disabled).length
  const inFlightTotal = credsList.reduce((acc, c) => acc + (c.inFlight || 0), 0)
  const currentRpmTotal = credsList.reduce((acc, c) => acc + (c.currentRpm || 0), 0)

  const activeKeys = keysData?.keys?.filter((k) => !k.disabled)?.length ?? overview?.activeClientKeys ?? 0
  const totalKeys = keysData?.keys?.length ?? 0

  const successRate =
    rangeStats.calls > 0
      ? (((rangeStats.calls - rangeStats.errors) / rangeStats.calls) * 100).toFixed(1)
      : '100'

  const totalTokens =
    rangeStats.inputTokens +
    rangeStats.outputTokens +
    rangeStats.cacheCreationTokens +
    rangeStats.cacheReadTokens

  const cacheHitRate =
    rangeStats.inputTokens + rangeStats.cacheReadTokens > 0
      ? ((rangeStats.cacheReadTokens / (rangeStats.inputTokens + rangeStats.cacheReadTokens)) * 100).toFixed(1)
      : '0.0'

  return (
    <div className="space-y-4 pb-12">
      <FloatingSectionNav items={OVERVIEW_NAV_ITEMS} />

      <PageHeader
        breadcrumbs={[{ label: '控制台' }, { label: '仪表概览', active: true }]}
        icon={<Activity className="h-4 w-4" />}
        title="仪表概览"
        description="实时监控网关高并发吞吐、Token 消耗流动、模型分布与客户端调用审计。"
        badge={
          <Badge variant="secondary" className="font-mono text-xs">
            {timeLabel(filters.timeFilter)}
          </Badge>
        }
        actions={
          <AutoRefreshControl
            onRefresh={refreshStats}
            isRefreshing={isRefreshing}
            resourceLabel="概览数据"
          />
        }
      />

      {/* 1. 实时网关综合运行态条 */}
      <div id="overview-summary">
        <GatewayTelemetryBanner
          healthyCreds={healthyCreds}
          totalCreds={totalCreds}
          throttledCreds={throttledCreds}
          disabledCreds={disabledCreds}
          inFlightTotal={inFlightTotal}
          currentRpmTotal={currentRpmTotal}
          activeKeys={activeKeys}
          totalKeys={totalKeys}
          successRate={successRate}
          hasErrors={rangeStats.errors > 0}
        />
      </div>

      {/* 2. 核心 KPI 现代指标卡阵列 */}
      <div id="overview-kpi">
        <HeroKpiGrid
          stats={rangeStats}
          totalTokens={totalTokens}
          cacheHitRate={cacheHitRate}
          successRate={successRate}
          inFlightTotal={inFlightTotal}
          currentRpmTotal={currentRpmTotal}
          healthyCreds={healthyCreds}
          totalCreds={totalCreds}
          activeKeys={activeKeys}
        />
      </div>

      {/* 3. 综合筛选与控制工具栏 */}
      <div id="overview-filter">
        <UnifiedFilterToolbar
          filters={filters}
          keys={keysData?.keys ?? []}
          groupOptions={groupOptions}
          selectedKeyLabel={selectedKeyLabel}
        />
      </div>

      {/* 4. 多维趋势交互中心 */}
      <div id="overview-trend">
        <InteractiveTrendCard
          seriesData={seriesData}
          timeFilter={filters.timeFilter}
          keyFilter={filters.keyFilter}
          rangeStats={rangeStats}
        />
      </div>

      {/* 5. 分布洞察：模型与上游凭据双栏 */}
      <div id="overview-distribution" className="grid gap-4 lg:grid-cols-2">
        <ModelDistributionSection
          data={modelData}
          timeText={timeLabel(filters.timeFilter)}
          groupFilterActive={groupFilterActive}
        />
        <CredentialDistributionSection
          data={credData}
          timeText={timeLabel(filters.timeFilter)}
        />
      </div>

      {/* 6. 客户端 Key 矩阵审计与消耗排行 */}
      <div id="overview-keys">
        <ClientKeyMatrixSection
          data={keyData}
          timeText={timeLabel(filters.timeFilter)}
          keyFilterActive={filters.keyFilter !== 'all'}
        />
      </div>
    </div>
  )
}

/* =========================================================================
   组件 1: 网关实时综合运行态 Banner
   ========================================================================= */
function GatewayTelemetryBanner({
  healthyCreds,
  totalCreds,
  throttledCreds,
  disabledCreds,
  inFlightTotal,
  currentRpmTotal,
  activeKeys,
  totalKeys,
  successRate,
  hasErrors,
}: {
  healthyCreds: number
  totalCreds: number
  throttledCreds: number
  disabledCreds: number
  inFlightTotal: number
  currentRpmTotal: number
  activeKeys: number
  totalKeys: number
  successRate: string
  hasErrors: boolean
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/70 bg-gradient-to-r from-card/90 via-card/70 to-card/90 p-3.5 shadow-xs backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* 左侧：服务状态与并发吞吐 */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span
                className={cn(
                  'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
                  hasErrors ? 'bg-amber-400' : 'bg-emerald-400',
                )}
              />
              <span
                className={cn(
                  'relative inline-flex h-2.5 w-2.5 rounded-full',
                  hasErrors ? 'bg-amber-500' : 'bg-emerald-500',
                )}
              />
            </span>
            <span className="font-semibold tracking-tight text-foreground">
              {hasErrors ? '网关稳定运行中' : '网关服务健康'}
            </span>
          </div>

          <div className="h-3.5 w-px bg-border/80 hidden sm:block" />

          {/* 实时在途并发 */}
          <div className="flex items-center gap-1.5 font-mono">
            <span className="text-muted-foreground flex items-center gap-1">
              <Zap className={cn('h-3.5 w-3.5', inFlightTotal > 0 ? 'text-amber-500 animate-pulse' : 'text-muted-foreground/60')} />
              在途并发:
            </span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-semibold',
                inFlightTotal > 0
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                  : 'text-foreground',
              )}
            >
              {inFlightTotal}
            </span>
          </div>

          <div className="h-3.5 w-px bg-border/80 hidden sm:block" />

          {/* 实时频率 */}
          <div className="flex items-center gap-1 font-mono text-muted-foreground">
            <Flame className="h-3.5 w-3.5 text-orange-500" />
            <span>实时 RPM:</span>
            <span className="font-semibold text-foreground">{currentRpmTotal}</span>
          </div>

          <div className="h-3.5 w-px bg-border/80 hidden sm:block" />

          {/* 成功率 */}
          <div className="flex items-center gap-1 font-mono text-muted-foreground">
            <span>成功率:</span>
            <span
              className={cn(
                'font-semibold',
                Number(successRate) >= 99
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : Number(successRate) >= 95
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-destructive',
              )}
            >
              {successRate}%
            </span>
          </div>
        </div>

        {/* 右侧：上游与调度 */}
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <Server className="h-3 w-3 text-muted-foreground/70" />
            <span>上游凭据:</span>
            <span className="font-semibold text-foreground">
              {healthyCreds}/{totalCreds} 就绪
            </span>
            {throttledCreds > 0 && (
              <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.2 text-[10px] text-amber-600 border border-amber-500/30">
                {throttledCreds} 冷却中
              </span>
            )}
            {disabledCreds > 0 && (
              <span className="ml-1 rounded bg-destructive/10 px-1 py-0.2 text-[10px] text-destructive border border-destructive/25">
                {disabledCreds} 禁用
              </span>
            )}
          </div>

          <div className="h-3.5 w-px bg-border/80 hidden md:block" />

          <div className="flex items-center gap-1">
            <KeyRound className="h-3 w-3 text-muted-foreground/70" />
            <span>客户端 Key:</span>
            <span className="font-semibold text-foreground">
              {activeKeys}/{totalKeys}
            </span>
          </div>

          <div className="h-3.5 w-px bg-border/80 hidden md:block" />

          <Badge variant="outline" className="text-[10px] font-normal py-0 h-5 border-border/80 bg-background/50">
            动态负载均衡 (并发感知)
          </Badge>
        </div>
      </div>
    </div>
  )
}

/* =========================================================================
   组件 2: 核心 KPI 现代指标卡阵列
   ========================================================================= */
interface RangeStats {
  calls: number
  credits: number
  errors: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

function aggregateSeries(data: TimeSeriesPoint[]): RangeStats {
  return data.reduce(
    (acc, p) => ({
      calls: acc.calls + p.calls,
      credits: acc.credits + (p.credits ?? 0),
      errors: acc.errors + p.errors,
      inputTokens: acc.inputTokens + p.inputTokens,
      outputTokens: acc.outputTokens + p.outputTokens,
      cacheCreationTokens: acc.cacheCreationTokens + (p.cacheCreationTokens || 0),
      cacheReadTokens: acc.cacheReadTokens + (p.cacheReadTokens || 0),
    }),
    {
      calls: 0,
      credits: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    },
  )
}

function HeroKpiGrid({
  stats,
  totalTokens,
  cacheHitRate,
  successRate,
  inFlightTotal,
  currentRpmTotal,
  healthyCreds,
  totalCreds,
  activeKeys,
}: {
  stats: RangeStats
  totalTokens: number
  cacheHitRate: string
  successRate: string
  inFlightTotal: number
  currentRpmTotal: number
  healthyCreds: number
  totalCreds: number
  activeKeys: number
}) {
  const avgTokens = stats.calls > 0 ? Math.round(totalTokens / stats.calls) : 0
  const avgCredit = stats.calls > 0 ? (stats.credits / stats.calls).toFixed(4) : '0'

  return (
    <div className="grid grid-cols-2 gap-3 max-[380px]:grid-cols-1 lg:grid-cols-5">
      {/* 1. API 调用总量 */}
      <Card className="group relative overflow-hidden border border-border/70 bg-card transition-all duration-200 hover:border-blue-500/40 hover:shadow-sm">
        <CardContent className="p-3.5 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">API 调用量</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-1">
            <span className="font-mono text-2xl font-bold tracking-tight text-foreground tabular-nums">
              {formatNumber(stats.calls)}
            </span>
            <Badge
              variant={stats.errors > 0 ? 'destructive' : 'secondary'}
              className="font-mono text-[10px] py-0 px-1.5 h-4"
            >
              {stats.errors > 0 ? `异常 ${formatNumber(stats.errors)}` : '零故障'}
            </Badge>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/80 border-t border-border/40 pt-2 font-mono">
            <span>成功率</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{successRate}%</span>
          </div>
        </CardContent>
      </Card>

      {/* 2. Token 总吞吐 */}
      <Card className="group relative overflow-hidden border border-border/70 bg-card transition-all duration-200 hover:border-emerald-500/40 hover:shadow-sm">
        <CardContent className="p-3.5 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Token 总吞吐</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
              <Cpu className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-1">
            <span className="font-mono text-2xl font-bold tracking-tight text-foreground tabular-nums">
              {formatNumber(totalTokens)}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              均次 {formatNumber(avgTokens)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/80 border-t border-border/40 pt-2 font-mono">
            <span>入 {formatNumber(stats.inputTokens)}</span>
            <span>出 {formatNumber(stats.outputTokens)}</span>
          </div>
        </CardContent>
      </Card>

      {/* 3. Prompt 缓存效能 */}
      <Card className="group relative overflow-hidden border border-border/70 bg-card transition-all duration-200 hover:border-cyan-500/40 hover:shadow-sm">
        <CardContent className="p-3.5 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">缓存命中率</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-500">
              <Zap className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-1">
            <span className="font-mono text-2xl font-bold tracking-tight text-foreground tabular-nums">
              {cacheHitRate}%
            </span>
            <Badge variant="outline" className="font-mono text-[10px] py-0 px-1.5 h-4 border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
              省流加速
            </Badge>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/80 border-t border-border/40 pt-2 font-mono">
            <span>读 {formatNumber(stats.cacheReadTokens)}</span>
            <span>写 {formatNumber(stats.cacheCreationTokens)}</span>
          </div>
        </CardContent>
      </Card>

      {/* 4. Credit 消耗估算 */}
      <Card className="group relative overflow-hidden border border-border/70 bg-card transition-all duration-200 hover:border-pink-500/40 hover:shadow-sm">
        <CardContent className="p-3.5 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Credit 消耗</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-pink-500/10 text-pink-500">
              <Coins className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-1">
            <span className="font-mono text-2xl font-bold tracking-tight text-foreground tabular-nums">
              {formatCredits(stats.credits)}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">上游计费折算</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/80 border-t border-border/40 pt-2 font-mono">
            <span>均次消耗</span>
            <span>${avgCredit}</span>
          </div>
        </CardContent>
      </Card>

      {/* 5. 调度负载与拓扑 */}
      <Card className="col-span-2 max-[380px]:col-span-1 lg:col-span-1 group relative overflow-hidden border border-border/70 bg-card transition-all duration-200 hover:border-purple-500/40 hover:shadow-sm">
        <CardContent className="p-3.5 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">并发与拓扑</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-purple-500/10 text-purple-500">
              <Server className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-1">
            <span className="font-mono text-2xl font-bold tracking-tight text-foreground tabular-nums flex items-center gap-1.5">
              <Zap className={cn("h-5 w-5 shrink-0", inFlightTotal > 0 ? "text-amber-500 fill-amber-500/30 animate-pulse" : "text-amber-500/60")} />
              {inFlightTotal}
              <span className="text-xs font-normal text-muted-foreground">在途</span>
            </span>
            <span className="font-mono text-xs text-muted-foreground">{currentRpmTotal} RPM</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/80 border-t border-border/40 pt-2 font-mono">
            <span>就绪上游 {healthyCreds}/{totalCreds}</span>
            <span>入口 {activeKeys} Key</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* =========================================================================
   组件 3: 综合筛选与控制工具栏
   ========================================================================= */
interface OverviewFiltersState {
  applyCustomRange: () => void
  customEndDate: string
  customStartDate: string
  draftGranularity: StatsGranularity
  draftRange?: StatsRange
  keyFilter: string
  groupFilter: string
  selectPresetRange: (range: StatsRange) => void
  setCustomEndDate: (value: string) => void
  setCustomStartDate: (value: string) => void
  setDraftGranularity: (value: StatsGranularity) => void
  setKeyFilter: (value: string) => void
  setGroupFilter: (value: string) => void
  statsFilter: StatsFilter
  timeFilter: StatsTimeFilter
}

function UnifiedFilterToolbar({
  filters,
  keys,
  groupOptions,
  selectedKeyLabel,
}: {
  filters: OverviewFiltersState
  keys: ClientKeyItem[]
  groupOptions: string[]
  selectedKeyLabel: string
}) {
  const hasCustomFilter = filters.keyFilter !== 'all' || filters.groupFilter !== 'all'

  return (
    <Card className="border border-border/70 bg-card/80 shadow-xs">
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* 左侧：时间窗口预设 + 粒度 + 日期输入 */}
          <div className="flex flex-wrap items-center gap-2">
            {/* 预设范围胶囊 */}
            <div className="flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => filters.selectPresetRange(r.value)}
                  className={cn(
                    'h-7 rounded-md px-2.5 text-xs font-medium transition-all',
                    filters.draftRange === r.value
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* 聚合粒度 */}
            <Select
              value={filters.draftGranularity}
              onValueChange={(v) => filters.setDraftGranularity(v as StatsGranularity)}
            >
              <SelectTrigger className="h-7 w-[96px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {GRANULARITIES.map((g) => (
                  <SelectItem key={g.value} value={g.value} className="text-xs">
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* 日期范围微调 */}
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <Input
                  type="date"
                  value={filters.customStartDate}
                  onChange={(e) => filters.setCustomStartDate(e.target.value)}
                  className="h-7 w-[145px] sm:w-[155px] rounded-md pl-2.5 pr-7 text-xs font-mono [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
                <Calendar className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">-</span>
              <div className="relative">
                <Input
                  type="date"
                  value={filters.customEndDate}
                  onChange={(e) => filters.setCustomEndDate(e.target.value)}
                  className="h-7 w-[145px] sm:w-[155px] rounded-md pl-2.5 pr-7 text-xs font-mono [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
                <Calendar className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs shrink-0"
                disabled={
                  !filters.customStartDate ||
                  !filters.customEndDate ||
                  filters.customEndDate < filters.customStartDate
                }
                onClick={filters.applyCustomRange}
              >
                应用
              </Button>
            </div>
          </div>

          {/* 右侧：入口 Key 与 分组筛选 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground/70" />
              <span>维度:</span>
            </div>

            {/* 入口 Key */}
            <Select value={filters.keyFilter} onValueChange={filters.setKeyFilter}>
              <SelectTrigger className="h-7 w-[160px] text-xs">
                <SelectValue placeholder="全部入口 Key" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all" className="text-xs">全部入口 Key</SelectItem>
                {keys.map((key) => (
                  <SelectItem key={key.id} value={String(key.id)} className="text-xs">
                    {key.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* 账号分组 */}
            <Select value={filters.groupFilter} onValueChange={filters.setGroupFilter}>
              <SelectTrigger className="h-7 w-[130px] text-xs">
                <SelectValue placeholder="全部分组" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all" className="text-xs">全部分组</SelectItem>
                {groupOptions.map((g) => (
                  <SelectItem key={g} value={g} className="text-xs">
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasCustomFilter && (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-[11px] truncate max-w-[140px]" title={selectedKeyLabel}>
                  {selectedKeyLabel}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    filters.setKeyFilter('all')
                    filters.setGroupFilter('all')
                  }}
                  title="清除维度筛选"
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  重置
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* =========================================================================
   组件 4: 多维趋势交互中心
   ========================================================================= */
function InteractiveTrendCard({
  seriesData,
  timeFilter,
  keyFilter,
  rangeStats,
}: {
  seriesData: TimeSeriesPoint[]
  timeFilter: StatsTimeFilter
  keyFilter: string
  rangeStats: RangeStats
}) {
  const [metricMode, setMetricMode] = useState<ChartMetricMode>('tokens')
  const chartKey = `${timeLabel(timeFilter)}:${keyFilter}:${metricMode}`

  return (
    <Card className="border border-border/70 shadow-xs">
      <CardContent className="p-4 sm:p-5">
        {/* 图表顶部工具栏 */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">时间窗口流量趋势</h2>
              <Badge variant="outline" className="font-mono text-[10px] py-0 h-4">
                {timeFilter.granularity === 'day' ? '天级聚合' : '小时级聚合'}
              </Badge>
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {metricMode === 'tokens' && '实时洞察 Input、Output 与 Prompt Cache 读写吞吐变化。'}
              {metricMode === 'calls' && '请求调用量与异常突增峰值审计，排查接口故障与限流。'}
              {metricMode === 'credits' && '各时段计费 Credit 消耗流速，辅助成本核算。'}
            </p>
          </div>

          {/* 模式切换 Tabs 与区间快报 */}
          <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
            <div className="hidden lg:flex items-center gap-2 text-[11px] font-mono text-muted-foreground mr-1 border-r border-border/50 pr-3">
              <span>调用: <strong className="text-foreground">{formatNumber(rangeStats.calls)}</strong></span>
              <span>·</span>
              <span>异常: <strong className={rangeStats.errors > 0 ? 'text-destructive' : 'text-foreground'}>{formatNumber(rangeStats.errors)}</strong></span>
              <span>·</span>
              <span>Token: <strong className="text-foreground">{formatNumber(rangeStats.inputTokens + rangeStats.outputTokens)}</strong></span>
            </div>

            <div className="flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => setMetricMode('tokens')}
                className={cn(
                  'flex items-center gap-1 h-7 rounded-md px-2.5 text-xs font-medium transition-all',
                  metricMode === 'tokens'
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Cpu className="h-3.5 w-3.5 text-emerald-500" />
                Token 吞吐
              </button>
            <button
              type="button"
              onClick={() => setMetricMode('calls')}
              className={cn(
                'flex items-center gap-1 h-7 rounded-md px-2.5 text-xs font-medium transition-all',
                metricMode === 'calls'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Activity className="h-3.5 w-3.5 text-blue-500" />
              调用量 / 异常
            </button>
            <button
              type="button"
              onClick={() => setMetricMode('credits')}
              className={cn(
                'flex items-center gap-1 h-7 rounded-md px-2.5 text-xs font-medium transition-all',
                metricMode === 'credits'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Coins className="h-3.5 w-3.5 text-pink-500" />
              Credit 消耗
            </button>
          </div>
        </div>
      </div>

        {/* 折线图 */}
        <div key={chartKey} className="chart-range-fade">
          <TimeSeriesChart
            data={seriesData}
            granularity={timeFilter.granularity}
            mode={metricMode}
          />
        </div>
      </CardContent>
    </Card>
  )
}

/* =========================================================================
   组件 5: 分布洞察：模型分布与上游凭据分布
   ========================================================================= */
function ModelDistributionSection({
  data,
  timeText,
  groupFilterActive,
}: {
  data: ModelDistribution[]
  timeText: string
  groupFilterActive: boolean
}) {
  const totalCalls = useMemo(() => data.reduce((s, d) => s + d.calls, 0), [data])
  const PALETTE = [
    '#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#ec4899',
    '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6',
  ]

  return (
    <Card className="border border-border/70 shadow-xs flex flex-col">
      <CardContent className="p-4 sm:p-5 flex-1 flex flex-col">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold tracking-tight">按模型分布</h2>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">{timeText}</span>
        </div>

        {groupFilterActive && (
          <p className="mb-3 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600">
            已启用分组筛选。模型分布数据为全网关聚合，未细分至单独分组。
          </p>
        )}

        <ModelPieChart data={data} />

        {/* 紧凑现代排行榜表格 */}
        {data.length > 0 && (
          <div className="mt-4 border-t border-border/60 pt-3">
            <div className="max-h-48 overflow-auto text-xs">
              <table className="w-full">
                <thead className="text-muted-foreground border-b border-border/40 text-[11px]">
                  <tr>
                    <th className="text-left font-medium pb-1.5">模型</th>
                    <th className="text-right font-medium pb-1.5">占比</th>
                    <th className="text-right font-medium pb-1.5">调用量</th>
                    <th className="text-right font-medium pb-1.5">输入</th>
                    <th className="text-right font-medium pb-1.5">输出</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30 font-mono">
                  {data.map((m, idx) => {
                    const ratio = totalCalls > 0 ? ((m.calls / totalCalls) * 100).toFixed(1) : '0.0'
                    const color = PALETTE[idx % PALETTE.length]
                    return (
                      <tr key={m.model} className="hover:bg-muted/40 transition-colors">
                        <td className="py-1.5 font-sans font-medium text-foreground flex items-center gap-2 truncate max-w-[160px]">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ background: color }}
                          />
                          <span className="truncate" title={m.model}>{m.model}</span>
                        </td>
                        <td className="text-right py-1.5 text-muted-foreground text-[11px]">
                          {ratio}%
                        </td>
                        <td className="text-right py-1.5 font-semibold text-foreground">
                          {formatNumber(m.calls)}
                        </td>
                        <td className="text-right py-1.5 text-muted-foreground text-[11px]">
                          {formatNumber(m.inputTokens)}
                        </td>
                        <td className="text-right py-1.5 text-muted-foreground text-[11px]">
                          {formatNumber(m.outputTokens)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CredentialDistributionSection({
  data,
  timeText,
}: {
  data: CredentialDistribution[]
  timeText: string
}) {
  return (
    <Card className="border border-border/70 shadow-xs flex flex-col">
      <CardContent className="p-4 sm:p-5 flex-1 flex flex-col">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold tracking-tight">上游凭据贡献</h2>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">
            Top {Math.min(data.length, 12)} · {timeText}
          </span>
        </div>

        <CredentialBarChart data={data} />

        {/* 凭据明细列表 */}
        {data.length > 0 && (
          <div className="mt-4 border-t border-border/60 pt-3">
            <div className="max-h-48 overflow-auto text-xs">
              <table className="w-full">
                <thead className="text-muted-foreground border-b border-border/40 text-[11px]">
                  <tr>
                    <th className="text-left font-medium pb-1.5">上游账号</th>
                    <th className="text-right font-medium pb-1.5">处理请求</th>
                    <th className="text-right font-medium pb-1.5">输入 Token</th>
                    <th className="text-right font-medium pb-1.5">输出 Token</th>
                    <th className="text-right font-medium pb-1.5">异常</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30 font-mono">
                  {data.slice(0, 8).map((c) => (
                    <tr key={c.credentialId} className="hover:bg-muted/40 transition-colors">
                      <td className="py-1.5 font-sans truncate max-w-[170px]" title={c.email ?? `#${c.credentialId}`}>
                        <span className="font-semibold text-foreground mr-1">#{c.credentialId}</span>
                        <span className="text-muted-foreground text-[11px]">{c.email ?? '匿名凭据'}</span>
                      </td>
                      <td className="text-right py-1.5 font-semibold text-foreground">
                        {formatNumber(c.calls)}
                      </td>
                      <td className="text-right py-1.5 text-muted-foreground text-[11px]">
                        {formatNumber(c.inputTokens)}
                      </td>
                      <td className="text-right py-1.5 text-muted-foreground text-[11px]">
                        {formatNumber(c.outputTokens)}
                      </td>
                      <td className="text-right py-1.5 text-[11px]">
                        {c.errors > 0 ? (
                          <span className="text-destructive font-semibold">{c.errors}</span>
                        ) : (
                          <span className="text-muted-foreground/60">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* =========================================================================
   组件 6: 客户端 Key 矩阵审计与消耗排行
   ========================================================================= */
function ClientKeyMatrixSection({
  data,
  timeText,
  keyFilterActive,
}: {
  data: KeyDistribution[]
  timeText: string
  keyFilterActive: boolean
}) {
  const totalCalls = useMemo(() => data.reduce((s, k) => s + k.calls, 0), [data])

  return (
    <Card className="border border-border/70 shadow-xs">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold tracking-tight">客户端 Key 消耗审计与排行</h2>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">
            共 {data.length} 个 Key 产生调用 · {timeText}
          </span>
        </div>

        {keyFilterActive && (
          <p className="mb-3 rounded-md bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-600">
            本审计表为全量 Key 横向对比排行榜，不受上方「单 Key 筛选」限制。
          </p>
        )}

        <KeyBarChart data={data} />

        {/* 审计排行详情大表 */}
        {data.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border/60 text-muted-foreground text-[11px]">
                <tr>
                  <th className="text-left font-medium pb-2 w-12">排行</th>
                  <th className="text-left font-medium pb-2 min-w-[140px]">Key 名称</th>
                  <th className="text-right font-medium pb-2 min-w-[80px]">调用量</th>
                  <th className="text-left font-medium pb-2 min-w-[120px] pl-4">用量占比</th>
                  <th className="text-right font-medium pb-2 min-w-[80px]">输入 Token</th>
                  <th className="text-right font-medium pb-2 min-w-[80px]">输出 Token</th>
                  <th className="text-right font-medium pb-2 min-w-[80px]">缓存命中</th>
                  <th className="text-right font-medium pb-2 min-w-[60px]">异常</th>
                  <th className="text-right font-medium pb-2 min-w-[90px]">Credit 消耗</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30 font-mono">
                {data.map((k, index) => {
                  const ratio = totalCalls > 0 ? (k.calls / totalCalls) * 100 : 0
                  return (
                    <tr key={k.keyId} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2 text-left">
                        {index === 0 && (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-[10px] font-bold text-amber-600">
                            1
                          </span>
                        )}
                        {index === 1 && (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-400/20 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                            2
                          </span>
                        )}
                        {index === 2 && (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-700/20 text-[10px] font-bold text-amber-700 dark:text-amber-500">
                            3
                          </span>
                        )}
                        {index > 2 && (
                          <span className="text-muted-foreground/80 pl-1">#{index + 1}</span>
                        )}
                      </td>
                      <td className="py-2 font-sans font-medium text-foreground max-w-[180px] truncate" title={k.name}>
                        {k.name}
                      </td>
                      <td className="py-2 text-right font-semibold text-foreground">
                        {formatNumber(k.calls)}
                      </td>
                      <td className="py-2 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(100, Math.max(2, ratio))}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground w-9 text-right shrink-0">
                            {ratio.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="py-2 text-right text-muted-foreground text-[11px]">
                        {formatNumber(k.inputTokens)}
                      </td>
                      <td className="py-2 text-right text-muted-foreground text-[11px]">
                        {formatNumber(k.outputTokens)}
                      </td>
                      <td className="py-2 text-right text-muted-foreground text-[11px]">
                        {formatNumber(k.cacheReadTokens)}
                      </td>
                      <td className="py-2 text-right text-[11px]">
                        {k.errors > 0 ? (
                          <span className="text-destructive font-semibold">{k.errors}</span>
                        ) : (
                          <span className="text-muted-foreground/60">0</span>
                        )}
                      </td>
                      <td className="py-2 text-right font-semibold text-pink-600 dark:text-pink-400">
                        {formatCredits(k.credits)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* =========================================================================
   筛选器 Hook
   ========================================================================= */
function useOverviewFilters(): OverviewFiltersState {
  const today = useMemo(() => toDateInputValue(new Date()), [])
  const [timeFilter, setTimeFilter] = useState<StatsTimeFilter>(() =>
    customTimeFilter(presetStartDate('24h', today), today, 'hour'),
  )
  const [customStartDate, setCustomStartDate] = useState(() => presetStartDate('24h', today))
  const [customEndDate, setCustomEndDate] = useState(today)
  const [draftGranularity, setDraftGranularity] = useState<StatsGranularity>('hour')
  const [draftRange, setDraftRange] = useState<StatsRange | undefined>('24h')
  const [keyFilter, setKeyFilter] = useState('all')
  const [groupFilter, setGroupFilter] = useState('all')

  const statsFilter = useMemo<StatsFilter>(() => {
    const f: StatsFilter = {}
    if (keyFilter !== 'all') f.keyId = Number(keyFilter)
    if (groupFilter !== 'all') f.group = groupFilter
    return f
  }, [keyFilter, groupFilter])

  const applyCustomRange = () => {
    setTimeFilter(customTimeFilter(customStartDate, customEndDate, draftGranularity))
  }

  const updateCustomStartDate = (value: string) => {
    setCustomStartDate(value)
    setDraftRange(undefined)
  }

  const updateCustomEndDate = (value: string) => {
    setCustomEndDate(value)
    setDraftRange(undefined)
  }

  const selectPresetRange = (range: StatsRange) => {
    const endDate = toDateInputValue(new Date())
    setCustomStartDate(presetStartDate(range, endDate))
    setCustomEndDate(endDate)
    setDraftRange(range)
    setTimeFilter(customTimeFilter(presetStartDate(range, endDate), endDate, draftGranularity))
  }

  return {
    applyCustomRange,
    customEndDate,
    customStartDate,
    draftGranularity,
    draftRange,
    keyFilter,
    groupFilter,
    selectPresetRange,
    setCustomEndDate: updateCustomEndDate,
    setCustomStartDate: updateCustomStartDate,
    setDraftGranularity,
    setKeyFilter,
    setGroupFilter,
    statsFilter,
    timeFilter,
  }
}

function selectedStatsKeyLabel(keyFilter: string, keys: ClientKeyItem[]): string {
  if (keyFilter === 'all') return '全部入口 Key'
  return keys.find((k) => String(k.id) === keyFilter)?.name ?? `#${keyFilter}`
}
