import { useState } from 'react'
import {
  Gauge,
  ShieldAlert,
  ShieldX,
  Timer,
  Activity,
  Plus,
  Trash2,
  Lock,
  Check,
  Loader2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  useAccountThrottleConfig,
  useSetAccountThrottleConfig,
  useAccountRpmLimitConfig,
  useSetAccountRpmLimitConfig,
  useLoadBalancingMode,
  useSetLoadBalancingMode,
  useSelfHealConfig,
  useSetSelfHealConfig,
} from '@/hooks/use-credentials'
import {
  SettingGroup,
  SettingNumber,
  SettingReadout,
  SettingSegments,
  SettingSwitch,
  useFieldSaver,
} from '@/components/console/setting-row'
import { reportSaveError } from '@/components/settings/report-error'
import { FloatingSectionNav, type NavSectionItem } from '@/components/console/floating-section-nav'

const SECS_PER_MIN = 60
// 与后端 SetAccountRpmLimitConfigRequest 的校验区间保持一致
const MIN_RPM_LIMIT = 1
const MAX_RPM_LIMIT = 100000

const DISPATCH_NAV_ITEMS: NavSectionItem[] = [
  { id: 'dispatch-load-balancing', title: '负载均衡策略' },
  { id: 'dispatch-throttle', title: '风控故障转移' },
  { id: 'dispatch-rpm-limit', title: '单账号RPM限制' },
  { id: 'dispatch-ban-detect', title: '账号封禁治理' },
  { id: 'dispatch-self-heal', title: '凭据自愈恢复' },
]

/**
 * 调度分区：凭据怎么选、失败怎么转、禁用怎么恢复。
 *
 * 三组配置放在一屏里是有意的 —— 它们互相牵制，分开看容易配出自相矛盾的组合。
 * 最典型的是「自愈开着 + 冷却间隔为 0」：403 持续时会陷入 全禁 → 自愈 → 403 → 再禁
 * 的死循环（0.7.4 修的就是这个）。摆在一起，间隔和上限这两个刹车就跟自愈开关同时在视野里。
 */
export function DispatchSection() {
  return (
    <div className="space-y-6">
      <FloatingSectionNav items={DISPATCH_NAV_ITEMS} />
      <div id="dispatch-load-balancing"><LoadBalancingGroup /></div>
      <div id="dispatch-throttle"><ThrottleGroup /></div>
      <div id="dispatch-rpm-limit"><RpmLimitGroup /></div>
      <div id="dispatch-ban-detect"><AccountBanGroup /></div>
      <div id="dispatch-self-heal"><SelfHealGroup /></div>
    </div>
  )
}

function LoadBalancingGroup() {
  const { data, isLoading } = useLoadBalancingMode()
  const { mutate } = useSetLoadBalancingMode()
  const saver = useFieldSaver(mutate, reportSaveError)
  const invertPriority = data?.invertPriority ?? false

  return (
    <SettingGroup
      title="凭据选择"
      description="控制多账号并发时调度器的路由策略"
      icon={<Gauge className="h-4 w-4" />}
      badge={
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[11px] font-mono">
            {data?.mode === 'balanced' ? '均衡负载' : '按优先级'}
          </Badge>
          <Badge variant={invertPriority ? 'default' : 'secondary'} className="text-[11px] font-mono">
            {invertPriority ? '数字大优先' : '数字小优先'}
          </Badge>
        </div>
      }
    >
      <SettingSegments
        label="负载均衡模式"
        hint={
          data?.mode === 'balanced'
            ? '按用量动态挑选凭据，把请求摊平到整个池子'
            : invertPriority
              ? '按优先级数字从大到小用：数字越大约优先'
              : '按优先级数字从小到大用：先用完 0 号，再换 1 号'
        }
        value={data?.mode ?? 'priority'}
        options={[
          {
            value: 'priority',
            label: '按优先级',
            hint: invertPriority ? '大数字先用，顺序耗尽' : '小数字先用，顺序耗尽',
          },
          { value: 'balanced', label: '均衡负载', hint: '按用量动态摊平' },
        ]}
        onChange={(next) => saver.save('mode', { mode: next as 'priority' | 'balanced' })}
        pending={saver.isSaving('mode')}
        saved={saver.isSaved('mode')}
        disabled={isLoading}
      />
      <SettingSwitch
        label="优先级反转"
        hint={
          invertPriority
            ? '已开启：数字越大优先级越高（如 100 > 10 > 0）'
            : '未开启（默认）：数字越小优先级越高（0 最优先）'
        }
        checked={invertPriority}
        onChange={(next) => saver.save('invertPriority', { invertPriority: next })}
        pending={saver.isSaving('invertPriority')}
        saved={saver.isSaved('invertPriority')}
        disabled={isLoading}
      />
    </SettingGroup>
  )
}

