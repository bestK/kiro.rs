import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Coins,
  FolderTree,
  KeyRound,
  Calculator,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Send,
  History,
  Trash2,
  Loader2,
  RotateCcw,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ShieldCheck,
  Check,
  X,
  RefreshCw,
  Search,
  TrendingUp,
  Tag,
  Globe,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  SettingRow,
  SettingGroup,
  SettingSwitch,
  SettingNumber,
  useFieldSaver,
} from '@/components/console/setting-row'
import {
  useTokenByCreditConfig,
  useSetTokenByCreditConfig,
  useBillingVerifications,
  useVerifyDownstreamBilling,
  useClearBillingVerifications,
  useFetchTokenByCreditModels,
} from '@/hooks/use-credentials'
import { reportSaveError } from '@/components/settings/report-error'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { VerifyBillingResponse } from '@/types/api'
import { ProfitCalculator } from '@/components/settings/profit-calculator'
import { BillingRatioSimulator } from '@/components/settings/billing-ratio-simulator'
import { DownstreamNewApiConfigCard } from '@/components/settings/downstream-newapi-config'
import { FloatingSectionNav, type NavSectionItem } from '@/components/console/floating-section-nav'
import { DownstreamRatioBalancer } from '@/components/downstream-ratio-balancer'

const BILLING_NAV_ITEMS: NavSectionItem[] = [
  { id: 'section-billing-global', title: '全局折算设置' },
  { id: 'section-billing-hierarchy', title: '分级覆盖规则' },
  { id: 'section-billing-estimate', title: '换算估算参考与在线验证' },
  { id: 'section-billing-downstream-newapi', title: '下游 NewAPI 关联与盈亏回填' },
  { id: 'section-billing-profit', title: '利润测算与用量盈亏分析' },
  { id: 'section-billing-ratio', title: '下游计费口径与官方倍率模拟' },
]

/**
 * 专属基准价格设置行：支持按「每千分单价 (USD / 千分)」与「单积分价格 (USD / 积分)」两种视角无缝切换与修改。
 */
function BillingCreditPriceRow({
  creditPrice,
  onCommit,
  pending,
  saved,
  disabled,
}: {
  creditPrice: number
  onCommit: (next: number) => void
  pending?: boolean
  saved?: boolean
  disabled?: boolean
}) {
  const [unit, setUnit] = useState<'k' | 'single'>('k')

  const [showBalancer, setShowBalancer] = useState(false)

  const toDisplay = (val: number, u: 'k' | 'single') => {
    return u === 'k' ? +(val * 1000).toFixed(4) : val
  }

  const [draft, setDraft] = useState(() => String(toDisplay(creditPrice, 'k')))
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setDraft(String(toDisplay(creditPrice, unit)))
    setInvalid(false)
  }, [creditPrice, unit])

  const commit = (valStr: string) => {
    const n = Number(valStr)
    const min = unit === 'k' ? 0.0001 : 0.000001
    const max = unit === 'k' ? 100000 : 100
    if (!Number.isFinite(n) || n < min || n > max) {
      setInvalid(true)
      setDraft(String(toDisplay(creditPrice, unit)))
      window.setTimeout(() => setInvalid(false), 1200)
      return
    }
    const perOne = unit === 'k' ? +(n / 1000).toFixed(6) : n
    if (perOne === creditPrice) return
    onCommit(perOne)
  }

  const handlePreset = (p: number) => {
    setDraft(String(p))
    const perOne = unit === 'k' ? +(p / 1000).toFixed(6) : p
    if (perOne !== creditPrice) {
      onCommit(perOne)
    }
  }

  const kPresets = [70, 75, 80, 90, 100, 120, 150]
  const singlePresets = [0.07, 0.075, 0.08, 0.09, 0.1, 0.12, 0.15]
  const presets = unit === 'k' ? kPresets : singlePresets
  const currentDisplayNum = toDisplay(creditPrice, unit)

  return (
    <SettingRow
      label={unit === 'k' ? '基准千分单价' : '基准单积分单价'}
      hint={
        <div className="space-y-1">
          <div>
            {unit === 'k' ? (
              <>
                下游常用的千分计费标准。当前折合{' '}
                <strong className="text-foreground font-mono">
                  ${creditPrice} / 积分
                </strong>
                。例如常用单价 $80 / 千分（即 1 积分 = $0.08）。
              </>
            ) : (
              <>
                下游系统中 1 积分对应的金额价值。当前折合{' '}
                <strong className="text-foreground font-mono">
                  ${+(creditPrice * 1000).toFixed(4)} / 千分
                </strong>
                。例如常用单价 $0.08 / 积分。
              </>
            )}
          </div>
          <div>
            <button
              type="button"
              disabled={disabled || pending}
              onClick={() => setShowBalancer((prev) => !prev)}
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline transition-colors font-medium mt-0.5"
            >
              <Calculator className="h-3.5 w-3.5" />
              <span>下游倍率配平助手</span>
              <span className="text-[10px] text-muted-foreground font-normal">
                (输入期望实收与倍率自动反推)
              </span>
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform duration-200 text-muted-foreground',
                  showBalancer && 'rotate-180 text-primary'
                )}
              />
            </button>
          </div>
        </div>
      }
      pending={pending}
      saved={saved}
    >
      <div className="flex flex-col items-end gap-2 w-full sm:w-auto">
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {/* 单位切换 */}
          <div className="inline-flex h-7 items-center rounded-md border border-border bg-secondary/50 p-0.5">
            <button
              type="button"
              disabled={disabled || pending}
              onClick={() => {
                setUnit('k')
                setDraft(String(toDisplay(creditPrice, 'k')))
              }}
              className={cn(
                'inline-flex h-6 items-center rounded px-2 text-xs font-medium transition-colors',
                unit === 'k'
                  ? 'bg-card text-foreground shadow-xs border border-border/80'
                  : 'text-muted-foreground hover:text-foreground border border-transparent'
              )}
            >
              $/千分 (推荐)
            </button>
            <button
              type="button"
              disabled={disabled || pending}
              onClick={() => {
                setUnit('single')
                setDraft(String(toDisplay(creditPrice, 'single')))
              }}
              className={cn(
                'inline-flex h-6 items-center rounded px-2 text-xs font-medium transition-colors',
                unit === 'single'
                  ? 'bg-card text-foreground shadow-xs border border-border/80'
                  : 'text-muted-foreground hover:text-foreground border border-transparent'
              )}
            >
              $/积分
            </button>
          </div>

          {/* 快捷预设 */}
          <div className="flex items-center gap-1">
            {presets.map((p) => (
              <Button
                key={p}
                type="button"
                size="sm"
                variant={currentDisplayNum === p ? 'default' : 'outline'}
                className="h-7 px-2 text-xs font-mono"
                disabled={disabled || pending}
                onClick={() => handlePreset(p)}
              >
                ${p}
              </Button>
            ))}
          </div>

          {/* 数值输入 */}
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              step="any"
              min={unit === 'k' ? 0.0001 : 0.000001}
              max={unit === 'k' ? 100000 : 100}
              value={draft}
              disabled={disabled || pending}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(draft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  setDraft(String(toDisplay(creditPrice, unit)))
                  e.currentTarget.blur()
                }
              }}
              className={cn(
                'console-num h-8 w-24 text-right text-[13px]',
                invalid && 'border-destructive focus-visible:border-destructive'
              )}
            />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {unit === 'k' ? 'USD / 千分' : 'USD / 积分'}
            </span>
          </div>
        </div>
      </div>

      {showBalancer && (
        <div className="w-full pt-2">
          <DownstreamRatioBalancer
            currentUnit={unit}
            onApply={(singlePrice, kPrice) => {
              if (unit === 'k') {
                setDraft(String(kPrice))
              } else {
                setDraft(String(singlePrice))
              }
              onCommit(singlePrice)
              toast.success(`已应用全局基准单价: $${kPrice}/千分 ($${singlePrice}/积分)`)
            }}
          />
        </div>
      )}
    </SettingRow>
  )
}

