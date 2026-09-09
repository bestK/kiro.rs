import { useState, useEffect } from 'react'
import {
  Globe,
  KeyRound,
  Coins,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  Calculator,
  Save,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  useNewApiConfig,
  useSetNewApiConfig,
  useTestNewApiConnection,
} from '@/hooks/use-credentials'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent } from '@/components/ui/dialog'

export function DownstreamNewApiConfigCard({
  onSaved,
}: {
  onSaved?: () => void
} = {}) {
  const { data: config, isLoading } = useNewApiConfig()
  const setConfigMutation = useSetNewApiConfig()
  const testConnectionMutation = useTestNewApiConnection()

  const [enabled, setEnabled] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [adminKey, setAdminKey] = useState('')
  const [showKey, setShowKey] = useState(false)

  // 成本模式：千分价 (元/1000分，如 80) 或 单积分价 (元/分，如 0.08)
  const [costUnit, setCostUnit] = useState<'k' | 'single'>('k')
  const [costPerCredit, setCostPerCredit] = useState(0.08)
  const [costInputStr, setCostInputStr] = useState('80')
  const [quotaPerUnit, setQuotaPerUnit] = useState(500000)

  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  useEffect(() => {
    if (config) {
      setEnabled(config.enabled)
      setBaseUrl(config.baseUrl || '')
      setAdminKey(config.adminKey || '')
      const cpc = config.costPerCredit > 0 ? config.costPerCredit : 0.08
      setCostPerCredit(cpc)
      setCostInputStr(costUnit === 'k' ? String(+(cpc * 1000).toFixed(4)) : String(cpc))
      setQuotaPerUnit(config.quotaPerUnit > 0 ? config.quotaPerUnit : 500000)
    }
  }, [config, costUnit])

  const handleCostUnitChange = (nextUnit: 'k' | 'single') => {
    setCostUnit(nextUnit)
    if (nextUnit === 'k') {
      setCostInputStr(String(+(costPerCredit * 1000).toFixed(4)))
    } else {
      setCostInputStr(String(costPerCredit))
    }
  }

  const handleCostInputChange = (val: string) => {
    setCostInputStr(val)
    const n = parseFloat(val)
    if (Number.isFinite(n) && n >= 0) {
      if (costUnit === 'k') {
        setCostPerCredit(n / 1000)
      } else {
        setCostPerCredit(n)
      }
    }
  }

  const handleSave = async () => {
    const cleanUrl = baseUrl.trim().replace(/\/+$/, '')
    const cleanKey = adminKey.trim()

    try {
      await setConfigMutation.mutateAsync({
        enabled,
        baseUrl: cleanUrl,
        adminKey: cleanKey,
        costPerCredit,
        quotaPerUnit: quotaPerUnit > 0 ? quotaPerUnit : 500000,
      })
      toast.success('下游 NewAPI 配置已成功保存并即时生效')
      onSaved?.()
    } catch (e: any) {
      toast.error(`保存失败: ${e.message || '未知错误'}`)
    }
  }

  const handleTest = async () => {
    const cleanUrl = baseUrl.trim().replace(/\/+$/, '')
    const cleanKey = adminKey.trim()
    if (!cleanUrl) {
      toast.error('请先填写下游 NewAPI 地址')
      return
    }
    if (!cleanKey) {
      toast.error('请先填写下游管理员令牌')
      return
    }

    setTestResult(null)
    try {
      const res = await testConnectionMutation.mutateAsync({
        baseUrl: cleanUrl,
        adminKey: cleanKey,
      })
      setTestResult(res)
      if (res.success) {
        toast.success(res.message)
      } else {
        toast.error(res.message)
      }
    } catch (e: any) {
      const msg = e.response?.data?.message || e.message || '连接测试异常'
      setTestResult({ success: false, message: msg })
      toast.error(`测试失败: ${msg}`)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground text-xs">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        加载下游配置中...
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-5 space-y-5">
      {/* 标题栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-500" />
            <h3 className="text-sm font-semibold text-foreground">下游 NewAPI 关联与盈亏配置</h3>
            <Badge
              variant={enabled ? 'default' : 'secondary'}
              className="text-[10px] px-1.5 py-0"
            >
              {enabled ? '已启用' : '未启用'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            通过 Trace ID 关联下游 NewAPI 的 upstream_request_id，自动查询用户扣费金额并在日志费用列展示盈亏（红盈绿亏），查询结果永久缓存至本地 SQLite 数据库避免二次查询。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
      </div>

      {/* 配置表单 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* NewAPI 地址 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            下游 NewAPI 地址
          </label>
          <Input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="例如: https://api.newapi.pro 或 http://newapi:3000"
            className="h-8 text-xs font-mono"
          />
          <p className="text-[11px] text-muted-foreground">
            下游服务的 Base URL（根路径，末尾不带 /）。
          </p>
        </div>

        {/* 管理员 Key */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
              管理员令牌 (Admin Key)
            </label>
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
          <div className="flex gap-2">
            <Input
              type={showKey ? 'text' : 'password'}
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="例如: sk-..."
              className="h-8 text-xs font-mono flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testConnectionMutation.isPending}
              className="h-8 px-3 text-xs shrink-0"
            >
              {testConnectionMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
              )}
              测试连接
            </Button>
          </div>
          {testResult && (
            <div
              className={cn(
                'text-[11px] flex items-center gap-1 mt-1 font-medium',
                testResult.success
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              )}
            >
              {testResult.success ? (
                <CheckCircle2 className="h-3 w-3 shrink-0" />
              ) : (
                <XCircle className="h-3 w-3 shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        {/* 上游成本单价配置 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5 text-amber-500" />
              上游采购成本单价
            </label>
            <div className="flex items-center rounded border border-border bg-muted/30 p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => handleCostUnitChange('k')}
                className={cn(
                  'rounded px-1.5 py-0.5 transition-colors',
                  costUnit === 'k'
                    ? 'bg-background text-foreground shadow-xs font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                元 / 1000 积分
              </button>
              <button
                type="button"
                onClick={() => handleCostUnitChange('single')}
                className={cn(
                  'rounded px-1.5 py-0.5 transition-colors',
                  costUnit === 'single'
                    ? 'bg-background text-foreground shadow-xs font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                元 / 单积分
              </button>
            </div>
          </div>
          <Input
            type="number"
            step={costUnit === 'k' ? '1' : '0.0001'}
            min="0"
            value={costInputStr}
            onChange={(e) => handleCostInputChange(e.target.value)}
            placeholder={costUnit === 'k' ? '80' : '0.08'}
            className="h-8 text-xs font-mono"
          />
          <p className="text-[11px] text-muted-foreground">
            当前单价：<span className="text-foreground font-mono font-medium">¥{costPerCredit.toFixed(4)} / 积分</span>（即 ¥{(costPerCredit * 1000).toFixed(2)} / 千分）。
          </p>
        </div>

        {/* Quota 汇率设置 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <Calculator className="h-3.5 w-3.5 text-muted-foreground" />
            下游额度点数换算率 (Quota / 货币单位)
          </label>
          <Input
            type="number"
            step="10000"
            min="1"
            value={quotaPerUnit}
            onChange={(e) => setQuotaPerUnit(parseFloat(e.target.value) || 500000)}
            placeholder="500000"
            className="h-8 text-xs font-mono"
          />
          <p className="text-[11px] text-muted-foreground">
            NewAPI 默认 1 元（或 1 USD）= 500,000 Quota 点数。收入 = 日志 Quota ÷ 换算率。
          </p>
        </div>
      </div>

      {/* 实时计算示意卡片 */}
      <div className="rounded-lg border border-border/80 bg-muted/40 p-3 text-xs space-y-1.5">
        <div className="font-medium text-foreground flex items-center justify-between">
          <span className="flex items-center gap-1">
            <Calculator className="h-3.5 w-3.5 text-blue-500" />
            核算公式与示例演算
          </span>
          <span className="text-[11px] text-muted-foreground">
            红为盈利 · 绿为亏损 (红盈绿亏)
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
          <div className="rounded bg-background/80 p-2 border border-border/50">
            <div className="text-muted-foreground text-[10px]">采购成本 (0.4826 credits)</div>
            <div className="font-medium text-foreground mt-0.5">
              0.4826 × {costPerCredit} = <span className="text-amber-600 dark:text-amber-400">¥{(0.4826 * costPerCredit).toFixed(6)}</span>
            </div>
          </div>
          <div className="rounded bg-background/80 p-2 border border-border/50">
            <div className="text-muted-foreground text-[10px]">下游收入 (12,927 Quota)</div>
            <div className="font-medium text-foreground mt-0.5">
              12,927 ÷ {quotaPerUnit.toLocaleString()} = <span className="text-sky-600 dark:text-sky-400">¥{(12927 / quotaPerUnit).toFixed(6)}</span>
            </div>
          </div>
          <div className="rounded bg-background/80 p-2 border border-border/50">
            <div className="text-muted-foreground text-[10px]">预估净盈亏</div>
            <div className="font-medium mt-0.5">
              {(12927 / quotaPerUnit) - (0.4826 * costPerCredit) >= 0 ? (
                <span className="text-rose-600 dark:text-rose-400">
                  +¥{((12927 / quotaPerUnit) - (0.4826 * costPerCredit)).toFixed(6)} (盈利)
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400">
                  -¥{Math.abs((12927 / quotaPerUnit) - (0.4826 * costPerCredit)).toFixed(6)} (亏损)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={setConfigMutation.isPending}
          className="h-8 text-xs px-4"
        >
          {setConfigMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Save className="h-3.5 w-3.5 mr-1.5" />
          )}
          保存配置
        </Button>
      </div>
    </div>
  )
}

export function DownstreamNewApiConfigDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DownstreamNewApiConfigCard
          onSaved={() => {
            onSaved?.()
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