function ThrottleGroup() {
  const { data, isLoading } = useAccountThrottleConfig()
  const { mutate } = useSetAccountThrottleConfig()
  const saver = useFieldSaver(mutate, reportSaveError)
  const failover = data?.failover ?? true
  const cooldownSecs = data?.cooldownSecs ?? 30 * SECS_PER_MIN

  return (
    <SettingGroup
      title="账号级风控"
      description="上游对单个账号触发临时限速（429 + suspicious activity）时怎么处理"
      icon={<ShieldAlert className="h-4 w-4" />}
      badge={
        <Badge variant={failover ? 'default' : 'secondary'} className="text-[11px]">
          {failover ? '故障转移已启用' : '仅原号重试'}
        </Badge>
      }
    >
      <SettingSwitch
        label="故障转移"
        hint={
          failover
            ? '冷却该凭据并立即切到下一个可用凭据'
            : '仅按瞬态错误重试，不切换凭据'
        }
        checked={failover}
        onChange={(next) => saver.save('failover', { failover: next })}
        pending={saver.isSaving('failover')}
        saved={saver.isSaved('failover')}
        disabled={isLoading}
      />
      <SettingNumber
        label="冷却时长"
        hint="被风控的凭据要静默多久才重新参与调度"
        value={cooldownSecs}
        toDisplay={(secs) => Math.round(secs / SECS_PER_MIN)}
        fromDisplay={(min) => min * SECS_PER_MIN}
        onCommit={(secs) => saver.save('cooldown', { cooldownSecs: secs })}
        min={1}
        max={1440}
        unit="分钟"
        presets={[5, 15, 30, 60]}
        pending={saver.isSaving('cooldown')}
        saved={saver.isSaved('cooldown')}
        disabled={isLoading || !failover}
      />
    </SettingGroup>
  )
}

/**
 * 单账号 RPM 主动限流。
 *
 * 紧跟「账号级风控」是有意的：两者都是账号级限速，区别只在谁先动手 ——
 * 风控是上游 429 之后的被动补救，这里是我们自己先掐住不让它撞上去。
 * 摆在一起，配了主动限流还在等风控兜底这种误解就不容易发生。
 */
function RpmLimitGroup() {
  const { data, isLoading } = useAccountRpmLimitConfig()
  const { mutate } = useSetAccountRpmLimitConfig()
  const saver = useFieldSaver(mutate, reportSaveError)
  const enabled = data?.enabled ?? false
  const limit = data?.limit ?? 60

  return (
    <SettingGroup
      title="单账号限流"
      description="主动掐住单个账号的每分钟请求数，别等上游风控才反应"
      icon={<Timer className="h-4 w-4" />}
      badge={
        <Badge variant={enabled ? 'default' : 'secondary'} className="text-[11px] font-mono">
          {enabled ? `${limit} RPM 限流` : '未启用限频'}
        </Badge>
      }
    >
      <SettingSwitch
        label="启用 RPM 限流"
        hint={
          enabled
            ? '每个凭据独立计 60 秒滑动窗口，超限的临时跳过并切到下一个可用凭据'
            : '关闭时不计数、不影响调度'
        }
        checked={enabled}
        onChange={(next) => saver.save('enabled', { enabled: next })}
        pending={saver.isSaving('enabled')}
        saved={saver.isSaved('enabled')}
        disabled={isLoading}
      />
      <SettingNumber
        label="每分钟上限"
        hint="单个凭据 60 秒内最多放行多少请求。所有凭据都超限时请求返回 429"
        value={limit}
        onCommit={(n) => saver.save('limit', { limit: n })}
        min={MIN_RPM_LIMIT}
        max={MAX_RPM_LIMIT}
        unit="次/分钟"
        presets={[10, 30, 60, 120, 300]}
        pending={saver.isSaving('limit')}
        saved={saver.isSaved('limit')}
        disabled={isLoading || !enabled}
      />
    </SettingGroup>
  )
}