/**
 * 官方价格数据源设置行：支持自定义修改 API 地址并一键重置为默认值。
 */
function ModelsDevUrlRow({
  url,
  onCommit,
  pending,
  saved,
  disabled,
}: {
  url: string
  onCommit: (next: string) => void
  pending?: boolean
  saved?: boolean
  disabled?: boolean
}) {
  const DEFAULT_URL = 'https://models.dev/api.json'
  const [draft, setDraft] = useState(url)

  useEffect(() => {
    setDraft(url)
  }, [url])

  return (
    <SettingRow
      label="官方价格数据源"
      hint="Kiro 自动拉取 Claude、GPT 等模型权威官方价格的数据接口。可配置镜像源或反向代理，修改后自动触发后台拉取刷新。"
      pending={pending}
      saved={saved}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          value={draft}
          disabled={disabled || pending}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={DEFAULT_URL}
          className="h-8 w-64 md:w-80 text-xs font-mono"
        />
        {draft.trim() !== url && (
          <Button
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={disabled || pending || !draft.trim()}
            onClick={() => onCommit(draft.trim())}
          >
            保存修改
          </Button>
        )}
        {url !== DEFAULT_URL && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1"
            disabled={disabled || pending}
            onClick={() => {
              setDraft(DEFAULT_URL)
              onCommit(DEFAULT_URL)
            }}
          >
            <RotateCcw className="h-3 w-3" />
            重置默认
          </Button>
        )}
      </div>
    </SettingRow>
  )
}

/**
 * 下游价格对齐实时验证工具与历史记录组件
 */
