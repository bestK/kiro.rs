import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Calculator,
  TrendingUp,
  TrendingDown,
  Coins,
  Percent,
  Layers,
  Search,
  RefreshCw,
  RotateCcw,
  Loader2,
  Eye,
  EyeOff,
  Check,
  ChevronDown,
  ChevronUp,
  BarChart2,
  Calendar,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  useFetchNewApiGroups,
  useCalculateProfit,
} from '@/hooks/use-credentials'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { CalculateProfitResponse } from '@/types/api'

interface ProfitCalculatorProps {
  currentCreditPrice: number
}

export function ProfitCalculator({ currentCreditPrice }: ProfitCalculatorProps) {
  // 1. 下游连接与认证配置
  const [baseUrl, setBaseUrl] = useState(() => {
    return (
      localStorage.getItem('kiro_profit_newapi_url') ||
      localStorage.getItem('kiro_verify_downstream_url') ||
      ''
    )
  })
  const [adminKey, setAdminKey] = useState(() => {
    return localStorage.getItem('kiro_profit_newapi_key') || ''
  })
  const [showKey, setShowKey] = useState(false)

  // 2. 分组选择
  const [groups, setGroups] = useState<string[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string>(() => {
    return localStorage.getItem('kiro_profit_selected_group') || '__all__'
  })
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')
  const groupDropdownRef = useRef<HTMLDivElement>(null)

  // 3. 时间范围选择
  type TimeRange = 'today' | '24h' | '7d' | '30d' | 'all'
  const [timeRange, setTimeRange] = useState<TimeRange>('24h')

  // 4. 销售单价与成本单价设置
  // 销售折算单价（默认跟随全局当前表单配置，可临时覆盖）
  const [customSellingUnit, setCustomSellingUnit] = useState<'k' | 'single'>('k')
  const [customSellingPrice, setCustomSellingPrice] = useState<number | null>(null)
  const effectiveSellingPrice = customSellingPrice !== null ? customSellingPrice : currentCreditPrice

  // 成本单价设置
  const [costMode, setCostMode] = useState<'credit_price' | 'official_model'>('credit_price')
  const [costUnit, setCostUnit] = useState<'k' | 'single'>('k')
  // 成本单价默认设为销售价的 50%
  const [costPrice, setCostPrice] = useState<number>(() => +(currentCreditPrice * 0.5).toFixed(6))
  const [costInputStr, setCostInputStr] = useState<string>(() => {
    return String(+((currentCreditPrice * 0.5) * 1000).toFixed(4))
  })

  // 当全局配置变动且未手动锁定时，同步更新成本价初值
  useEffect(() => {
    if (customSellingPrice === null) {
      const defaultCost = +(currentCreditPrice * 0.5).toFixed(6)
      setCostPrice(defaultCost)
      setCostInputStr(String(costUnit === 'k' ? +(defaultCost * 1000).toFixed(4) : defaultCost))
    }
  }, [currentCreditPrice, customSellingPrice, costUnit])

  // 5. 汇率设置（默认 500,000 Quota/USD）
  const [quotaPerUsd, setQuotaPerUsd] = useState<number>(500000)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // 6. 测算结果状态
  const [calcResult, setCalcResult] = useState<CalculateProfitResponse | null>(null)

  // Mutations
  const fetchGroupsMutation = useFetchNewApiGroups()
  const calculateMutation = useCalculateProfit()

  // 拉取下游 New API 分组
  const handleFetchGroups = async (silent = false) => {
    const cleanUrl = baseUrl.trim()
    const cleanKey = adminKey.trim()
    if (!cleanUrl || !cleanKey) {
      if (!silent) {
        toast.error('请先输入下游 New API 地址与管理员令牌')
      }
      return
    }

    try {
      const res = await fetchGroupsMutation.mutateAsync({
        baseUrl: cleanUrl,
        adminKey: cleanKey,
      })
      if (res.success && res.groups && res.groups.length > 0) {
        setGroups(res.groups)
        if (!silent) {
          toast.success(`成功从 New API 获取到 ${res.groups.length} 个分组`)
        }
      } else if (!silent) {
        toast.error(res.error || '未获取到有效分组')
      }
    } catch (err: any) {
      if (!silent) {
        toast.error('获取分组失败: ' + (err?.message || String(err)))
      }
    }
  }

  // 组件挂载时若已有 url 和 key 则尝试拉取分组
  useEffect(() => {
    if (baseUrl.trim() && adminKey.trim()) {
      handleFetchGroups(true)
    }
  }, [])

  // 点击外部关闭分组下拉
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        groupDropdownRef.current &&
        !groupDropdownRef.current.contains(event.target as Node)
      ) {
        setIsGroupDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 过滤后的分组列表
  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((g) => g.toLowerCase().includes(q))
  }, [groups, groupSearch])

  // 执行测算
  const handleCalculate = async () => {
    const cleanUrl = baseUrl.trim()
    const cleanKey = adminKey.trim()
    if (!cleanUrl) {
      toast.error('请输入下游 New API 地址')
      return
    }
    if (!cleanKey) {
      toast.error('请输入管理员令牌 (Admin Key)')
      return
    }

    localStorage.setItem('kiro_profit_newapi_url', cleanUrl)
    localStorage.setItem('kiro_profit_newapi_key', cleanKey)
    localStorage.setItem('kiro_profit_selected_group', selectedGroup)

    try {
      const res = await calculateMutation.mutateAsync({
        baseUrl: cleanUrl,
        adminKey: cleanKey,
        group: selectedGroup === '__all__' ? undefined : selectedGroup,
        timeRange,
        sellingCreditPrice: effectiveSellingPrice,
        costCreditPrice: costPrice,
        costMode,
        quotaPerUsd: quotaPerUsd > 0 ? quotaPerUsd : 500000,
      })

      if (res.success) {
        setCalcResult(res)
        toast.success(
          `测算成功！${res.group} 共发生 ${res.totalRequests.toLocaleString()} 次请求，预估毛利润 $${res.totalProfitUsd.toFixed(2)}`
        )
      } else {
        toast.error(res.error || '测算失败，下游接口返回异常')
      }
    } catch (err: any) {
      toast.error('测算请求失败: ' + (err?.message || String(err)))
    }
  }

  // 成本价格快捷设置
  const handleCostPresetRatio = (ratio: number) => {
    const nextCost = +(effectiveSellingPrice * ratio).toFixed(6)
    setCostPrice(nextCost)
    setCostInputStr(String(costUnit === 'k' ? +(nextCost * 1000).toFixed(4) : nextCost))
  }

  const handleCostPriceCommit = (strVal: string) => {
    const num = Number(strVal)
    if (!Number.isFinite(num) || num < 0) return
    const perCredit = costUnit === 'k' ? +(num / 1000).toFixed(6) : num
    setCostPrice(perCredit)
  }

  return (
    <div className="space-y-4">
      {/* 头部引导说明 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Calculator className="h-4 w-4 text-primary" />
              <span>下游用量与利润测算 (盈亏分析)</span>
            </h3>
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
              商业核算
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            输入下游 New API 接口与管理员令牌，拉取指定分组真实用量数据，与当前折算配置对比计算实际收益、成本与毛利润率。
          </p>
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">表单当前基准：</span>
          <strong className="text-foreground font-mono">
            ${+(currentCreditPrice * 1000).toFixed(4)} / 千分
          </strong>
          <span className="text-[11px] text-muted-foreground font-mono">
            (${currentCreditPrice} / 积分)
          </span>
        </div>
      </div>

      {/* 参数输入卡片 */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-4">
        {/* 第一行：下游地址与 Key */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-foreground flex items-center justify-between">
              <span>下游 New API 地址 (Base URL)</span>
              <span className="text-[10px] text-muted-foreground font-normal">
                支持直连或反代地址
              </span>
            </label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://airouter.linkof.link"
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-foreground flex items-center justify-between">
              <span>管理员令牌 (Admin Key / Root Token)</span>
              <span className="text-[10px] text-muted-foreground font-normal">
                用于拉取 /api/group/ 与 /api/log/stat
              </span>
            </label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="rMlDNQoCdwWONBEQh5gV42zAFgubow=="
                className="h-8 text-xs font-mono pr-8"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* 第二行：分组选择与时间范围 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
          {/* 分组选择器 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-foreground flex items-center gap-1">
                <span>测算分组 (Group)</span>
                <span className="text-destructive">*</span>
              </label>
              <button
                type="button"
                onClick={() => handleFetchGroups(false)}
                disabled={fetchGroupsMutation.isPending}
                className="text-[10px] text-primary hover:underline flex items-center gap-1"
              >
                {fetchGroupsMutation.isPending ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-2.5 w-2.5" />
                )}
                <span>{groups.length > 0 ? `刷新分组 (${groups.length})` : '获取分组列表'}</span>
              </button>
            </div>

            <div className="relative" ref={groupDropdownRef}>
              <div
                onClick={() => setIsGroupDropdownOpen(!isGroupDropdownOpen)}
                className={cn(
                  'h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs cursor-pointer flex items-center justify-between shadow-xs transition-colors hover:border-primary/50',
                  isGroupDropdownOpen && 'border-primary ring-1 ring-primary'
                )}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-mono truncate">
                    {selectedGroup === '__all__'
                      ? '全部分组 (汇总所有下游用量)'
                      : selectedGroup}
                  </span>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-2" />
              </div>

              {isGroupDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
                  <div className="p-1.5 border-b border-border/50">
                    <div className="relative">
                      <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={groupSearch}
                        onChange={(e) => setGroupSearch(e.target.value)}
                        placeholder="过滤分组名称..."
                        className="h-7 pl-6 text-xs"
                        autoFocus
                      />
                    </div>
                  </div>

                  <div className="max-h-56 overflow-y-auto p-1 space-y-0.5 font-mono text-xs">
                    {/* 全部分组选项 */}
                    <div
                      onClick={() => {
                        setSelectedGroup('__all__')
                        setIsGroupDropdownOpen(false)
                      }}
                      className={cn(
                        'px-2 py-1.5 rounded cursor-pointer text-xs flex items-center justify-between transition-colors',
                        selectedGroup === '__all__'
                          ? 'bg-primary text-primary-foreground font-medium'
                          : 'hover:bg-accent hover:text-accent-foreground text-foreground'
                      )}
                    >
                      <span className="truncate font-sans font-medium">全部分组 (汇总统计全部用量)</span>
                      {selectedGroup === '__all__' && <Check className="h-3.5 w-3.5 shrink-0 ml-1.5" />}
                    </div>

                    {groups.length === 0 ? (
                      <div className="p-3 text-center text-xs text-muted-foreground font-sans space-y-1.5">
                        <p>尚未拉取到下游分组</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleFetchGroups(false)
                          }}
                        >
                          立即拉取
                        </Button>
                      </div>
                    ) : filteredGroups.length === 0 ? (
                      <div className="p-3 text-center text-xs text-muted-foreground font-sans">
                        未匹配到分组
                      </div>
                    ) : (
                      filteredGroups.map((g) => {
                        const isSelected = g === selectedGroup
                        return (
                          <div
                            key={g}
                            onClick={() => {
                              setSelectedGroup(g)
                              setIsGroupDropdownOpen(false)
                            }}
                            className={cn(
                              'px-2 py-1.5 rounded cursor-pointer text-xs flex items-center justify-between transition-colors',
                              isSelected
                                ? 'bg-primary text-primary-foreground font-medium'
                                : 'hover:bg-accent hover:text-accent-foreground text-foreground'
                            )}
                          >
                            <span className="truncate">{g}</span>
                            {isSelected && <Check className="h-3.5 w-3.5 shrink-0 ml-1.5" />}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 时间范围快捷选择 */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3 text-muted-foreground" />
              <span>用量统计时间周期</span>
            </label>

            <div className="grid grid-cols-5 gap-1">
              {[
                { key: 'today', label: '今天' },
                { key: '24h', label: '近24小时' },
                { key: '7d', label: '近7天' },
                { key: '30d', label: '近30天' },
                { key: 'all', label: '全部历史' },
              ].map((item) => (
                <Button
                  key={item.key}
                  type="button"
                  size="sm"
                  variant={timeRange === item.key ? 'default' : 'outline'}
                  className={cn(
                    'h-8 px-1 text-xs',
                    timeRange === item.key && 'shadow-xs font-medium'
                  )}
                  onClick={() => setTimeRange(item.key as TimeRange)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* 第三行：销售折算基准 & 成本核算单价 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1 border-t border-border/40">
          {/* 销售折算基准单价 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-foreground flex items-center gap-1">
                <span>测算采用销售单价</span>
                {customSellingPrice !== null ? (
                  <Badge variant="outline" className="text-[9px] text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10">
                    自定义试算
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[9px]">
                    跟随当前表单
                  </Badge>
                )}
              </label>

              {customSellingPrice !== null && (
                <button
                  type="button"
                  onClick={() => setCustomSellingPrice(null)}
                  className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  重置为表单单价
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">$</span>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={
                    customSellingPrice !== null
                      ? customSellingUnit === 'k'
                        ? +(customSellingPrice * 1000).toFixed(4)
                        : customSellingPrice
                      : customSellingUnit === 'k'
                      ? +(currentCreditPrice * 1000).toFixed(4)
                      : currentCreditPrice
                  }
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n >= 0) {
                      setCustomSellingPrice(customSellingUnit === 'k' ? +(n / 1000).toFixed(6) : n)
                    }
                  }}
                  className="h-8 pl-6 text-xs font-mono"
                />
              </div>

              <div className="inline-flex h-8 items-center rounded-md border border-border bg-secondary/50 p-0.5">
                <button
                  type="button"
                  onClick={() => setCustomSellingUnit('k')}
                  className={cn(
                    'inline-flex h-7 items-center rounded px-2 text-[11px] font-medium transition-colors',
                    customSellingUnit === 'k'
                      ? 'bg-card text-foreground shadow-xs border border-border/80'
                      : 'text-muted-foreground hover:text-foreground border border-transparent'
                  )}
                >
                  $/千分
                </button>
                <button
                  type="button"
                  onClick={() => setCustomSellingUnit('single')}
                  className={cn(
                    'inline-flex h-7 items-center rounded px-2 text-[11px] font-medium transition-colors',
                    customSellingUnit === 'single'
                      ? 'bg-card text-foreground shadow-xs border border-border/80'
                      : 'text-muted-foreground hover:text-foreground border border-transparent'
                  )}
                >
                  $/积分
                </button>
              </div>
            </div>
          </div>

          {/* 上游采购成本单价 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-foreground flex items-center gap-1">
                <span>上游采购成本基准</span>
                <span className="text-[10px] text-muted-foreground font-normal">
                  (用于计算扣除成本后的净利润)
                </span>
              </label>

              {/* 成本快捷折扣比例 */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleCostPresetRatio(0.5)}
                  className="text-[10px] text-primary hover:underline px-1 py-0.5 rounded bg-primary/5"
                >
                  5折
                </button>
                <button
                  type="button"
                  onClick={() => handleCostPresetRatio(0.6)}
                  className="text-[10px] text-primary hover:underline px-1 py-0.5 rounded bg-primary/5"
                >
                  6折
                </button>
                <button
                  type="button"
                  onClick={() => handleCostPresetRatio(0.7)}
                  className="text-[10px] text-primary hover:underline px-1 py-0.5 rounded bg-primary/5"
                >
                  7折
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">$</span>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={costInputStr}
                  onChange={(e) => {
                    setCostInputStr(e.target.value)
                    handleCostPriceCommit(e.target.value)
                  }}
                  className="h-8 pl-6 text-xs font-mono"
                />
              </div>

              <div className="inline-flex h-8 items-center rounded-md border border-border bg-secondary/50 p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setCostUnit('k')
                    setCostInputStr(String(+(costPrice * 1000).toFixed(4)))
                  }}
                  className={cn(
                    'inline-flex h-7 items-center rounded px-2 text-[11px] font-medium transition-colors',
                    costUnit === 'k'
                      ? 'bg-card text-foreground shadow-xs border border-border/80'
                      : 'text-muted-foreground hover:text-foreground border border-transparent'
                  )}
                >
                  $/千分
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCostUnit('single')
                    setCostInputStr(String(costPrice))
                  }}
                  className={cn(
                    'inline-flex h-7 items-center rounded px-2 text-[11px] font-medium transition-colors',
                    costUnit === 'single'
                      ? 'bg-card text-foreground shadow-xs border border-border/80'
                      : 'text-muted-foreground hover:text-foreground border border-transparent'
                  )}
                >
                  $/积分
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作行 */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1"
            >
              <span>{showAdvanced ? '收起高级选项' : '展开高级选项 (汇率/核算模式)'}</span>
              {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </div>

          <Button
            size="sm"
            onClick={handleCalculate}
            disabled={calculateMutation.isPending}
            className="h-8 px-5 text-xs gap-1.5 shadow-sm"
          >
            {calculateMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>正在拉取用量并核算盈亏...</span>
              </>
            ) : (
              <>
                <Zap className="h-3.5 w-3.5" />
                <span>开始利润测算</span>
              </>
            )}
          </Button>
        </div>

        {/* 高级选项折叠面板 */}
        {showAdvanced && (
          <div className="rounded-md border border-border/40 bg-background/60 p-3 text-xs space-y-3 animate-in fade-in-50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-foreground">
                  New API 配额兑换汇率 (Quota / USD)
                </label>
                <Input
                  type="number"
                  min="1"
                  value={quotaPerUsd}
                  onChange={(e) => setQuotaPerUsd(Number(e.target.value) || 500000)}
                  className="h-7 text-xs font-mono"
                  placeholder="500000"
                />
                <p className="text-[10px] text-muted-foreground">
                  New API 标准为 500,000 配额 = $1.00 USD。如有自定义倍率或充值优惠，可在此调整。
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-foreground">
                  成本核算模式
                </label>
                <div className="flex items-center gap-2 pt-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={costMode === 'credit_price' ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => setCostMode('credit_price')}
                  >
                    按积分采购成本核算 (推荐)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={costMode === 'official_model' ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => setCostMode('official_model')}
                  >
                    按模型官方定价核算
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 测算结果展示区域 */}
      {calcResult && (
        <div className="space-y-4 animate-in fade-in-50 duration-300">
          {/* 1. 测算概览状态条 */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-card p-3.5 shadow-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs px-2 py-0.5 border-primary/40 text-primary bg-primary/5">
                {calcResult.group}
              </Badge>
              {calcResult.groupRatio !== undefined && calcResult.groupRatio !== null && (
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    下游分组倍率: {calcResult.groupRatio}x
                  </Badge>
                  <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5">
                    相当于官方 {(calcResult.groupRatio * 10).toFixed(1)} 折 (省 {Math.max(0, Math.round((1 - calcResult.groupRatio) * 100))}%)
                  </Badge>
                </div>
              )}
              <span className="text-xs text-muted-foreground">
                统计周期：
                <strong className="text-foreground font-mono">
                  {calcResult.timeRange === 'today'
                    ? '今天'
                    : calcResult.timeRange === '24h'
                    ? '近 24 小时'
                    : calcResult.timeRange === '7d'
                    ? '近 7 天'
                    : calcResult.timeRange === '30d'
                    ? '近 30 天'
                    : '全部历史'}
                </strong>
              </span>
              <span className="text-xs text-muted-foreground">
                总请求数：
                <strong className="text-foreground font-mono">
                  {calcResult.totalRequests.toLocaleString()} 次
                </strong>
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">销售价：</span>
              <span className="font-mono text-foreground">${+(effectiveSellingPrice * 1000).toFixed(4)}/千分</span>
              <span className="text-muted-foreground">· 成本价：</span>
              <span className="font-mono text-foreground">${+(costPrice * 1000).toFixed(4)}/千分</span>
            </div>
          </div>

          {/* 2. 核心财务指标卡片网格 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* 下游实收营业额 */}
            <div className="rounded-lg border border-border/60 bg-card p-4 space-y-1 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground text-xs">
                <span>下游实收营业额</span>
                <Coins className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="text-xl font-bold font-mono text-foreground">
                ${calcResult.totalRevenueUsd.toFixed(2)}
                <span className="text-xs text-muted-foreground font-normal ml-1">USD</span>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                扣减配额: ~{calcResult.totalQuota.toLocaleString()}
              </div>
            </div>

            {/* 上游核算总成本 */}
            <div className="rounded-lg border border-border/60 bg-card p-4 space-y-1 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground text-xs">
                <span>上游真实成本</span>
                <TrendingDown className="h-4 w-4 text-amber-500" />
              </div>
              <div className="text-xl font-bold font-mono text-foreground">
                ${calcResult.totalCostUsd.toFixed(2)}
                <span className="text-xs text-muted-foreground font-normal ml-1">USD</span>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                折合积分: ~{Math.round(calcResult.estimatedTotalCredits).toLocaleString()} 分
              </div>
            </div>

            {/* 预估毛利润 */}
            <div
              className={cn(
                'rounded-lg border p-4 space-y-1 shadow-xs transition-all',
                calcResult.totalProfitUsd >= 0
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-destructive/40 bg-destructive/5'
              )}
            >
              <div className="flex items-center justify-between text-xs">
                <span className={calcResult.totalProfitUsd >= 0 ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-destructive font-medium'}>
                  {calcResult.totalProfitUsd >= 0 ? '预估净毛利 (盈利)' : '预估亏损'}
                </span>
                {calcResult.totalProfitUsd >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-destructive" />
                )}
              </div>
              <div
                className={cn(
                  'text-xl font-bold font-mono',
                  calcResult.totalProfitUsd >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-destructive'
                )}
              >
                {calcResult.totalProfitUsd >= 0 ? '+' : ''}
                ${calcResult.totalProfitUsd.toFixed(2)}
                <span className="text-xs text-muted-foreground font-normal ml-1">USD</span>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono">
                每千分净赚: ${(effectiveSellingPrice * 1000 - costPrice * 1000).toFixed(4)}
              </div>
            </div>

            {/* 毛利润率 */}
            <div className="rounded-lg border border-border/60 bg-card p-4 space-y-1 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground text-xs">
                <span>综合利润率</span>
                <Percent className="h-4 w-4 text-primary" />
              </div>
              <div
                className={cn(
                  'text-xl font-bold font-mono',
                  calcResult.profitMargin >= 40
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : calcResult.profitMargin >= 0
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-destructive'
                )}
              >
                {calcResult.profitMargin.toFixed(1)}%
              </div>
              <div className="text-[11px] text-muted-foreground font-mono">
                平均单次收益: ${calcResult.avgRevenuePerRequest.toFixed(4)}
              </div>
            </div>
          </div>

          {/* 3. 各模型用量明细分布表 */}
          {calcResult.modelBreakdowns && calcResult.modelBreakdowns.length > 0 && (
            <div className="rounded-lg border border-border/60 bg-card overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-border/50 flex flex-wrap items-center justify-between gap-2 bg-muted/20">
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold text-foreground">各模型用量分布与盈亏核算</span>
                  <Badge variant="secondary" className="text-[10px]">
                    共 {calcResult.modelBreakdowns.length} 款模型
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  (已基于采样样本进行精准权重还原)
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-muted/40 text-[11px] text-muted-foreground border-b border-border/40 font-sans">
                    <tr>
                      <th className="px-3.5 py-2.5 font-medium">模型名称</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">调用次数</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">输入 / 输出 Tokens</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">缓存读取</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">消耗配额</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">下游实收</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">上游成本</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">预估毛利</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">利润率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {calcResult.modelBreakdowns.map((m) => (
                      <tr key={m.modelName} className="hover:bg-muted/30 transition-colors">
                        <td className="px-3.5 py-2.5 font-medium text-foreground truncate max-w-[200px]">
                          {m.modelName}
                        </td>
                        <td className="px-3.5 py-2.5 text-right text-muted-foreground">
                          {m.requestCount.toLocaleString()}
                        </td>
                        <td className="px-3.5 py-2.5 text-right text-muted-foreground text-[11px]">
                          {m.promptTokens.toLocaleString()} / {m.completionTokens.toLocaleString()}
                        </td>
                        <td className="px-3.5 py-2.5 text-right text-muted-foreground text-[11px]">
                          {m.cacheReadTokens > 0 ? m.cacheReadTokens.toLocaleString() : '-'}
                        </td>
                        <td className="px-3.5 py-2.5 text-right text-muted-foreground">
                          {m.quota.toLocaleString()}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-semibold text-foreground">
                          ${m.revenueUsd.toFixed(2)}
                        </td>
                        <td className="px-3.5 py-2.5 text-right text-muted-foreground">
                          ${m.costUsd.toFixed(2)}
                        </td>
                        <td
                          className={cn(
                            'px-3.5 py-2.5 text-right font-semibold',
                            m.profitUsd >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-destructive'
                          )}
                        >
                          {m.profitUsd >= 0 ? '+' : ''}${m.profitUsd.toFixed(2)}
                        </td>
                        <td
                          className={cn(
                            'px-3.5 py-2.5 text-right font-medium',
                            m.profitMargin >= 40
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : m.profitMargin >= 0
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-destructive'
                          )}
                        >
                          {m.profitMargin.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