function AccountBanGroup() {
  const { data, isLoading } = useSelfHealConfig()
  const { mutate } = useSetSelfHealConfig()
  const saver = useFieldSaver(mutate, reportSaveError)
  const enabled = data?.suspendedDetectionEnabled ?? true
  const keywords = data?.suspendedBanKeywords ?? []

  return (
    <SettingGroup
      title="账号封禁治理"
      description="识别上游封号响应（如 TEMPORARILY_SUSPENDED、locked 等）并永久熔断，绝不参与自愈重试"
      icon={<ShieldX className="h-4 w-4" />}
      badge={
        <Badge variant={enabled ? 'destructive' : 'secondary'} className="text-[11px]">
          {enabled ? '封禁拦截已就绪' : '已关闭'}
        </Badge>
      }
    >
      <SettingSwitch
        label="启用封号识别"
        hint="命中封号响应（不限 403/429）立即标记为「账号封禁」并禁用，且永久排除在凭据自愈之外"
        checked={enabled}
        onChange={(next) =>
          saver.save('suspended', { suspendedDetectionEnabled: next })
        }
        pending={saver.isSaving('suspended')}
        saved={saver.isSaved('suspended')}
        disabled={isLoading}
      />
      <BanRulesTable
        keywords={keywords}
        onCommit={(newKeywords) =>
          saver.save('keywords', { suspendedBanKeywords: newKeywords })
        }
        pending={saver.isSaving('keywords')}
        saved={saver.isSaved('keywords')}
        disabled={isLoading || !enabled}
      />
    </SettingGroup>
  )
}

function SelfHealGroup() {
  const { data, isLoading } = useSelfHealConfig()
  const { mutate } = useSetSelfHealConfig()
  const saver = useFieldSaver(mutate, reportSaveError)
  const enabled = data?.enabled ?? true

  return (
    <SettingGroup
      title="凭据自愈恢复"
      description="请求池全灭时自动批量恢复因临时失败被禁用的凭据（已封禁账号将被永久隔离，不参与自愈）"
      icon={<Activity className="h-4 w-4" />}
      badge={
        <Badge variant={enabled ? 'default' : 'secondary'} className="text-[11px]">
          {enabled ? '自愈活跃' : '已关闭'}
        </Badge>
      }
    >
      <SettingSwitch
        label="启用自愈"
        hint="当前作用域内已无可用凭据时，按作用域批量恢复因失败过多被禁用的凭据"
        checked={enabled}
        onChange={(next) => saver.save('enabled', { enabled: next })}
        pending={saver.isSaving('enabled')}
        saved={saver.isSaved('enabled')}
        disabled={isLoading}
      />
      <SettingNumber
        label="自愈冷却间隔"
        hint="两次自愈之间的最小间隔。设 0 表示不冷却 —— 上游持续故障时这是唯一能打断死循环的刹车，不建议设 0"
        value={data?.minIntervalSecs ?? 0}
        toDisplay={(secs) => Math.round(secs / SECS_PER_MIN)}
        fromDisplay={(min) => min * SECS_PER_MIN}
        onCommit={(secs) => saver.save('interval', { minIntervalSecs: secs })}
        min={0}
        max={1440}
        unit="分钟"
        presets={[0, 1, 5, 15]}
        pending={saver.isSaving('interval')}
        saved={saver.isSaved('interval')}
        disabled={isLoading || !enabled}
      />
      <SettingNumber
        label="连续自愈上限"
        hint="连续自愈达到该轮数且期间无任何成功请求则停止自愈。0 = 不限"
        value={data?.maxConsecutiveRounds ?? 5}
        onCommit={(n) => saver.save('rounds', { maxConsecutiveRounds: n })}
        min={0}
        max={1000}
        unit="轮"
        pending={saver.isSaving('rounds')}
        saved={saver.isSaved('rounds')}
        disabled={isLoading || !enabled}
      />
      <SettingReadout
        label="运行状态"
        hint="当前连续自愈轮数 / 累计恢复凭据次数"
      >
        连续 {data?.consecutiveRounds ?? 0} 轮 · 累计恢复 {data?.totalCount ?? 0} 次
      </SettingReadout>
    </SettingGroup>
  )
}