function DownstreamVerifier({
  currentCreditPrice,
  isCustomPrice = false,
  onResetPrice,
}: {
  currentCreditPrice: number
  isCustomPrice?: boolean
  onResetPrice?: () => void
}) {
  const [baseUrl, setBaseUrl] = useState(() => {
    return localStorage.getItem('kiro_verify_downstream_url') || ''
  })
  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem('kiro_verify_downstream_key') || ''
  })
  const [model, setModel] = useState(() => {
    return localStorage.getItem('kiro_verify_downstream_model') || 'claude-3-7-sonnet-20250219'
  })
  const [prompt, setPrompt] = useState(() => {
    return localStorage.getItem('kiro_verify_downstream_prompt') || '请回复数字 1'
  })
  const [showKey, setShowKey] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [lastResult, setLastResult] = useState<VerifyBillingResponse | null>(null)

  const [modelList, setModelList] = useState<string[]>([])
  const [modelSource, setModelSource] = useState<'downstream' | 'local' | null>(null)
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const modelDropdownRef = useRef<HTMLDivElement>(null)

  const verifyMutation = useVerifyDownstreamBilling()
  const clearMutation = useClearBillingVerifications()
  const fetchModelsMutation = useFetchTokenByCreditModels()
  const isFetchingModels = fetchModelsMutation.isPending
  const { data: verifications = [] } = useBillingVerifications()

  const handleFetchModels = async (showToast = true) => {
    const cleanUrl = baseUrl.trim()
    const cleanKey = apiKey.trim()
    try {
      const res = await fetchModelsMutation.mutateAsync({
        baseUrl: cleanUrl || undefined,
        apiKey: cleanKey || undefined,
      })
      if (res.models && res.models.length > 0) {
        setModelList(res.models)
        setModelSource(res.source)
        if (showToast) {
          if (res.source === 'downstream') {
            toast.success(`成功从下游 /v1/models 获取到 ${res.models.length} 个可用模型`)
          } else {
            toast.success(`已从本地 /v1/models 加载 ${res.models.length} 个可用模型`)
          }
        }
      } else if (showToast) {
        toast.error(res.error || '未获取到有效模型')
      }
    } catch (err: any) {
      if (showToast) {
        toast.error('拉取模型失败: ' + (err?.message || String(err)))
      }
    }
  }

  // 初始加载本地模型
  useEffect(() => {
    handleFetchModels(false)
  }, [])

  // 点击外部关闭模型下拉菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(event.target as Node)
      ) {
        setIsModelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredModels = useMemo(() => {
    const q = model.trim().toLowerCase()
    if (!q) return modelList
    return modelList.filter((m) => m.toLowerCase().includes(q))
  }, [modelList, model])

  const handleVerify = async () => {
    const cleanUrl = baseUrl.trim()
    const cleanKey = apiKey.trim()
    if (!cleanUrl) {
      toast.error('请输入下游地址 (Base URL)')
      return
    }
    if (!cleanKey) {
      toast.error('请输入下游 API Key')
      return
    }

    localStorage.setItem('kiro_verify_downstream_url', cleanUrl)
    localStorage.setItem('kiro_verify_downstream_key', cleanKey)
    localStorage.setItem('kiro_verify_downstream_model', model.trim())
    localStorage.setItem('kiro_verify_downstream_prompt', prompt.trim())

    try {
      const res = await verifyMutation.mutateAsync({
        baseUrl: cleanUrl,
        apiKey: cleanKey,
        model: model.trim() || 'claude-3-7-sonnet-20250219',
        prompt: prompt.trim() || '请回复数字 1',
        creditPrice: currentCreditPrice,
      })
      setLastResult(res)
      if (res.success) {
        toast.success(`验证成功！下游计费核算金额：$${res.calculatedCostUsd.toFixed(6)}`)
      } else {
        toast.error(`下游返回异常 (HTTP ${res.status}): ${res.error || '未知错误'}`)
      }
    } catch (err: any) {
      toast.error('验证请求发起失败: ' + (err?.message || String(err)))
    }
  }

  const handleClearHistory = async () => {
    if (confirm('确定要清空所有计费验证历史记录吗？')) {
      await clearMutation.mutateAsync()
      toast.success('历史记录已清空')
    }
  }

  return (
    <div className="space-y-4 pt-3">
      {/* 验证配置面板 */}
      <div className="rounded-lg border border-border/60 bg-card p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h4 className="text-xs font-semibold text-foreground">在线发起价格对齐验证</h4>
            <Badge variant="outline" className="text-[10px] font-mono">
              /v1/messages 测试
            </Badge>
          </div>
          <span className="text-[11px] text-muted-foreground">
            向下游系统发起最小化测试请求，校验 Token 折算与实际计费金额对齐情况
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground">下游地址 (Base URL)</label>
            <Input
              placeholder="https://your-domain.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-foreground">下游 API 密钥 (API Key)</label>
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
            <Input
              type={showKey ? 'text' : 'password'}
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="space-y-1" ref={modelDropdownRef}>
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
                <span>测试模型 (Model)</span>
                {modelList.length > 0 && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal">
                    {modelSource === 'downstream' ? '下游' : '本地'} ({modelList.length})
                  </Badge>
                )}
              </label>
              <button
                type="button"
                onClick={() => handleFetchModels(true)}
                disabled={isFetchingModels}
                className="text-[11px] text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCw className={cn("h-3 w-3", isFetchingModels && "animate-spin")} />
                {isFetchingModels ? '拉取中...' : baseUrl.trim() ? '拉取下游 /v1/models' : '拉取本地模型'}
              </button>
            </div>

            <div className="relative">
              <Input
                value={model}
                onChange={(e) => {
                  setModel(e.target.value)
                  setIsModelDropdownOpen(true)
                }}
                onFocus={() => setIsModelDropdownOpen(true)}
                placeholder="选择或输入模型，如 claude-3-7-sonnet-20250219"
                className="h-8 text-xs font-mono pr-14"
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                {model && (
                  <button
                    type="button"
                    onClick={() => {
                      setModel('')
                      setIsModelDropdownOpen(true)
                    }}
                    className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                    title="清空输入"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                  title={isModelDropdownOpen ? '收起下拉列表' : '展开模型列表'}
                >
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 transition-transform duration-200',
                      isModelDropdownOpen && 'rotate-180'
                    )}
                  />
                </button>
              </div>

              {/* 下拉选择与过滤浮层 */}
              {isModelDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border/80 bg-popover text-popover-foreground shadow-xl overflow-hidden animate-in fade-in-0 zoom-in-95">
                  <div className="px-2.5 py-1.5 border-b border-border/50 text-[11px] text-muted-foreground flex items-center justify-between bg-muted/40">
                    <span className="flex items-center gap-1">
                      <Search className="h-3 w-3" />
                      <span>
                        匹配 {filteredModels.length} / 共 {modelList.length} 个模型
                      </span>
                    </span>
                    <span className="text-[10px]">
                      {modelSource === 'downstream' ? '来源：下游 /v1/models' : '来源：本地聚合'}
                    </span>
                  </div>

                  <div className="max-h-56 overflow-y-auto p-1 space-y-0.5 font-mono text-xs">
                    {/* 若输入了列表外的新模型，支持直接快捷确认 */}
                    {model.trim() && !modelList.includes(model.trim()) && (
                      <div
                        onClick={() => setIsModelDropdownOpen(false)}
                        className="px-2 py-1.5 rounded cursor-pointer text-xs flex items-center justify-between text-primary bg-primary/10 hover:bg-primary/20 border border-primary/25 transition-colors"
                      >
                        <span className="truncate">
                          使用自定义模型: <strong>{model.trim()}</strong>
                        </span>
                        <Badge variant="outline" className="text-[9px] px-1 shrink-0 ml-1">
                          自定义
                        </Badge>
                      </div>
                    )}

                    {isFetchingModels ? (
                      <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2 font-sans">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        <span>正在拉取 /v1/models 模型列表...</span>
                      </div>
                    ) : filteredModels.length === 0 ? (
                      <div className="p-3 text-center text-xs text-muted-foreground font-sans">
                        未匹配到模型，已支持直接保留当前输入值作为自定义模型
                      </div>
                    ) : (
                      filteredModels.map((m) => {
                        const isSelected = m === model.trim()
                        return (
                          <div
                            key={m}
                            onClick={() => {
                              setModel(m)
                              setIsModelDropdownOpen(false)
                            }}
                            className={cn(
                              'px-2 py-1.5 rounded cursor-pointer text-xs flex items-center justify-between transition-colors',
                              isSelected
                                ? 'bg-primary text-primary-foreground font-medium'
                                : 'hover:bg-accent hover:text-accent-foreground text-foreground'
                            )}
                          >
                            <span className="truncate">{m}</span>
                            {isSelected && <Check className="h-3.5 w-3.5 shrink-0 ml-1.5" />}
                          </div>
                        )
                      })
                    )}
                  </div>

                  <div className="px-2.5 py-1.5 border-t border-border/50 text-[10px] text-muted-foreground flex items-center justify-between bg-muted/20 font-sans">
                    <span>支持输入关键词过滤或自定义</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleFetchModels(true)
                      }}
                      className="text-primary hover:underline flex items-center gap-1"
                    >
                      <RefreshCw className="h-2.5 w-2.5" />
                      重新拉取
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground">测试消息 (Prompt)</label>
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="请回复数字 1"
              className="h-8 text-xs"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <span>验证核算参考单价：</span>
            <strong className="text-foreground font-mono">
              ${+(currentCreditPrice * 1000).toFixed(4)}/千分 (${currentCreditPrice}/分)
            </strong>
            {isCustomPrice ? (
              <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10">
                自定义试算
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[9px] px-1 py-0">
                表单默认
              </Badge>
            )}
            {isCustomPrice && onResetPrice && (
              <button
                type="button"
                onClick={onResetPrice}
                className="text-primary hover:underline text-[10px] ml-1 flex items-center gap-0.5"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                重置为表单
              </button>
            )}
          </div>
          <Button
            size="sm"
            onClick={handleVerify}
            disabled={verifyMutation.isPending}
            className="h-8 px-4 text-xs gap-1.5"
          >
            {verifyMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在发起下游请求...
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                发起在线验证
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 最近一次验证结果 */}
      {lastResult && (
        <div
          className={cn(
            'rounded-lg border p-4 space-y-3 transition-all',
            lastResult.success
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-destructive/40 bg-destructive/5'
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {lastResult.success ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="text-xs font-semibold text-foreground">
                {lastResult.success ? '验证测试成功' : '下游响应异常'}
              </span>
              <Badge
                variant={lastResult.success ? 'outline' : 'destructive'}
                className={cn(
                  'text-[10px] font-mono',
                  lastResult.success && 'border-emerald-500/40 text-emerald-600'
                )}
              >
                HTTP {lastResult.status}
              </Badge>
              <span className="text-[11px] text-muted-foreground font-mono">
                耗时 {lastResult.durationMs}ms
              </span>
            </div>

            {lastResult.rawResponse && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1"
                onClick={() => setShowRaw(!showRaw)}
              >
                {showRaw ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showRaw ? '收起响应' : '查看原始响应'}
              </Button>
            )}
          </div>

          {lastResult.error && (
            <div className="rounded bg-destructive/10 p-2.5 text-xs text-destructive font-mono">
              {lastResult.error}
            </div>
          )}

          {lastResult.success && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              <div className="rounded-md border border-border/50 bg-background/60 p-2.5 space-y-1">
                <span className="text-[11px] text-muted-foreground">常规输入 Token</span>
                <div className="font-mono text-sm font-semibold text-foreground">
                  {lastResult.inputTokens.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  ${lastResult.modelInputPrice}/M
                </div>
              </div>

              <div className="rounded-md border border-border/50 bg-background/60 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">模拟缓存 Token</span>
                  {lastResult.cacheReadTokens > 0 && (
                    <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-600 bg-emerald-500/10 px-1 py-0">
                      模拟命中
                    </Badge>
                  )}
                </div>
                <div className="font-mono text-sm font-semibold text-foreground">
                  {lastResult.cacheReadTokens.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  ${+(lastResult.modelInputPrice * 0.1).toFixed(4)}/M (0.1x)
                </div>
              </div>

              <div className="rounded-md border border-border/50 bg-background/60 p-2.5 space-y-1">
                <span className="text-[11px] text-muted-foreground">输出 Token</span>
                <div className="font-mono text-sm font-semibold text-foreground">
                  {lastResult.outputTokens.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  ${lastResult.modelOutputPrice}/M
                </div>
              </div>

              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                    下游扣费金额
                  </span>
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                </div>
                <div className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  ${lastResult.calculatedCostUsd.toFixed(6)}
                </div>
                <div className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80 font-mono">
                  ~{lastResult.estimatedQuota.toLocaleString()} Quota ({lastResult.estimatedCredits.toFixed(4)} 分)
                </div>
              </div>
            </div>
          )}

          {showRaw && lastResult.rawResponse && (
            <div className="mt-2 rounded bg-muted/60 p-2.5 overflow-x-auto text-[11px] font-mono leading-relaxed border border-border/50">
              <pre>{lastResult.rawResponse}</pre>
            </div>
          )}
        </div>
      )}

      {/* 验证历史列表 */}
      <div className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-xs font-semibold text-foreground">验证历史记录</h4>
            <Badge variant="secondary" className="text-[10px]">
              {verifications.length} 条记录
            </Badge>
          </div>
          {verifications.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={clearMutation.isPending}
              onClick={handleClearHistory}
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive gap-1"
            >
              <Trash2 className="h-3 w-3" />
              清空历史
            </Button>
          )}
        </div>

        {verifications.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            暂无验证历史。输入下游地址与 API Key 后，点击上方「发起在线验证」即可测试。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground text-[11px]">
                  <th className="pb-2 font-medium">时间</th>
                  <th className="pb-2 font-medium">下游地址 / 模型</th>
                  <th className="pb-2 font-medium text-right">耗时</th>
                  <th className="pb-2 font-medium text-right">输入 / 缓存 / 输出</th>
                  <th className="pb-2 font-medium text-right">折算扣费</th>
                  <th className="pb-2 font-medium text-right">对应配额</th>
                  <th className="pb-2 font-medium text-center">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-mono">
                {verifications.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                      {item.createdAt.slice(11, 19)}
                    </td>
                    <td className="py-2 pr-2">
                      <div className="text-[11px] font-medium text-foreground truncate max-w-[180px]" title={item.baseUrl}>
                        {item.baseUrl.replace(/^https?:\/\//, '')}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[180px]" title={item.model}>
                        {item.model}
                      </div>
                    </td>
                    <td className="py-2 text-right text-[11px] text-muted-foreground whitespace-nowrap">
                      {item.durationMs}ms
                    </td>
                    <td className="py-2 text-right text-[11px] whitespace-nowrap">
                      <span className="text-foreground">{item.inputTokens}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className={item.cacheReadTokens > 0 ? 'text-emerald-600 font-semibold' : 'text-muted-foreground'}>
                        {item.cacheReadTokens}
                      </span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-foreground">{item.outputTokens}</span>
                    </td>
                    <td className="py-2 text-right text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold whitespace-nowrap">
                      ${item.calculatedCostUsd.toFixed(6)}
                    </td>
                    <td className="py-2 text-right text-[11px] text-muted-foreground whitespace-nowrap">
                      ~{item.estimatedQuota.toLocaleString()} Quota
                    </td>
                    <td className="py-2 text-center whitespace-nowrap">
                      {item.success ? (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 bg-emerald-500/10 text-[10px] px-1.5 py-0">
                          对齐
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0" title={item.error}>
                          异常
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export function BillingSection() {
  const { data: tokenByCredit, isLoading } = useTokenByCreditConfig()
  const { mutate } = useSetTokenByCreditConfig()
  const saver = useFieldSaver(mutate, reportSaveError)

  const enabled = tokenByCredit?.enabled ?? false
  const creditPrice = tokenByCredit?.creditPrice ?? 0.002
  const pricingRefreshHours = tokenByCredit?.pricingRefreshHours ?? 24
  const modelsDevUrl = tokenByCredit?.modelsDevUrl || 'https://models.dev/api.json'
  const simulatedCacheEnabled = tokenByCredit?.simulatedCacheEnabled ?? false
  const simulatedCacheRatio = tokenByCredit?.simulatedCacheRatio ?? 0.8

  // 假设基准单价与单位（默认读取当前表单配置，可自由修改试算）
  const [hypoUnit, setHypoUnit] = useState<'k' | 'single'>('k')
  const [hypoPriceCustom, setHypoPriceCustom] = useState<number | null>(null)

  // 当前生效的假设单积分价格（USD / 积分）
  const effectiveCreditPrice = hypoPriceCustom !== null ? hypoPriceCustom : creditPrice

  // 转换为当前选定单位的显示数值
  const hypoDisplayPrice =
    hypoUnit === 'k' ? +(effectiveCreditPrice * 1000).toFixed(4) : effectiveCreditPrice
  const [hypoPriceInput, setHypoPriceInput] = useState<string>(() => String(hypoDisplayPrice))

  // 当表单真实单价或单位变化且用户未做自定义修改时，自动同步表单配置
  useEffect(() => {
    if (hypoPriceCustom === null) {
      setHypoPriceInput(String(hypoUnit === 'k' ? +(creditPrice * 1000).toFixed(4) : creditPrice))
    }
  }, [creditPrice, hypoUnit, hypoPriceCustom])

  const handleHypoUnitChange = (newUnit: 'k' | 'single') => {
    if (newUnit === hypoUnit) return
    setHypoUnit(newUnit)
    const curPerOne = effectiveCreditPrice
    const newDisplay = newUnit === 'k' ? +(curPerOne * 1000).toFixed(4) : curPerOne
    setHypoPriceInput(String(newDisplay))
  }

  const handleHypoPriceChange = (valStr: string) => {
    setHypoPriceInput(valStr)
    const num = Number(valStr)
    if (Number.isFinite(num) && num > 0) {
      const perOne = hypoUnit === 'k' ? +(num / 1000).toFixed(6) : num
      setHypoPriceCustom(perOne)
    }
  }

  const handleResetHypoPrice = () => {
    setHypoPriceCustom(null)
    setHypoPriceInput(String(hypoUnit === 'k' ? +(creditPrice * 1000).toFixed(4) : creditPrice))
  }

  const handleHypoPreset = (val: number) => {
    setHypoPriceInput(String(val))
    const perOne = hypoUnit === 'k' ? +(val / 1000).toFixed(6) : val
    setHypoPriceCustom(perOne)
  }

  // 简易计算器消耗用量输入
  const [calcUnit, setCalcUnit] = useState<'credit' | 'k'>('credit')
  const [testAmount, setTestAmount] = useState('0.0276')

  const parsedAmount = Number(testAmount)
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0
  const numCredits = calcUnit === 'k' ? validAmount * 1000 : validAmount
  const costUsd = numCredits * effectiveCreditPrice
  const quota = Math.round(costUsd * 500000)

  return (
    <div className="space-y-6">
      {/* 页面右侧固定模块目录导航 (默认横线，悬浮显示模块名称) */}
      <FloatingSectionNav items={BILLING_NAV_ITEMS} />

      {/* 顶部概念说明横幅 */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Coins className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                按积分折算用量 (固定积分反向计费)
              </h3>
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px]">
                下游路由对齐
              </Badge>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              专为对接 New API、One API 等下游平台设计。行业通常按<strong className="text-foreground">每千分价格</strong>（如 $2.00 / 千分，折合 1 积分 = $0.002）进行成本核算。Kiro 根据 models.dev 官方模型单价，将实际消耗逆向折算为等价 Token 数返回。下游系统由此计算出的扣费正好等于预设积分价值，免去在下游为各模型配置复杂倍率。
            </p>
          </div>
        </div>
      </div>

      {/* 全局折算配置卡片 */}
      <SettingGroup
        id="section-billing-global"
        title="全局折算设置"
        description="控制整个实例默认的计费折算规则。当分组或客户端 Key 未单独指定时，自动沿用此处的全局基准。"
        icon={<Coins className="h-4 w-4" />}
        badge={
          <Badge variant={enabled ? 'success' : 'secondary'} className="text-[11px]">
            {enabled ? '全局已启用' : '全局已关闭'}
          </Badge>
        }
      >
        <SettingSwitch
          label="启用全局用量折算"
          hint={
            enabled
              ? '已开启：所有未单独覆盖的分组与 Key，在向客户端返回用量时均按积分对齐折算 Token'
              : '已关闭：默认如实返回上游模型产生的实际 Token 数量（亦可在特定分组或 Key 中单独开启）'
          }
          checked={enabled}
          onChange={(next) => saver.save('enabled', { enabled: next })}
          pending={saver.isSaving('enabled')}
          saved={saver.isSaved('enabled')}
          disabled={isLoading}
        />
        <BillingCreditPriceRow
          creditPrice={creditPrice}
          onCommit={(next) => saver.save('creditPrice', { creditPrice: next })}
          pending={saver.isSaving('creditPrice')}
          saved={saver.isSaved('creditPrice')}
          disabled={isLoading}
        />
        <SettingSwitch
          label="模拟 Prompt 缓存"
          hint="开启后，折算出的输入 Token 会按比例拆分为常规输入与缓存读取 (cache_read_input_tokens)。下游通常按 0.1x 缓存价格扣费，算法严格保证拆分后下游计费总额绝对恒等（0 误差），下游展示账单有缓存命中更美观自然。"
          checked={simulatedCacheEnabled}
          onChange={(next) => saver.save('simulatedCacheEnabled', { simulatedCacheEnabled: next })}
          pending={saver.isSaving('simulatedCacheEnabled')}
          saved={saver.isSaved('simulatedCacheEnabled')}
          disabled={isLoading}
        />
        {simulatedCacheEnabled && (
          <SettingNumber
            label="模拟缓存命中率"
            hint="折算输入 Token 时模拟被缓存命中的比例（默认 80%）。剩余 20% 为普通输入 Token。下游计算总扣费严格与无缓存时恒等。"
            value={Math.round(simulatedCacheRatio * 100)}
            min={10}
            max={95}
            unit="%"
            presets={[50, 70, 80, 90]}
            onCommit={(next) => saver.save('simulatedCacheRatio', { simulatedCacheRatio: next / 100 })}
            pending={saver.isSaving('simulatedCacheRatio')}
            saved={saver.isSaved('simulatedCacheRatio')}
            disabled={isLoading}
          />
        )}
        <SettingNumber
          label="官方单价同步周期"
          hint="从 models.dev 自动拉取 Claude、GPT 等模型最新官方价格的定时刷新频率。"
          value={pricingRefreshHours}
          min={1}
          max={720}
          unit="小时"
          presets={[1, 6, 12, 24, 72]}
          onCommit={(next) => saver.save('pricingRefreshHours', { pricingRefreshHours: next })}
          pending={saver.isSaving('pricingRefreshHours')}
          saved={saver.isSaved('pricingRefreshHours')}
          disabled={isLoading}
        />
        <ModelsDevUrlRow
          url={modelsDevUrl}
          onCommit={(next) => saver.save('modelsDevUrl', { modelsDevUrl: next })}
          pending={saver.isSaving('modelsDevUrl')}
          saved={saver.isSaved('modelsDevUrl')}
          disabled={isLoading}
        />
      </SettingGroup>

      {/* 分级生效与管理覆盖 */}
      <SettingGroup
        id="section-billing-hierarchy"
        title="分级覆盖规则"
        description="折算设置支持多级覆盖，越靠近调用端优先级越高，满足不同分组或客户的差异化计费需求。"
        icon={<FolderTree className="h-4 w-4" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 py-2">
          <div className="rounded-lg border border-border/60 bg-card p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">1. 客户端 Key</span>
              <Badge variant="outline" className="text-[10px]">最高优先级</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              在客户端 Key 中显式指定「开启」或「关闭」时，该 Key 强制执行自身设定，忽略分组与全局。
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1 text-primary hover:text-primary"
              onClick={() => { window.location.hash = '#keys' }}
            >
              <KeyRound className="h-3 w-3" />
              前往客户端 Key
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>

          <div className="rounded-lg border border-border/60 bg-card p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">2. 分组设置</span>
              <Badge variant="outline" className="text-[10px]">中等优先级</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              若 Key 设为「继承」，则沿用所绑定分组的独立配置（可为特定客户组设置不同的积分单价）。
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1 text-primary hover:text-primary"
              onClick={() => { window.location.hash = '#groups' }}
            >
              <FolderTree className="h-3 w-3" />
              前往分组管理
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>

          <div className="rounded-lg border border-border/60 bg-card p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">3. 全局基准</span>
              <Badge variant="secondary" className="text-[10px]">兜底生效</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              当 Key 与分组均设为「继承 / 跟随全局」时，直接以本页面的全局开关与基准单价为准。
            </p>
            <div className="pt-2 text-[11px] text-muted-foreground font-mono">
              当前全局基准：{enabled ? `已启用 ($${+(creditPrice * 1000).toFixed(4)}/千分 · $${creditPrice}/分)` : '未启用'}
            </div>
          </div>
        </div>
      </SettingGroup>

      {/* 实时折算效果估算与在线验证 */}
      <SettingGroup
        id="section-billing-estimate"
        title="换算估算参考与在线验证"
        description="按当前设定的单价预览不同用量折算配额，或直接向下游地址发起请求进行在线价格与 Token 对齐验证。"
        icon={<Calculator className="h-4 w-4" />}
      >
        <div className="space-y-4 py-2">
          {/* 假设计算参数配置卡片 (包含假设单价与假设消耗，默认读取表单配置，可自由修改) */}
          <div className="rounded-lg border border-border/60 bg-muted/25 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Calculator className="h-3.5 w-3.5 text-primary" />
                <span>假设参考设定 (实时计算下方估算配额与驱动在线验证)</span>
              </div>
              {hypoPriceCustom !== null ? (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10">
                    当前处于自定义试算单价
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] text-primary hover:text-primary gap-1"
                    onClick={handleResetHypoPrice}
                  >
                    <RotateCcw className="h-3 w-3" />
                    恢复表单配置 (${+(creditPrice * 1000).toFixed(4)}/千分)
                  </Button>
                </div>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  默认已读取表单配置 (${+(creditPrice * 1000).toFixed(4)}/千分)
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
              {/* 1. 假设单价与单位控制 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-foreground flex items-center gap-1">
                    <span>假设计算单价</span>
                    <span className="text-[10px] text-muted-foreground font-normal">
                      ({hypoUnit === 'k' ? '每千分价格' : '单积分价格'})
                    </span>
                  </label>
                  <div className="inline-flex h-6 items-center rounded-md border border-border bg-secondary/50 p-0.5">
                    <button
                      type="button"
                      onClick={() => handleHypoUnitChange('k')}
                      className={cn(
                        'inline-flex h-5 items-center rounded px-2 text-[11px] font-medium transition-colors',
                        hypoUnit === 'k'
                          ? 'bg-card text-foreground shadow-xs border border-border/80'
                          : 'text-muted-foreground hover:text-foreground border border-transparent'
                      )}
                    >
                      千分 ($/千分)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleHypoUnitChange('single')}
                      className={cn(
                        'inline-flex h-5 items-center rounded px-2 text-[11px] font-medium transition-colors',
                        hypoUnit === 'single'
                          ? 'bg-card text-foreground shadow-xs border border-border/80'
                          : 'text-muted-foreground hover:text-foreground border border-transparent'
                      )}
                    >
                      单分 ($/积分)
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">$</span>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={hypoPriceInput}
                      onChange={(e) => handleHypoPriceChange(e.target.value)}
                      placeholder={hypoUnit === 'k' ? '80.00' : '0.08'}
                      className="h-8 pl-6 text-xs font-mono"
                    />
                  </div>
                  {/* 快捷预设单价按钮 */}
                  <div className="flex items-center gap-1 shrink-0">
                    {hypoUnit === 'k' ? (
                      [70, 75, 80, 90, 100, 120, 150].map((p) => (
                        <Button
                          key={p}
                          type="button"
                          size="sm"
                          variant="outline"
                          className={cn(
                            'h-8 px-1.5 text-[11px] font-mono',
                            effectiveCreditPrice === p / 1000 && 'border-primary text-primary font-semibold'
                          )}
                          onClick={() => handleHypoPreset(p)}
                        >
                          ${p}
                        </Button>
                      ))
                    ) : (
                      [0.07, 0.075, 0.08, 0.09, 0.1, 0.12, 0.15].map((p) => (
                        <Button
                          key={p}
                          type="button"
                          size="sm"
                          variant="outline"
                          className={cn(
                            'h-8 px-1.5 text-[10px] font-mono',
                            effectiveCreditPrice === p && 'border-primary text-primary font-semibold'
                          )}
                          onClick={() => handleHypoPreset(p)}
                        >
                          ${p}
                        </Button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* 2. 假设实际消耗与单位控制 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-foreground flex items-center gap-1">
                    <span>假设实际消耗</span>
                    <span className="text-[10px] text-muted-foreground font-normal">
                      ({calcUnit === 'credit' ? '积分' : '千分'})
                    </span>
                  </label>
                  <div className="inline-flex h-6 items-center rounded-md border border-border bg-secondary/50 p-0.5">
                    <button
                      type="button"
                      onClick={() => setCalcUnit('credit')}
                      className={cn(
                        'inline-flex h-5 items-center rounded px-2 text-[11px] font-medium transition-colors',
                        calcUnit === 'credit'
                          ? 'bg-card text-foreground shadow-xs border border-border/80'
                          : 'text-muted-foreground hover:text-foreground border border-transparent'
                      )}
                    >
                      积分
                    </button>
                    <button
                      type="button"
                      onClick={() => setCalcUnit('k')}
                      className={cn(
                        'inline-flex h-5 items-center rounded px-2 text-[11px] font-medium transition-colors',
                        calcUnit === 'k'
                          ? 'bg-card text-foreground shadow-xs border border-border/80'
                          : 'text-muted-foreground hover:text-foreground border border-transparent'
                      )}
                    >
                      千分
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={testAmount}
                    onChange={(e) => setTestAmount(e.target.value)}
                    className="h-8 text-xs font-mono flex-1"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-[11px] font-mono"
                      onClick={() => { setCalcUnit('credit'); setTestAmount('0.0276') }}
                    >
                      0.0276分
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-[11px] font-mono"
                      onClick={() => { setCalcUnit('credit'); setTestAmount('1') }}
                    >
                      1分
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-[11px] font-mono"
                      onClick={() => { setCalcUnit('k'); setTestAmount('1') }}
                    >
                      1千分
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 估算综合统计行 */}
          <div className="flex flex-wrap items-center gap-4 rounded-lg bg-muted/40 p-3 text-xs border border-border/40">
            <div>
              <span className="text-muted-foreground">折合金额：</span>
              <strong className="text-foreground font-mono text-sm">${costUsd.toFixed(6)}</strong>
              <span className="text-[11px] text-muted-foreground ml-1">USD</span>
            </div>
            <div className="h-3 w-px bg-border" />
            <div>
              <span className="text-muted-foreground">New API 配额扣减：</span>
              <strong className="text-foreground font-mono text-sm">~{quota.toLocaleString()}</strong>
              <span className="text-[11px] text-muted-foreground ml-1">Quota</span>
            </div>
            <div className="h-3 w-px bg-border" />
            <div>
              <span className="text-muted-foreground">当前核算基准：</span>
              <span className="font-mono text-foreground font-medium">
                ${+(effectiveCreditPrice * 1000).toFixed(4)} / 千分
              </span>
              <span className="text-[11px] text-muted-foreground font-mono ml-1">
                (${effectiveCreditPrice} / 积分)
              </span>
            </div>
          </div>

          {/* 模型 Token 换算卡片网格 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            <div className="rounded-md border border-border/50 bg-background/50 p-3 text-xs space-y-1">
              <div className="font-medium text-foreground flex items-center justify-between">
                <span>Claude 3.7 Sonnet</span>
                <Badge variant="outline" className="text-[10px] font-mono">$3 / $15</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground">官方定价：输入 $3/M · 输出 $15/M</div>
              <div className="pt-1.5 space-y-0.5 text-[11px] font-mono">
                <div className="text-emerald-600 dark:text-emerald-400">
                  纯输出返回：约 {Math.round((costUsd / 15) * 1_000_000).toLocaleString()} tokens
                </div>
                <div className="text-muted-foreground">
                  纯输入返回：约 {Math.round((costUsd / 3) * 1_000_000).toLocaleString()} tokens
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border/50 bg-background/50 p-3 text-xs space-y-1">
              <div className="font-medium text-foreground flex items-center justify-between">
                <span>Claude 3.5 Haiku</span>
                <Badge variant="outline" className="text-[10px] font-mono">$0.8 / $4</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground">官方定价：输入 $0.8/M · 输出 $4/M</div>
              <div className="pt-1.5 space-y-0.5 text-[11px] font-mono">
                <div className="text-emerald-600 dark:text-emerald-400">
                  纯输出返回：约 {Math.round((costUsd / 4) * 1_000_000).toLocaleString()} tokens
                </div>
                <div className="text-muted-foreground">
                  纯输入返回：约 {Math.round((costUsd / 0.8) * 1_000_000).toLocaleString()} tokens
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border/50 bg-background/50 p-3 text-xs space-y-1">
              <div className="font-medium text-foreground flex items-center justify-between">
                <span>GPT-4o</span>
                <Badge variant="outline" className="text-[10px] font-mono">$2.5 / $10</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground">官方定价：输入 $2.5/M · 输出 $10/M</div>
              <div className="pt-1.5 space-y-0.5 text-[11px] font-mono">
                <div className="text-emerald-600 dark:text-emerald-400">
                  纯输出返回：约 {Math.round((costUsd / 10) * 1_000_000).toLocaleString()} tokens
                </div>
                <div className="text-muted-foreground">
                  纯输入返回：约 {Math.round((costUsd / 2.5) * 1_000_000).toLocaleString()} tokens
                </div>
              </div>
            </div>
          </div>

          {/* 下游价格对齐实时验证工具 */}
          <div className="pt-2 border-t border-border/40">
            <DownstreamVerifier
              currentCreditPrice={effectiveCreditPrice}
              isCustomPrice={hypoPriceCustom !== null}
              onResetPrice={handleResetHypoPrice}
            />
          </div>
        </div>
      </SettingGroup>

      {/* 下游 NewAPI 关联与链路日志盈亏 */}
      <SettingGroup
        id="section-billing-downstream-newapi"
        title="下游 NewAPI 关联与链路日志盈亏"
        description="配置下游 NewAPI 的 Base URL 与管理员 Key，通过 upstream_request_id (Trace ID) 自动查询下游收取用户金额并在日志费用列展示盈亏（红盈绿亏），查询结果永久缓存至本地 SQLite 数据库。"
        icon={<Globe className="h-4 w-4" />}
      >
        <div className="py-2">
          <DownstreamNewApiConfigCard />
        </div>
      </SettingGroup>

      {/* 利润测算与用量盈亏分析 */}
      <SettingGroup
        id="section-billing-profit"
        title="利润测算与用量盈亏分析"
        description="填入下游 New API 管理地址与管理员令牌，选择分组与时间范围，拉取真实用量并基于当前配置测算毛利润与利润率。"
        icon={<TrendingUp className="h-4 w-4" />}
      >
        <div className="py-2">
          <ProfitCalculator currentCreditPrice={creditPrice} />
        </div>
      </SettingGroup>

      {/* 下游官方价格倍率模拟与对外口径 (移至最底部) */}
      <SettingGroup
        id="section-billing-ratio"
        title="下游计费口径与官方倍率模拟"
        description="面向下游开发者与终端客户最习惯的「官方标准价格 × XX 倍率」口径。实时换算各模型实收单价并一键生成对外公告文案。"
        icon={<Tag className="h-4 w-4" />}
      >
        <div className="py-2">
          <BillingRatioSimulator
            currentCreditPrice={creditPrice}
            onApplyCreditPrice={(next) => saver.save('creditPrice', { creditPrice: next })}
          />
        </div>
      </SettingGroup>
    </div>
  )
}
