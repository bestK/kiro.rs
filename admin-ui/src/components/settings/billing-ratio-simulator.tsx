import { useState, useMemo } from 'react'
import {
  Tag,
  Percent,
  Copy,
  Check,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Coins,
  ShieldCheck,
  FileText,
  Sliders,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ModelPricingSpec {
  id: string
  name: string
  provider: 'anthropic' | 'openai'
  officialInput: number // USD per 1M tokens
  officialOutput: number
  officialCacheRead: number
}

const POPULAR_MODELS: ModelPricingSpec[] = [
  {
    id: 'claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'anthropic',
    officialInput: 3.0,
    officialOutput: 15.0,
    officialCacheRead: 0.3,
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    officialInput: 3.0,
    officialOutput: 15.0,
    officialCacheRead: 0.3,
  },
  {
    id: 'claude-3-5-haiku',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    officialInput: 0.8,
    officialOutput: 4.0,
    officialCacheRead: 0.08,
  },
  {
    id: 'claude-opus-4',
    name: 'Claude 3 / 4 Opus',
    provider: 'anthropic',
    officialInput: 15.0,
    officialOutput: 75.0,
    officialCacheRead: 1.5,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    officialInput: 2.5,
    officialOutput: 10.0,
    officialCacheRead: 1.25,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o-mini',
    provider: 'openai',
    officialInput: 0.15,
    officialOutput: 0.6,
    officialCacheRead: 0.075,
  },
]

interface BillingRatioSimulatorProps {
  currentCreditPrice: number
}

export function BillingRatioSimulator({ currentCreditPrice }: BillingRatioSimulatorProps) {
  // 当前模拟的倍率（例如 0.13 代表 0.13x / 1.3折）
  const [ratio, setRatio] = useState<number>(0.13)
  const [ratioInputStr, setRatioInputStr] = useState<string>('0.13')
  const [hasCopied, setHasCopied] = useState(false)
  const [showCopySection, setShowCopySection] = useState(false)

  // 典型请求模拟参数 (用于展示实测调用示例)
  const simInputTokens = 2500
  const simOutputTokens = 800
  const simCacheTokens = 18000

  const presetRatios = [0.02, 0.03, 0.04, 0.08, 0.1, 0.13, 0.2, 0.5, 1.0]

  const handleSelectPreset = (r: number) => {
    setRatio(r)
    setRatioInputStr(String(r))
  }

  const handleRatioInputChange = (val: string) => {
    setRatioInputStr(val)
    const n = Number(val)
    if (Number.isFinite(n) && n > 0 && n <= 10) {
      setRatio(n)
    }
  }

  // 计算典型单次请求费用
  const sonnetSpec = POPULAR_MODELS[0]
  const simOfficialCostUsd = useMemo(() => {
    return (
      (simInputTokens / 1_000_000) * sonnetSpec.officialInput +
      (simOutputTokens / 1_000_000) * sonnetSpec.officialOutput +
      (simCacheTokens / 1_000_000) * sonnetSpec.officialCacheRead
    )
  }, [simInputTokens, simOutputTokens, simCacheTokens, sonnetSpec])

  const simCustomerBilledUsd = simOfficialCostUsd * ratio
  const simCustomerQuota = Math.round(simCustomerBilledUsd * 500000)
  const simSavingsPercent = Math.max(0, Math.round((1 - ratio) * 100))

  // 生成对外宣传文案
  const copyTemplate = useMemo(() => {
    const discountText =
      ratio === 1.0
        ? '官方标准原价'
        : ratio < 0.1
        ? `官方 ${(ratio * 10).toFixed(1)} 折超级福利`
        : `官方 ${(ratio * 10).toFixed(1)} 折特惠`

    return `### 🌟 本站 API 计费口径与模型价格说明

本站采用国际通用的 **【官方标准单价 × ${ratio}x 倍率】** 模式透明计费，所有模型基于 Anthropic / OpenAI 官方标准价格打折，支持完整 Prompt Caching 自动缓存命中！

---

#### 📌 核心计费公式
\`\`\`text
实际扣费 = (普通输入Tokens × 官方输入单价 + 缓存读取Tokens × 官方缓存单价 + 输出Tokens × 官方输出单价) × ${ratio}
\`\`\`

- **计费基准**：严格以官方公布的标准价格为 1.0x 基准
- **当前分组倍率**：**${ratio}x (${discountText})**
- **缓存优惠机制**：自动支持 Prompt 缓存，缓存命中部分享受折上折（仅按官方 0.1x 缓存价折算，相比常规输入再省 90%）
- **相对官方直购**：**立省 ${simSavingsPercent}%**

---

#### 📊 热门模型实收单价对照表 (每 100 万 Tokens)

| 模型名称 | 官方原价 (输入/输出) | 本站实收价格 (${ratio}x) | 缓存读取特惠 |
| :--- | :--- | :--- | :--- |
${POPULAR_MODELS.map((m) => {
  const inPrice = (m.officialInput * ratio).toFixed(4)
  const outPrice = (m.officialOutput * ratio).toFixed(4)
  const cachePrice = (m.officialCacheRead * ratio).toFixed(4)
  return `| **${m.name}** | $${m.officialInput} / $${m.officialOutput} | **$${inPrice} / $${outPrice}** | $${cachePrice}/M (0.1x) |`
}).join('\n')}

---

#### 💡 典型请求实测示例 (以 Claude 3.7 Sonnet 为例)
- 一次典型编程/聊天请求：输入 2,500 Tokens，输出 800 Tokens，缓存命中 18,000 Tokens
- 官方原价消费：**$${simOfficialCostUsd.toFixed(4)} USD**
- 本站 ${ratio}x 实收：**$${simCustomerBilledUsd.toFixed(4)} USD** (约 ${simCustomerQuota.toLocaleString()} Quota)
- 节省金额：**${simSavingsPercent}%**
`
  }, [ratio, simOfficialCostUsd, simCustomerBilledUsd, simCustomerQuota, simSavingsPercent])

  const handleCopyText = () => {
    navigator.clipboard.writeText(copyTemplate)
    setHasCopied(true)
    toast.success('已成功复制对外宣传话术与价格表到剪贴板')
    setTimeout(() => setHasCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      {/* ⚠️ 核心声明提示：告知用户此模块仅为对外话术文案与价格换算预览，不影响 Kiro 运行时 Token 计算 */}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="font-semibold text-amber-800 dark:text-amber-300">
              声明提示：本模块仅用于对外宣传话术文案与下游价格预览
            </span>
          </div>
          <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10">
            仅作沟通文案 · 不参与 Token 折算
          </Badge>
        </div>
        <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80 leading-relaxed">
          此处选择或输入的倍率（如 <strong className="font-mono">0.13x</strong>）<strong>仅作为面向终端客户宣传的话术口径与价格换算参考</strong>，<strong>绝不会直接修改或参与 Kiro 运行时向外部返回的实际 Token 数量模拟</strong>。
        </p>
        <div className="text-[11px] text-muted-foreground pt-0.5 space-y-0.5 border-t border-amber-500/20">
          <div>
            • <strong>Kiro 真实的 Token 模拟计算</strong>：始终由上方表单的<strong>「基准千分单价」</strong>（将账号实际消耗的积分折算为等价官方 Token）与「模拟缓存命中率」决定。
          </div>
          <div>
            • <strong>倍率（如 0.13x）的真正扣费生效处</strong>：是在下游平台（如 New API 的分组管理中，将分组倍率设置为 0.13）扣除终端用户钱包配额时生效。
          </div>
        </div>
      </div>

      {/* 1. 概念对照与口径打通说明卡片 */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Tag className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <span>计费双口径换算逻辑（上游积分 vs 下游官方倍率）</span>
              <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-600 bg-emerald-500/5">
                100% 对应无缝互通
              </Badge>
            </h4>
            <p className="text-[11px] text-muted-foreground">
              下游开发者与买家习惯「官方价格，xx倍率」，而上游平台习惯「按积分/千分折算」。Kiro 的算法在底层已将两者完美统一：
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="rounded-md border border-border/50 bg-background/60 p-3 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1">
                <Coins className="h-3.5 w-3.5 text-amber-500" />
                <span>上游内部运营视角</span>
              </span>
              <Badge variant="secondary" className="text-[10px]">后台对账</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              以 <strong className="text-foreground font-mono">${+(currentCreditPrice * 1000).toFixed(4)} / 千分</strong>（${currentCreditPrice} / 积分）为基准结算成本与收益。Kiro 每次处理请求固定或按量扣除实际账号积分。
            </p>
          </div>

          <div className="rounded-md border border-border/50 bg-background/60 p-3 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1">
                <Percent className="h-3.5 w-3.5 text-primary" />
                <span>下游买家客户视角</span>
              </span>
              <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">市场通用口径</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              以 <strong className="text-foreground font-mono">官方标准原价 × {ratio}x 倍率</strong> 宣传与展示。因为 Kiro 返回的 Token 数基于官方价格倒推，在 New API 分组设置对应倍率后，客户扣费账单与官方倍率分毫不差！
            </p>
          </div>
        </div>
      </div>

      {/* 2. 交互式倍率模拟器 */}
      <div className="rounded-lg border border-border/60 bg-card p-4 space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-primary" />
            <div>
              <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                <span>下游分组倍率模拟与价格生成器</span>
                <Badge variant="outline" className="font-mono text-[11px] text-primary border-primary/40">
                  当前倍率: {ratio}x
                </Badge>
                {ratio < 1.0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    相当于官方 {(ratio * 10).toFixed(1)} 折 (省 {simSavingsPercent}%)
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                选择或输入你在 New API 分组中设定的倍率，实时预览各主流模型面向下游客户的等效实收单价。
              </p>
            </div>
          </div>

          {/* 快捷倍率切换 */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-1">快捷预设:</span>
            {presetRatios.map((r) => (
              <Button
                key={r}
                type="button"
                size="sm"
                variant={ratio === r ? 'default' : 'outline'}
                className={cn(
                  'h-6 px-1.5 text-[10px] font-mono',
                  ratio === r && 'font-semibold shadow-xs'
                )}
                onClick={() => handleSelectPreset(r)}
              >
                {r}x
              </Button>
            ))}
          </div>
        </div>

        {/* 倍率输入控制与等效单价预览 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground">
              输入自定义下游分组倍率
            </label>
            <div className="relative">
              <Input
                type="number"
                step="any"
                min="0.001"
                max="10"
                value={ratioInputStr}
                onChange={(e) => handleRatioInputChange(e.target.value)}
                className="h-8 text-xs font-mono pr-8"
                placeholder="0.13"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
                x
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground">
              对应市场常用商业称谓
            </label>
            <div className="h-8 rounded-md border border-border bg-muted/40 px-3 flex items-center text-xs font-medium text-foreground">
              {ratio === 1.0 ? '官方正价 1.0x (原价标准)' : `官方 ${(ratio * 10).toFixed(1)} 折特惠分组`}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground">
              相对 Anthropic / OpenAI 官方直购
            </label>
            <div className="h-8 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 flex items-center justify-between text-xs font-mono">
              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                为客户立省 {simSavingsPercent}%
              </span>
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            </div>
          </div>
        </div>

        {/* 主流模型实收价格对照表格 */}
        <div className="rounded-md border border-border/50 overflow-hidden">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-muted/40 text-[11px] text-muted-foreground border-b border-border/40 font-sans">
              <tr>
                <th className="px-3.5 py-2 font-medium">模型名称</th>
                <th className="px-3.5 py-2 font-medium">官方原价 (输入 / 输出)</th>
                <th className="px-3.5 py-2 font-medium text-primary">
                  下游实收售价 ({ratio}x)
                </th>
                <th className="px-3.5 py-2 font-medium">缓存命中特惠 (0.1x)</th>
                <th className="px-3.5 py-2 font-medium text-right">折扣比例</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {POPULAR_MODELS.map((m) => {
                const inPrice = (m.officialInput * ratio).toFixed(4)
                const outPrice = (m.officialOutput * ratio).toFixed(4)
                const cachePrice = (m.officialCacheRead * ratio).toFixed(4)
                return (
                  <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3.5 py-2.5 font-medium text-foreground">
                      {m.name}
                    </td>
                    <td className="px-3.5 py-2.5 text-muted-foreground text-[11px]">
                      ${m.officialInput} / ${m.officialOutput} /M
                    </td>
                    <td className="px-3.5 py-2.5 font-semibold text-primary">
                      ${inPrice} / ${outPrice} /M
                    </td>
                    <td className="px-3.5 py-2.5 text-muted-foreground text-[11px]">
                      ${cachePrice} /M
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-medium text-emerald-600 dark:text-emerald-400">
                      省 {simSavingsPercent}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* 3. 典型请求场景计算卡片 */}
        <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span>真实单次请求调用费用实测 (以 Claude 3.7 Sonnet 为例)</span>
            </span>
            <div className="text-[11px] text-muted-foreground font-mono">
              输入 2.5k · 输出 800 · 缓存 18k
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 font-mono">
            <div className="rounded border border-border/40 bg-background/60 p-2.5 space-y-0.5">
              <div className="text-[10px] text-muted-foreground font-sans">官方原版扣费：</div>
              <div className="text-sm font-bold text-foreground">
                ${simOfficialCostUsd.toFixed(4)} USD
              </div>
              <div className="text-[10px] text-muted-foreground">
                (无倍率/官方直购原价)
              </div>
            </div>

            <div className="rounded border border-primary/30 bg-primary/5 p-2.5 space-y-0.5">
              <div className="text-[10px] text-primary font-sans font-medium">
                本站 {ratio}x 实收扣费：
              </div>
              <div className="text-sm font-bold text-primary">
                ${simCustomerBilledUsd.toFixed(4)} USD
              </div>
              <div className="text-[10px] text-muted-foreground">
                约 {simCustomerQuota.toLocaleString()} Quota 配额
              </div>
            </div>

            <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2.5 space-y-0.5">
              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-sans font-medium">
                为下游客户节省：
              </div>
              <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                ${(simOfficialCostUsd - simCustomerBilledUsd).toFixed(4)} USD
              </div>
              <div className="text-[10px] text-muted-foreground">
                直接打 {ratio * 10} 折 (立省 {simSavingsPercent}%)
              </div>
            </div>
          </div>
        </div>

        {/* 4. 对外宣传话术与价格公告生成器 */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCopySection(!showCopySection)}
              className="h-7 px-2.5 text-xs text-primary hover:text-primary gap-1.5"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>{showCopySection ? '收起对外公告与计费说明模版' : '查看/一键复制对外计费说明模版 (面向客户话术)'}</span>
              {showCopySection ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>

            {showCopySection && (
              <Button
                type="button"
                size="sm"
                onClick={handleCopyText}
                className="h-7 px-3 text-xs gap-1 shadow-xs"
              >
                {hasCopied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span>已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>一键复制全套公告文案</span>
                  </>
                )}
              </Button>
            )}
          </div>

          {showCopySection && (
            <div className="rounded-md border border-border/50 bg-muted/40 p-3 space-y-2 text-xs animate-in fade-in-50">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  可以直接复制以下 Markdown 文案，粘贴至 New API 首页公告、群公告或发给下游客户：
                </span>
                <button
                  type="button"
                  onClick={handleCopyText}
                  className="text-primary hover:underline flex items-center gap-1 font-sans"
                >
                  <Copy className="h-2.5 w-2.5" />
                  <span>复制 Markdown</span>
                </button>
              </div>

              <pre className="max-h-64 overflow-y-auto rounded bg-background p-3 font-mono text-[11px] text-foreground leading-relaxed whitespace-pre-wrap border border-border/40 select-all">
                {copyTemplate}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
