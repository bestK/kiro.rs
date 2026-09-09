import { useState, useMemo } from 'react'
import { Calculator, Sparkles, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface DownstreamRatioBalancerProps {
  /** 点击「应用此单价」时触发，传入单积分价格与每千分价格 */
  onApply: (singlePrice: number, kPrice: number) => void
  /** 当前宿主选中的单价单位（用于默认展示） */
  currentUnit?: 'k' | 'single'
  /** 初始期望实收（USD / 千分），默认 2.0 */
  initialTargetKPrice?: number
  /** 初始声明给下游的倍率，默认 0.3 */
  initialDownstreamRatio?: number
  /** 是否精简模式（在弹窗等小空间中使用） */
  compact?: boolean
  className?: string
}

export function DownstreamRatioBalancer({
  onApply,
  currentUnit = 'k',
  initialTargetKPrice = 80,
  initialDownstreamRatio = 0.3,
  compact = false,
  className,
}: DownstreamRatioBalancerProps) {
  const [targetKPriceStr, setTargetKPriceStr] = useState<string>(String(initialTargetKPrice))
  const [downstreamRatioStr, setDownstreamRatioStr] = useState<string>(String(initialDownstreamRatio))
  const [applied, setApplied] = useState(false)

  const targetKVal = Number(targetKPriceStr)
  const ratioVal = Number(downstreamRatioStr)

  const isValid =
    Number.isFinite(targetKVal) &&
    targetKVal > 0 &&
    Number.isFinite(ratioVal) &&
    ratioVal > 0

  const computedKPrice = useMemo(() => {
    if (!isValid) return 0
    return +(targetKVal / ratioVal).toFixed(4)
  }, [targetKVal, ratioVal, isValid])

  const computedSinglePrice = useMemo(() => {
    if (!isValid) return 0
    return +(targetKVal / (ratioVal * 1000)).toFixed(6)
  }, [targetKVal, ratioVal, isValid])

  const targetPresets = [70, 75, 80, 90, 100, 120, 150]
  const ratioPresets = [0.1, 0.2, 0.25, 0.3, 0.5, 0.8, 1.0]

  const discountText = useMemo(() => {
    if (!Number.isFinite(ratioVal) || ratioVal <= 0) return ''
    if (ratioVal === 1.0) return '官方原价 1.0x (无额外折扣)'
    if (ratioVal < 1.0) {
      const discount = (ratioVal * 10).toFixed(1)
      const savePercent = Math.round((1 - ratioVal) * 100)
      return `相当于官方 ${discount} 折特惠 (买家立省 ${savePercent}%)`
    }
    return `溢价 ${(ratioVal * 10).toFixed(1)} 折`
  }, [ratioVal])

  const handleApply = () => {
    if (!isValid) return
    onApply(computedSinglePrice, computedKPrice)
    setApplied(true)
    setTimeout(() => setApplied(false), 1500)
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-primary/25 bg-primary/5 p-3 space-y-2.5 text-xs transition-all',
        compact && 'p-2.5 space-y-2',
        className
      )}
    >
      {/* 头部标题与定位 */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Calculator className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>下游倍率自动配平计算器</span>
        </div>
        <Badge
          variant="outline"
          className="text-[10px] font-normal border-primary/30 text-primary bg-primary/5"
        >
          反推 Kiro 基准单价
        </Badge>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        下游买家习惯在 New API / One API 看到 0.2x~0.3x 等低倍率心智。输入您的<strong>期望实收</strong>与<strong>给下游声明的倍率</strong>，系统自动配平应在 Kiro 中设置的基准单价，既显超值折扣，又稳保真实利润。
      </p>

      {/* 输入网格：左侧期望实收，右侧下游倍率 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
        {/* 期望每千分实收 */}
        <div className="space-y-1.5 rounded-md border border-border/60 bg-background/80 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-foreground">
              期望每千分实收
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              每 1,000 积分
            </span>
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground">
              $
            </span>
            <Input
              type="number"
              step="any"
              min="0.01"
              value={targetKPriceStr}
              onChange={(e) => setTargetKPriceStr(e.target.value)}
              placeholder="80"
              className="h-7 pl-5 pr-14 text-xs font-mono"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
              USD / 千分
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            <span className="text-[10px] text-muted-foreground mr-0.5">预设:</span>
            {targetPresets.map((t) => {
              const active = Number(targetKPriceStr) === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTargetKPriceStr(String(t))}
                  className={cn(
                    'h-5 px-1.5 rounded text-[10px] font-mono border transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground border-primary font-medium'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                  )}
                >
                  ${t}
                </button>
              )
            })}
          </div>
        </div>

        {/* 声明给下游的倍率 */}
        <div className="space-y-1.5 rounded-md border border-border/60 bg-background/80 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-foreground">
              声明给下游的倍率
            </span>
            <span className="text-[10px] text-primary font-mono truncate max-w-[120px]">
              {discountText}
            </span>
          </div>
          <div className="relative">
            <Input
              type="number"
              step="any"
              min="0.001"
              value={downstreamRatioStr}
              onChange={(e) => setDownstreamRatioStr(e.target.value)}
              placeholder="0.3"
              className="h-7 pr-6 text-xs font-mono"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground">
              x
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            <span className="text-[10px] text-muted-foreground mr-0.5">预设:</span>
            {ratioPresets.map((r) => {
              const active = Number(downstreamRatioStr) === r
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDownstreamRatioStr(String(r))}
                  className={cn(
                    'h-5 px-1.5 rounded text-[10px] font-mono border transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground border-primary font-medium'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                  )}
                >
                  {r}x
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 配平结果与一键应用 */}
      {isValid ? (
        <div className="rounded-md border border-primary/30 bg-card p-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[11px] text-muted-foreground">
                Kiro 应该填写的基准单价：
              </div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                {currentUnit === 'k' ? (
                  <>
                    <span className="text-base font-bold font-mono text-primary">
                      ${computedKPrice}
                    </span>
                    <span className="text-xs text-foreground font-mono">/ 千分</span>
                    <span className="text-[11px] text-muted-foreground font-mono ml-1">
                      (折合 ${computedSinglePrice} / 积分)
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-base font-bold font-mono text-primary">
                      ${computedSinglePrice}
                    </span>
                    <span className="text-xs text-foreground font-mono">/ 积分</span>
                    <span className="text-[11px] text-muted-foreground font-mono ml-1">
                      (折合 ${computedKPrice} / 千分)
                    </span>
                  </>
                )}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleApply}
              disabled={applied}
              className="h-7 px-3 text-xs gap-1.5 shadow-xs font-medium"
            >
              {applied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  已应用单价
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  应用此单价 ({currentUnit === 'k' ? `$${computedKPrice}/千分` : `$${computedSinglePrice}/积分`})
                </>
              )}
            </Button>
          </div>

          <div className="rounded bg-muted/40 p-2 text-[11px] text-muted-foreground font-mono space-y-1 leading-normal border border-border/40">
            <div>
              • <strong>配平公式</strong>：期望实收 ${targetKVal} ÷ 声明倍率 {ratioVal}x = Kiro 单价{' '}
              <span className="text-foreground font-semibold">${computedKPrice}</span> / 千分
            </div>
            <div>
              • <strong>扣费闭环</strong>：下游设置 {ratioVal}x 倍率，买家每消耗 1,000 积分实付{' '}
              ${computedKPrice} × {ratioVal} = <span className="text-foreground font-semibold">${(computedKPrice * ratioVal).toFixed(2)}</span>，完全符合您的实收预期！
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded bg-destructive/10 border border-destructive/20 p-2 text-[11px] text-destructive">
          请输入大于 0 的有效期望实收金额与下游倍率
        </div>
      )}
    </div>
  )
}