function BanRulesTable({
  keywords,
  onCommit,
  pending,
  saved,
  disabled,
}: {
  keywords: string[]
  onCommit: (keywords: string[]) => void
  pending?: boolean
  saved?: boolean
  disabled?: boolean
}) {
  const [draft, setDraft] = useState('')

  const handleAdd = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (keywords.some((k) => k.toLowerCase() === trimmed.toLowerCase())) {
      setDraft('')
      return
    }
    onCommit([...keywords, trimmed])
    setDraft('')
  }

  const handleRemove = (index: number) => {
    onCommit(keywords.filter((_, i) => i !== index))
  }

  return (
    <div className="py-3.5 space-y-3">
      {/* 头部：说明与添加操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-medium text-foreground">封号特征识别规则表</span>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {!pending && saved && <Check className="h-3.5 w-3.5 text-emerald-500" />}
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground font-mono">
              共 {2 + keywords.length} 条规则
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
            无论正常调度还是探测重试，响应体命中表中任一特征将立即熔断并标记为「账号封禁」，永久排除在自动自愈之外。
          </p>
        </div>

        {/* 添加自定义关键词 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Input
            value={draft}
            disabled={disabled || pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder="输入自定义封禁关键词..."
            className="h-8 w-48 sm:w-56 text-xs bg-background"
          />
          <Button
            type="button"
            size="sm"
            className="h-8 px-3 text-xs gap-1 shrink-0 cursor-pointer"
            disabled={disabled || pending || !draft.trim()}
            onClick={handleAdd}
          >
            <Plus className="h-3.5 w-3.5" />
            添加关键词
          </Button>
        </div>
      </div>

      {/* 规则表格 */}
      <div className="rounded-lg border border-border/70 overflow-hidden bg-card/60 shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-muted-foreground text-[11px]">
                <th className="py-2.5 px-3.5 font-medium w-24">规则来源</th>
                <th className="py-2.5 px-3.5 font-medium">匹配特征 / 关键词</th>
                <th className="py-2.5 px-3.5 font-medium w-48">匹配模式</th>
                <th className="py-2.5 px-3.5 font-medium w-36">处置策略</th>
                <th className="py-2.5 px-3.5 font-medium text-right w-20">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 text-xs">
              {/* 内置规则 1 */}
              <tr className="hover:bg-muted/20 transition-colors">
                <td className="py-2.5 px-3.5">
                  <Badge variant="outline" className="border-rose-500/30 text-rose-600 dark:text-rose-400 bg-rose-500/10 text-[10.5px] px-1.5 py-0 font-medium">
                    内置规则
                  </Badge>
                </td>
                <td className="py-2.5 px-3.5">
                  <code className="font-mono text-[11px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/5 border border-rose-500/20 px-1.5 py-0.5 rounded">
                    reason: "TEMPORARILY_SUSPENDED"
                  </code>
                </td>
                <td className="py-2.5 px-3.5 text-muted-foreground text-[11.5px]">
                  JSON 顶层或嵌套结构化字段精确比对
                </td>
                <td className="py-2.5 px-3.5 text-muted-foreground text-[11.5px]">
                  标记封禁 · 排除自愈
                </td>
                <td className="py-2.5 px-3.5 text-right">
                  <span className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground/70" title="内核原生只读规则">
                    <Lock className="h-3 w-3" />
                    系统锁定
                  </span>
                </td>
              </tr>

              {/* 内置规则 2 */}
              <tr className="hover:bg-muted/20 transition-colors">
                <td className="py-2.5 px-3.5">
                  <Badge variant="outline" className="border-rose-500/30 text-rose-600 dark:text-rose-400 bg-rose-500/10 text-[10.5px] px-1.5 py-0 font-medium">
                    内置规则
                  </Badge>
                </td>
                <td className="py-2.5 px-3.5">
                  <div className="flex items-center gap-1 font-mono text-[11px] flex-wrap">
                    <code className="bg-muted px-1.5 py-0.5 rounded border border-border/60 text-foreground">
                      "suspended"
                    </code>
                    <span className="text-muted-foreground font-bold text-[10px]">+</span>
                    <code className="bg-muted px-1.5 py-0.5 rounded border border-border/60 text-foreground">
                      "locked your account" / "locked it"
                    </code>
                  </div>
                </td>
                <td className="py-2.5 px-3.5 text-muted-foreground text-[11.5px]">
                  响应体双短语交叉组合包含
                </td>
                <td className="py-2.5 px-3.5 text-muted-foreground text-[11.5px]">
                  标记封禁 · 排除自愈
                </td>
                <td className="py-2.5 px-3.5 text-right">
                  <span className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground/70" title="内核原生只读规则">
                    <Lock className="h-3 w-3" />
                    系统锁定
                  </span>
                </td>
              </tr>

              {/* 自定义关键词行 */}
              {keywords.map((kw, idx) => (
                <tr key={idx} className="hover:bg-muted/20 transition-colors">
                  <td className="py-2.5 px-3.5">
                    <Badge variant="secondary" className="text-[10.5px] px-1.5 py-0 font-normal">
                      自定义
                    </Badge>
                  </td>
                  <td className="py-2.5 px-3.5">
                    <code className="font-mono text-[11.5px] font-medium text-foreground bg-muted/70 px-1.5 py-0.5 rounded border border-border/60">
                      {kw}
                    </code>
                  </td>
                  <td className="py-2.5 px-3.5 text-muted-foreground text-[11.5px]">
                    响应体子串匹配 (忽略大小写)
                  </td>
                  <td className="py-2.5 px-3.5 text-muted-foreground text-[11.5px]">
                    标记封禁 · 排除自愈
                  </td>
                  <td className="py-2.5 px-3.5 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                      onClick={() => handleRemove(idx)}
                      disabled={disabled || pending}
                      title="删除该关键词"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}

              {keywords.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 px-3.5 text-center text-muted-foreground text-xs bg-muted/5">
                    暂未配置自定义关键词。若上游出现特定封号错误文案，可在上方输入框添加关键词进行补充拦截。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
