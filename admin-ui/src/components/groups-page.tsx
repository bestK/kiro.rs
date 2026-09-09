import { useMemo, useState, useEffect, useDeferredValue } from 'react'
import { toast } from 'sonner'
import {
  Plus, FolderTree, Trash2, Pencil, Users, KeyRound, RefreshCw, Loader2,
  Search, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Layers, Zap, Scale, Shield,
  Filter, UserPlus, Check, Calendar, CornerDownRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  useGroups, useGroupOptions, useCreateGroup, useUpdateGroup, useDeleteGroup,
} from '@/hooks/use-groups'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { extractErrorMessage } from '@/lib/utils'
import type {
  GroupItem, GroupQueryParams, GroupReference, ReferenceTier,
  CredentialFilterCriteria, AssignMode, PreviewFilterResponse,
} from '@/types/api'
import { previewCredentialsFilter, assignGroupCredentialsByFilter } from '@/api/groups'
import { useQueryClient } from '@tanstack/react-query'
import { ConsoleTable, type ConsoleColumn } from '@/components/console/data-table'
import { BulkBar } from '@/components/console/bulk-bar'
import { PageHeader } from '@/components/console/page-header'
import { CreditPriceInput } from '@/components/credit-price-input'

function GroupReferencesEditor({
  references,
  onChange,
  currentGroupName,
  allGroupOptions,
  disabled,
}: {
  references: GroupReference[]
  onChange: (refs: GroupReference[]) => void
  currentGroupName?: string
  allGroupOptions: string[]
  disabled?: boolean
}) {
  const candidateGroups = useMemo(() => {
    return allGroupOptions.filter(
      (name) => name !== currentGroupName && !references.some((r) => r.group === name),
    )
  }, [allGroupOptions, currentGroupName, references])

  const handleAdd = (targetGroup: string) => {
    if (!targetGroup) return
    onChange([
      ...references,
      {
        group: targetGroup,
        tier: 'prioritized',
        enabled: true,
      },
    ])
  }

  const handleRemove = (index: number) => {
    const next = [...references]
    next.splice(index, 1)
    onChange(next)
  }

  const handleUpdateTier = (index: number, tier: ReferenceTier) => {
    const next = [...references]
    next[index] = { ...next[index], tier }
    onChange(next)
  }

  const handleToggleEnabled = (index: number, enabled: boolean) => {
    const next = [...references]
    next[index] = { ...next[index], enabled }
    onChange(next)
  }

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= references.length) return
    const next = [...references]
    const temp = next[index]
    next[index] = next[targetIndex]
    next[targetIndex] = temp
    onChange(next)
  }

  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
            <Layers className="h-3.5 w-3.5 text-primary" />
            <span>跨分组账号引用 / 优先级调度池</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            借调其他分组的账号供当前分组共同使用。可设置优先级梯度（如临期账号池严格优先消耗）。
          </p>
        </div>
      </div>

      {references.length > 0 ? (
        <div className="space-y-2">
          {references.map((ref, idx) => (
            <div
              key={ref.group}
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border bg-card p-2 text-xs transition-colors ${
                !ref.enabled ? 'opacity-60 bg-muted/40' : ''
              }`}
            >
              {/* 序号与分组名 */}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-[10px] font-mono text-muted-foreground w-4 text-center shrink-0">
                  #{idx + 1}
                </span>
                <span className="font-medium truncate text-foreground" title={ref.group}>
                  {ref.group}
                </span>
                {ref.tier === 'prioritized' && (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-600 bg-amber-500/10 text-[10px] py-0 px-1 font-normal shrink-0">
                    优先 Tier {idx}
                  </Badge>
                )}
                {ref.tier === 'normal' && (
                  <Badge variant="outline" className="border-blue-500/40 text-blue-600 bg-blue-500/10 text-[10px] py-0 px-1 font-normal shrink-0">
                    平级 Tier 1000
                  </Badge>
                )}
                {ref.tier === 'fallback' && (
                  <Badge variant="outline" className="border-slate-500/40 text-slate-600 bg-slate-500/10 text-[10px] py-0 px-1 font-normal shrink-0">
                    兜底 Tier 2000+
                  </Badge>
                )}
              </div>

              {/* 梯级选择 + 开关 + 排序 + 删除 */}
              <div className="flex items-center gap-1.5 shrink-0 justify-end">
                <Select
                  value={ref.tier}
                  onValueChange={(v) => handleUpdateTier(idx, v as ReferenceTier)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-7 text-xs w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prioritized" className="text-xs">
                      <span className="flex items-center gap-1 text-amber-600 font-medium">
                        <Zap className="h-3 w-3" /> 优先消耗
                      </span>
                    </SelectItem>
                    <SelectItem value="normal" className="text-xs">
                      <span className="flex items-center gap-1 text-blue-600">
                        <Scale className="h-3 w-3" /> 平级合并
                      </span>
                    </SelectItem>
                    <SelectItem value="fallback" className="text-xs">
                      <span className="flex items-center gap-1 text-slate-500">
                        <Shield className="h-3 w-3" /> 备用兜底
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>

                {/* 启用/暂停 Switch */}
                <div className="flex items-center gap-1 px-1">
                  <Switch
                    checked={ref.enabled}
                    onCheckedChange={(checked) => handleToggleEnabled(idx, checked)}
                    disabled={disabled}
                    className="scale-75"
                    title={ref.enabled ? '点击暂停借调此分组' : '点击启用借调'}
                  />
                  <span className="text-[10px] text-muted-foreground w-6">
                    {ref.enabled ? '启用' : '暂停'}
                  </span>
                </div>

                {/* 上移下移 */}
                <div className="flex items-center">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => handleMove(idx, 'up')}
                    disabled={disabled || idx === 0}
                    title="上移优先级"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => handleMove(idx, 'down')}
                    disabled={disabled || idx === references.length - 1}
                    title="下移优先级"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>

                {/* 删除按钮 */}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={() => handleRemove(idx)}
                  disabled={disabled}
                  title="移除此引用"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
          暂未引用其他分组，当前仅调度直接绑定本组的凭据。
        </div>
      )}

      {/* 底部添加与说明 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
        {candidateGroups.length > 0 ? (
          <Select value="" onValueChange={handleAdd} disabled={disabled}>
            <SelectTrigger className="h-7 text-xs w-[170px] bg-card">
              <Plus className="h-3.5 w-3.5 mr-1 text-primary" />
              <span>添加借调分组...</span>
            </SelectTrigger>
            <SelectContent>
              {candidateGroups.map((g) => (
                <SelectItem key={g} value={g} className="text-xs">
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-[11px] text-muted-foreground italic">
            已无更多可借调的其他分组
          </span>
        )}

        <div className="text-[10px] text-muted-foreground leading-normal">
          优先：严格优先消耗 | 平级：均分轮询 | 兜底：耗尽才启用
        </div>
      </div>
    </div>
  )
}

function CredentialFilterPanel({
  filter,
  onChange,
  targetGroupName,
  disabled,
}: {
  filter: CredentialFilterCriteria
  onChange: (f: CredentialFilterCriteria) => void
  targetGroupName?: string
  disabled?: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [previewData, setPreviewData] = useState<PreviewFilterResponse | null>(null)
  const [showList, setShowList] = useState(false)

  // 实时防抖预览匹配结果
  useEffect(() => {
    let active = true
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await previewCredentialsFilter({
          filter,
          targetGroup: targetGroupName,
        })
        if (active) {
          setPreviewData(res)
        }
      } catch (err) {
        console.error('预览筛选失败', err)
      } finally {
        if (active) setLoading(false)
      }
    }, 250)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [filter, targetGroupName])

  const updateField = <K extends keyof CredentialFilterCriteria>(
    field: K,
    value: CredentialFilterCriteria[K],
  ) => {
    onChange({
      ...filter,
      [field]: value,
    })
  }

  const hasAnyFilter = useMemo(() => {
    return (
      (filter.expiryWindow && filter.expiryWindow !== 'all') ||
      (filter.subscriptionTitles && filter.subscriptionTitles.length > 0) ||
      (filter.status && filter.status !== 'all') ||
      (filter.credentialTypes && filter.credentialTypes.length > 0) ||
      (filter.saleStatuses && filter.saleStatuses.length > 0) ||
      (filter.authMethods && filter.authMethods.length > 0) ||
      (filter.emailContains && filter.emailContains.trim() !== '') ||
      (filter.sourceChannelContains && filter.sourceChannelContains.trim() !== '') ||
      (filter.groupPresence && filter.groupPresence !== 'all')
    )
  }, [filter])

  const handleReset = () => {
    onChange({})
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Filter className="h-3.5 w-3.5 text-primary" />
          <span>账号筛选字段条件</span>
        </div>
        {hasAnyFilter && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={handleReset}
            disabled={disabled}
          >
            重置所有条件
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
        {/* 临期 / 到期范围 */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            <span>到期 / 临期范围</span>
          </label>
          <Select
            value={filter.expiryWindow || 'all'}
            onValueChange={(v) => updateField('expiryWindow', v === 'all' ? undefined : v)}
            disabled={disabled}
          >
            <SelectTrigger className="h-7 text-xs bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3d" className="text-xs">3天内到期 (推荐)</SelectItem>
              <SelectItem value="1d" className="text-xs">24小时内到期</SelectItem>
              <SelectItem value="7d" className="text-xs">7天内到期</SelectItem>
              <SelectItem value="14d" className="text-xs">14天内到期</SelectItem>
              <SelectItem value="30d" className="text-xs">30天内到期</SelectItem>
              <SelectItem value="expired" className="text-xs">已过期账号</SelectItem>
              <SelectItem value="all" className="text-xs">不限时间</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 账号启用状态 */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">账号启用状态</label>
          <Select
            value={filter.status || 'all'}
            onValueChange={(v) => updateField('status', v === 'all' ? undefined : v)}
            disabled={disabled}
          >
            <SelectTrigger className="h-7 text-xs bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">不限</SelectItem>
              <SelectItem value="active" className="text-xs">仅正常 (未禁用)</SelectItem>
              <SelectItem value="disabled" className="text-xs">仅已禁用</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 订阅等级 */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">订阅等级 (可模糊)</label>
          <Input
            placeholder="如 PRO, FREE, STUDENT"
            value={filter.subscriptionTitles?.[0] || ''}
            onChange={(e) =>
              updateField(
                'subscriptionTitles',
                e.target.value.trim() ? [e.target.value.trim()] : undefined,
              )
            }
            className="h-7 text-xs bg-card"
            disabled={disabled}
          />
        </div>

        {/* 账号运营类型 */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">账号分类</label>
          <Select
            value={filter.credentialTypes?.[0] || 'all'}
            onValueChange={(v) =>
              updateField('credentialTypes', v === 'all' ? undefined : [v])
            }
            disabled={disabled}
          >
            <SelectTrigger className="h-7 text-xs bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">不限</SelectItem>
              <SelectItem value="normal" className="text-xs">正常号 (normal)</SelectItem>
              <SelectItem value="boom" className="text-xs">炸弹号 (boom)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 在售状态 */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">销售状态</label>
          <Select
            value={filter.saleStatuses?.[0] || 'all'}
            onValueChange={(v) =>
              updateField('saleStatuses', v === 'all' ? undefined : [v])
            }
            disabled={disabled}
          >
            <SelectTrigger className="h-7 text-xs bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">不限</SelectItem>
              <SelectItem value="not_for_sale" className="text-xs">非卖品 (not_for_sale)</SelectItem>
              <SelectItem value="for_sale" className="text-xs">在售 (for_sale)</SelectItem>
              <SelectItem value="sold" className="text-xs">已售 (sold)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 现有分组状态 */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">分组归属状态</label>
          <Select
            value={filter.groupPresence || 'all'}
            onValueChange={(v) => updateField('groupPresence', v === 'all' ? undefined : v)}
            disabled={disabled}
          >
            <SelectTrigger className="h-7 text-xs bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">不限</SelectItem>
              <SelectItem value="unassigned" className="text-xs">未分配任何分组的账号</SelectItem>
              <SelectItem value="has_group" className="text-xs">已有分配分组的账号</SelectItem>
              {targetGroupName && (
                <SelectItem value="not_in_group" className="text-xs">
                  尚未归入当前分组的账号
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* 认证方式 */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">认证方式</label>
          <Select
            value={filter.authMethods?.[0] || 'all'}
            onValueChange={(v) =>
              updateField('authMethods', v === 'all' ? undefined : [v])
            }
            disabled={disabled}
          >
            <SelectTrigger className="h-7 text-xs bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">不限</SelectItem>
              <SelectItem value="social" className="text-xs">Social</SelectItem>
              <SelectItem value="idc" className="text-xs">IdC / Enterprise</SelectItem>
              <SelectItem value="external_idp" className="text-xs">企业 SSO (Entra ID)</SelectItem>
              <SelectItem value="api_key" className="text-xs">Kiro API Key</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 邮箱模糊匹配 */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">邮箱关键字</label>
          <Input
            placeholder="例如：@example.com 或 关键字"
            value={filter.emailContains || ''}
            onChange={(e) => updateField('emailContains', e.target.value.trim() || undefined)}
            className="h-7 text-xs bg-card"
            disabled={disabled}
          />
        </div>

        {/* 来源渠道包含 */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">来源渠道备注</label>
          <Input
            placeholder="渠道备注关键字"
            value={filter.sourceChannelContains || ''}
            onChange={(e) =>
              updateField('sourceChannelContains', e.target.value.trim() || undefined)
            }
            className="h-7 text-xs bg-card"
            disabled={disabled}
          />
        </div>
      </div>

      {/* 实时匹配预览结果条 */}
      <div className="rounded border bg-card p-2 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">实时匹配：</span>
          {loading ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> 计算中...
            </span>
          ) : (
            <span className="font-medium text-foreground">
              符合条件账号{' '}
              <strong className="text-primary font-mono tabular-nums">
                {previewData?.matchedCount ?? 0}
              </strong>{' '}
              个
              <span className="text-muted-foreground font-normal ml-1">
                (系统凭据总数 {previewData?.totalCount ?? 0} 个)
              </span>
            </span>
          )}
        </div>

        {(previewData?.matchedCount ?? 0) > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-primary"
            onClick={() => setShowList((prev) => !prev)}
          >
            {showList ? '收起明细' : '查看明细列表'}
          </Button>
        )}
      </div>

      {/* 展开的匹配明细列表 */}
      {showList && previewData && previewData.credentials.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded border bg-card/60 p-1.5 text-xs space-y-1">
          {previewData.credentials.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 p-1 rounded hover:bg-muted/40 font-mono text-[11px]"
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-muted-foreground">#{c.id}</span>
                <span className="font-sans font-medium text-foreground truncate">
                  {c.email || '未命名邮箱'}
                </span>
                {c.subscriptionTitle && (
                  <Badge variant="secondary" className="text-[10px] py-0 px-1 font-normal">
                    {c.subscriptionTitle}
                  </Badge>
                )}
                {c.groups && c.groups.length > 0 && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    [{c.groups.join(', ')}]
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
                <span>{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '无到期日'}</span>
                {c.disabled && <Badge variant="destructive" className="text-[9px] py-0 px-1">已禁用</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GroupFilterAssignDialog({
  open,
  onOpenChange,
  group,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: GroupItem | null
  onSuccess: () => void
}) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<CredentialFilterCriteria>({
    expiryWindow: '3d', // 默认推荐 3 天内到期
  })
  const [mode, setMode] = useState<AssignMode>('append')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setFilter({ expiryWindow: '3d' })
      setMode('append')
    }
  }, [open])

  if (!group) return null

  const handleApply = async () => {
    setSubmitting(true)
    try {
      const res = await assignGroupCredentialsByFilter(group.name, {
        filter,
        mode,
      })
      toast.success(
        `已成功为分组 [${group.name}] 归入 ${res.matchedCount} 个凭据 (更新了 ${res.updatedCount} 处变更)`
      )
      await queryClient.invalidateQueries({ queryKey: ['groups'] })
      await queryClient.invalidateQueries({ queryKey: ['credentials'] })
      onOpenChange(false)
      onSuccess()
    } catch (e) {
      toast.error(extractErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            <span>按字段条件筛选归入账号：{group.name}</span>
          </DialogTitle>
          <DialogDescription>
            批量搜索符合条件的账号并将其自动归入到分组「{group.name}」中。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <CredentialFilterPanel
            filter={filter}
            onChange={setFilter}
            targetGroupName={group.name}
            disabled={submitting}
          />

          {/* 归入模式选择 */}
          <div className="space-y-1.5 pt-1">
            <label className="text-xs font-medium text-foreground">归入模式</label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === 'append' ? 'default' : 'outline'}
                className="text-xs justify-start h-auto py-2 px-2.5 flex flex-col items-start gap-0.5 text-left"
                onClick={() => setMode('append')}
                disabled={submitting}
              >
                <div className="font-semibold flex items-center gap-1">
                  {mode === 'append' && <Check className="h-3 w-3" />}
                  <span>追加归入 (推荐)</span>
                </div>
                <span className="text-[10px] opacity-80 font-normal">
                  将匹配的账号加入该分组，已有账号与原有分组不受影响
                </span>
              </Button>

              <Button
                type="button"
                size="sm"
                variant={mode === 'replace' ? 'default' : 'outline'}
                className="text-xs justify-start h-auto py-2 px-2.5 flex flex-col items-start gap-0.5 text-left"
                onClick={() => setMode('replace')}
                disabled={submitting}
              >
                <div className="font-semibold flex items-center gap-1">
                  {mode === 'replace' && <Check className="h-3 w-3" />}
                  <span>覆盖归入</span>
                </div>
                <span className="text-[10px] opacity-80 font-normal">
                  重置此分组，仅保留符合本次条件的账号
                </span>
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleApply} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                正在归入...
              </>
            ) : (
              '确认执行归入'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 分组管理页：CRUD 已注册分组。
 *
 * 设计要点：
 * - 统一使用 ConsoleTable 密集型表格展示
 * - 支持批量选择与 BulkBar 批量删除（自动检测引用并支持级联清理）
 * - 改名走级联（后端自动同步所有引用）
 * - 单项删除与批量删除均做引用前置检查
 */
export function GroupsPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(10)
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearch = useDeferredValue(searchQuery)

  useEffect(() => {
    setPage(1)
  }, [deferredSearch])

  const groupQueryParams = useMemo<GroupQueryParams>(() => ({
    page,
    pageSize: pageSize === 0 ? 0 : pageSize,
    search: deferredSearch.trim() || undefined,
  }), [page, pageSize, deferredSearch])

  const { data, isLoading, isFetching, refetch } = useGroups(groupQueryParams)
  const allGroupOptions = useGroupOptions()
  const createGroup = useCreateGroup()
  const updateGroup = useUpdateGroup()
  const deleteGroup = useDeleteGroup()
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  const [selectedNames, setSelectedNames] = useState<Set<number | string>>(new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createCreditMode, setCreateCreditMode] = useState<'inherit' | 'enabled' | 'disabled'>('inherit')
  const [createCreditPrice, setCreateCreditPrice] = useState('')
  const [createCacheMode, setCreateCacheMode] = useState<'inherit' | 'custom' | 'disabled'>('inherit')
  const [createCacheRatio, setCreateCacheRatio] = useState('80')
  const [createReferences, setCreateReferences] = useState<GroupReference[]>([])
  const [createFilterEnabled, setCreateFilterEnabled] = useState(false)
  const [createFilter, setCreateFilter] = useState<CredentialFilterCriteria>({ expiryWindow: '3d' })

  const [filterAssignTarget, setFilterAssignTarget] = useState<GroupItem | null>(null)
  const [filterAssignOpen, setFilterAssignOpen] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<GroupItem | null>(null)
  const [editNewName, setEditNewName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editCreditMode, setEditCreditMode] = useState<'inherit' | 'enabled' | 'disabled'>('inherit')
  const [editCreditPrice, setEditCreditPrice] = useState('')
  const [editCacheMode, setEditCacheMode] = useState<'inherit' | 'custom' | 'disabled'>('inherit')
  const [editCacheRatio, setEditCacheRatio] = useState('80')
  const [editReferences, setEditReferences] = useState<GroupReference[]>([])

  const [batchDeleting, setBatchDeleting] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState<{ current: number; total: number } | null>(null)

  const isServerPaginated = data?.filteredTotal !== undefined

  const clientFilteredGroups = useMemo(() => {
    if (isServerPaginated) return data?.groups ?? []
    let list = data?.groups ?? []
    const q = deferredSearch.trim().toLowerCase()
    if (q) {
      list = list.filter((g) =>
        g.name.toLowerCase().includes(q) ||
        (g.description?.toLowerCase().includes(q) ?? false)
      )
    }
    return list
  }, [isServerPaginated, data?.groups, deferredSearch])

  const totalFilteredCount = isServerPaginated
    ? (data?.filteredTotal ?? data?.groups?.length ?? 0)
    : clientFilteredGroups.length

  const effectivePageSize = pageSize === 0 ? Math.max(totalFilteredCount, 1) : pageSize
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / effectivePageSize))

  const groups = useMemo(() => {
    if (isServerPaginated) return data?.groups ?? []
    const start = (page - 1) * effectivePageSize
    return clientFilteredGroups.slice(start, start + effectivePageSize)
  }, [isServerPaginated, data?.groups, clientFilteredGroups, page, effectivePageSize])

  const openCreate = () => {
    setCreateName('')
    setCreateDesc('')
    setCreateCreditMode('inherit')
    setCreateCreditPrice('')
    setCreateCacheMode('inherit')
    setCreateCacheRatio('80')
    setCreateReferences([])
    setCreateFilterEnabled(false)
    setCreateFilter({ expiryWindow: '3d' })
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    const name = createName.trim()
    if (!name) {
      toast.error('分组名不能为空')
      return
    }
    const priceNum = createCreditPrice.trim() !== '' ? Number(createCreditPrice.trim()) : undefined
    if (createCreditPrice.trim() !== '' && (!Number.isFinite(priceNum) || (priceNum as number) < 0)) {
      toast.error('每积分单价必须是非负数')
      return
    }
    const cacheRatioNum = Number(createCacheRatio)
    if (createCreditMode === 'enabled' && createCacheMode === 'custom' && (!Number.isFinite(cacheRatioNum) || cacheRatioNum <= 0 || cacheRatioNum >= 100)) {
      toast.error('缓存命中率必须在 1% 到 99% 之间')
      return
    }
    try {
      await createGroup.mutateAsync({
        name,
        description: createDesc.trim() || undefined,
        tokenByCreditEnabled:
          createCreditMode === 'enabled' ? true : createCreditMode === 'disabled' ? false : undefined,
        creditPrice: Number.isFinite(priceNum) ? priceNum : undefined,
        simulatedCacheEnabled:
          createCreditMode === 'enabled'
            ? createCacheMode === 'custom'
              ? true
              : createCacheMode === 'disabled'
              ? false
              : undefined
            : undefined,
        simulatedCacheRatio:
          createCreditMode === 'enabled' && createCacheMode === 'custom' && Number.isFinite(cacheRatioNum)
            ? cacheRatioNum / 100
            : undefined,
        references: createReferences.length > 0 ? createReferences : undefined,
        autoAssignFilter: createFilterEnabled ? createFilter : undefined,
      })
      await queryClient.invalidateQueries({ queryKey: ['credentials'] })
      toast.success(`已创建分组：${name}`)
      setCreateOpen(false)
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const openEdit = (g: GroupItem) => {
    setEditTarget(g)
    setEditNewName(g.name)
    setEditDesc(g.description ?? '')
    setEditCreditMode(
      g.tokenByCreditEnabled === true ? 'enabled' : g.tokenByCreditEnabled === false ? 'disabled' : 'inherit'
    )
    setEditCreditPrice(g.creditPrice != null ? String(g.creditPrice) : '')
    setEditCacheMode(
      g.simulatedCacheEnabled === false
        ? 'disabled'
        : g.simulatedCacheEnabled === true || g.simulatedCacheRatio != null
        ? 'custom'
        : 'inherit'
    )
    setEditCacheRatio(
      g.simulatedCacheRatio != null ? String(Math.round(g.simulatedCacheRatio * 100)) : '80'
    )
    setEditReferences(g.references ? JSON.parse(JSON.stringify(g.references)) : [])
    setEditOpen(true)
  }

  const handleEdit = async () => {
    if (!editTarget) return
    const newName = editNewName.trim()
    if (!newName) {
      toast.error('分组名不能为空')
      return
    }
    const priceNum = editCreditPrice.trim() !== '' ? Number(editCreditPrice.trim()) : undefined
    if (editCreditPrice.trim() !== '' && (!Number.isFinite(priceNum) || (priceNum as number) < 0)) {
      toast.error('每积分单价必须是非负数')
      return
    }
    const cacheRatioNum = Number(editCacheRatio)
    if (editCreditMode === 'enabled' && editCacheMode === 'custom' && (!Number.isFinite(cacheRatioNum) || cacheRatioNum <= 0 || cacheRatioNum >= 100)) {
      toast.error('缓存命中率必须在 1% 到 99% 之间')
      return
    }
    try {
      await updateGroup.mutateAsync({
        name: editTarget.name,
        req: {
          newName: newName !== editTarget.name ? newName : undefined,
          description: editDesc, // 空字符串 → 后端清空
          tokenByCreditEnabled:
            editCreditMode === 'enabled' ? true : editCreditMode === 'disabled' ? false : undefined,
          resetTokenByCredit: editCreditMode === 'inherit' ? true : undefined,
          creditPrice: Number.isFinite(priceNum) ? priceNum : undefined,
          resetCreditPrice: editCreditPrice.trim() === '' ? true : undefined,
          simulatedCacheEnabled:
            editCreditMode === 'disabled'
              ? undefined
              : editCacheMode === 'custom'
              ? true
              : editCacheMode === 'disabled'
              ? false
              : undefined,
          resetSimulatedCache:
            editCreditMode === 'disabled' || editCacheMode === 'inherit' ? true : undefined,
          simulatedCacheRatio:
            editCreditMode !== 'disabled' && editCacheMode === 'custom' && Number.isFinite(cacheRatioNum)
              ? cacheRatioNum / 100
              : undefined,
          resetSimulatedCacheRatio:
            editCreditMode === 'disabled' || editCacheMode !== 'custom' ? true : undefined,
          references: editReferences,
        },
      })
      const renamed = newName !== editTarget.name
      toast.success(renamed ? `已改名：${editTarget.name} → ${newName}` : '分组已更新')
      setEditOpen(false)
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const handleDelete = async (g: GroupItem) => {
    const refs = g.credentialCount + g.clientKeyCount + (g.referencedBy?.length ?? 0)
    // 无引用：单层确认；有引用：二次确认 + force
    if (refs === 0) {
      const ok = await confirm({
        title: `删除分组 ${g.name}？`,
        description: '该分组当前无任何凭据、Key 或其他分组借调，可以安全删除。',
        confirmText: '删除',
        destructive: true,
      })
      if (!ok) return
      try {
        await deleteGroup.mutateAsync({ name: g.name })
        toast.success(`分组 ${g.name} 已删除`)
        setSelectedNames((prev) => {
          const next = new Set(prev)
          next.delete(g.name)
          return next
        })
      } catch (e) {
        toast.error(extractErrorMessage(e))
      }
    } else {
      const parts = []
      if (g.credentialCount > 0) parts.push(`${g.credentialCount} 个凭据`)
      if (g.clientKeyCount > 0) parts.push(`${g.clientKeyCount} 把客户端 Key`)
      if ((g.referencedBy?.length ?? 0) > 0) parts.push(`${g.referencedBy!.length} 个其他分组借调`)
      const ok = await confirm({
        title: `强制删除分组 ${g.name}？`,
        description: `该分组当前正被 ${parts.join(' + ')} 引用。继续将级联清理所有引用（凭据移除该分组，Key 解绑，其他分组删除借调关系）。此操作不可撤销。`,
        confirmText: '强制删除',
        destructive: true,
      })
      if (!ok) return
      try {
        await deleteGroup.mutateAsync({ name: g.name, force: true })
        toast.success(`分组 ${g.name} 已删除，已级联清理所有关联`)
        setSelectedNames((prev) => {
          const next = new Set(prev)
          next.delete(g.name)
          return next
        })
      } catch (e) {
        toast.error(extractErrorMessage(e))
      }
    }
  }

  const handleBatchDelete = async () => {
    if (selectedNames.size === 0) return
    const names = Array.from(selectedNames) as string[]
    const selectedGroups = groups.filter((g) => selectedNames.has(g.name))
    const referencedGroups = selectedGroups.filter(
      (g) => g.credentialCount > 0 || g.clientKeyCount > 0 || (g.referencedBy?.length ?? 0) > 0,
    )
    const totalRefs = selectedGroups.reduce(
      (acc, g) => acc + g.credentialCount + g.clientKeyCount + (g.referencedBy?.length ?? 0),
      0,
    )

    let force = false
    if (referencedGroups.length > 0) {
      const ok = await confirm({
        title: `批量强制删除 ${names.length} 个分组？`,
        description: `选中的分组中，有 ${referencedGroups.length} 个分组正被 ${totalRefs} 处凭据/Key/借调引用。继续将级联清理所有引用（凭据移除分组标签，Key 解绑分组，跨组引用清除）。此操作不可撤销。`,
        confirmText: '强制批量删除',
        destructive: true,
      })
      if (!ok) return
      force = true
    } else {
      const ok = await confirm({
        title: `批量删除 ${names.length} 个分组？`,
        description: `确定要删除选中的 ${names.length} 个分组吗？所选分组当前均无引用。此操作不可撤销。`,
        confirmText: '确认删除',
        destructive: true,
      })
      if (!ok) return
    }

    setBatchDeleting(true)
    setDeleteProgress({ current: 0, total: names.length })
    let successCount = 0
    let failCount = 0

    try {
      for (let i = 0; i < names.length; i++) {
        const name = names[i]
        try {
          await deleteGroup.mutateAsync({ name, force })
          successCount++
        } catch {
          failCount++
        }
        setDeleteProgress({ current: i + 1, total: names.length })
      }
      if (failCount === 0) {
        toast.success(`已批量删除 ${successCount} 个分组`)
      } else {
        toast.warning(`批量删除完成：成功 ${successCount} 个，失败 ${failCount} 个`)
      }
      setSelectedNames(new Set())
    } finally {
      setBatchDeleting(false)
      setDeleteProgress(null)
    }
  }

  const columns: ConsoleColumn<GroupItem>[] = useMemo(
    () => [
      {
        id: 'name',
        header: '分组名称',
        cell: (g) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{g.name}</span>
          </div>
        ),
      },
      {
        id: 'description',
        header: '备注',
        cell: (g) => (
          <span className="text-muted-foreground truncate max-w-[240px] inline-block" title={g.description}>
            {g.description || '—'}
          </span>
        ),
      },
      {
        id: 'credentialCount',
        header: '关联凭据',
        cell: (g) => (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="secondary" className="gap-1 font-mono text-[11px] tabular-nums" title={`直接归属本组的凭据数`}>
              <Users className="h-3 w-3 text-muted-foreground" />
              {g.credentialCount}
            </Badge>
            {g.effectiveCredentialCount !== undefined && g.effectiveCredentialCount !== g.credentialCount && (
              <Badge
                variant="outline"
                className="border-amber-500/40 text-amber-600 bg-amber-500/10 font-mono text-[10px] tabular-nums"
                title={`包含跨组引用去重后的实际可用调度凭据数：${g.effectiveCredentialCount} 个`}
              >
                调度池 {g.effectiveCredentialCount}
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: 'references',
        header: '跨组借调 / 优先级',
        cell: (g) => {
          const hasRefs = g.references && g.references.length > 0
          const hasReferencedBy = g.referencedBy && g.referencedBy.length > 0
          if (!hasRefs && !hasReferencedBy) {
            return <span className="text-xs text-muted-foreground">—</span>
          }
          return (
            <div className="flex flex-col gap-1 max-w-[280px]">
              {hasRefs && (
                <div className="flex flex-wrap items-center gap-1">
                  {g.references!.map((ref, idx) => {
                    const tierColor =
                      ref.tier === 'prioritized'
                        ? 'border-amber-500/40 text-amber-600 bg-amber-500/10'
                        : ref.tier === 'fallback'
                        ? 'border-slate-500/40 text-slate-600 bg-slate-500/10'
                        : 'border-blue-500/40 text-blue-600 bg-blue-500/10'
                    const tierLabel =
                      ref.tier === 'prioritized'
                        ? `优先 #${idx + 1}`
                        : ref.tier === 'fallback'
                        ? '备用兜底'
                        : '平级'
                    return (
                      <Badge
                        key={ref.group}
                        variant="outline"
                        className={`text-[10px] font-normal px-1.5 py-0 gap-0.5 ${tierColor} ${!ref.enabled ? 'opacity-40 line-through' : ''}`}
                        title={`借调分组: ${ref.group} (${tierLabel}${!ref.enabled ? '，已暂停' : ''})`}
                      >
                        {ref.tier === 'prioritized' && <Zap className="h-3 w-3" />}
                        {ref.tier === 'normal' && <Scale className="h-3 w-3" />}
                        {ref.tier === 'fallback' && <Shield className="h-3 w-3" />}
                        <span>{ref.group}</span>
                        <span className="opacity-75 text-[9px]">({tierLabel})</span>
                      </Badge>
                    )
                  })}
                </div>
              )}
              {hasReferencedBy && (
                <div
                  className="text-[10px] text-muted-foreground flex items-center gap-1"
                  title={`被以下分组借调：${g.referencedBy!.join(', ')}`}
                >
                  <span className="font-mono text-muted-foreground/80 shrink-0 flex items-center gap-0.5">
                    <CornerDownRight className="h-3 w-3" />
                    被借调:
                  </span>
                  <span className="truncate max-w-[180px]">{g.referencedBy!.join(', ')}</span>
                </div>
              )}
            </div>
          )
        },
      },
      {
        id: 'clientKeyCount',
        header: '关联 Key',
        cell: (g) => (
          <Badge variant="secondary" className="gap-1 font-mono text-[11px] tabular-nums">
            <KeyRound className="h-3 w-3 text-muted-foreground" />
            {g.clientKeyCount}
          </Badge>
        ),
      },
      {
        id: 'tokenByCredit',
        header: '计费折算',
        cell: (g) => {
          if (g.tokenByCreditEnabled === true) {
            const kPrice = g.creditPrice != null ? +(g.creditPrice * 1000).toFixed(4) : null
            const cacheText =
              g.simulatedCacheEnabled === false
                ? '无缓存拆分'
                : g.simulatedCacheRatio != null
                ? `${Math.round(g.simulatedCacheRatio * 100)}% 缓存`
                : g.simulatedCacheEnabled === true
                ? '模拟缓存'
                : '缓存随全局'
            return (
              <div className="flex flex-col gap-1 items-start">
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 text-emerald-600 bg-emerald-500/10 font-normal"
                  title={
                    g.creditPrice != null
                      ? `专属单价：$${kPrice}/千分 (折合 $${g.creditPrice}/积分)`
                      : '跟随全局单价'
                  }
                >
                  按积分 {kPrice != null ? `($${kPrice}/千分)` : ''}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {cacheText}
                </span>
              </div>
            )
          }
          if (g.tokenByCreditEnabled === false) {
            return <Badge variant="secondary" className="text-muted-foreground font-normal">真实用量</Badge>
          }
          return (
            <div className="flex flex-col gap-0.5 items-start">
              <span className="text-xs text-muted-foreground">跟随全局</span>
              {g.simulatedCacheRatio != null && (
                <span className="text-[10px] text-muted-foreground">
                  缓存 {Math.round(g.simulatedCacheRatio * 100)}%
                </span>
              )}
            </div>
          )
        },
      },
      {
        id: 'createdAt',
        header: '创建时间',
        cell: (g) => (
          <span className="console-num text-[12px] text-muted-foreground">
            {g.createdAt ? new Date(g.createdAt).toLocaleString('zh-CN', { hour12: false }) : '—'}
          </span>
        ),
      },
    ],
    [],
  )

  const rowActions = (g: GroupItem) => (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={(e) => {
          e.stopPropagation()
          setFilterAssignTarget(g)
          setFilterAssignOpen(true)
        }}
        title="按字段条件筛选归入账号"
      >
        <UserPlus className="h-3.5 w-3.5 text-primary" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={(e) => {
          e.stopPropagation()
          openEdit(g)
        }}
        title="编辑"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-destructive hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation()
          handleDelete(g)
        }}
        title="删除"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )

  return (
    <div className="console-scope space-y-4">
      <PageHeader
        breadcrumbs={[{ label: '控制台' }, { label: '分组管理', active: true }]}
        icon={<FolderTree className="h-4 w-4" />}
        title="分组管理"
        description="分组是凭据 / 客户端 Key 共享的独立逻辑实体；改名与删除会自动级联同步。"
        badge={
          <Badge variant="secondary" className="font-mono text-xs">
            {totalFilteredCount} 个分组
          </Badge>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              新建分组
            </Button>
          </>
        }
      />

      <div className="space-y-3">
        {/* 搜索工具栏 */}
        <div className="flex items-center justify-between gap-2.5 rounded-lg border bg-card/50 p-2.5">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索分组名称 / 备注..."
              className="h-8 pl-8 pr-8 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <ConsoleTable
          rows={groups}
          columns={columns}
          rowKey={(g) => g.name}
          selectable
          selected={selectedNames}
          onSelectedChange={setSelectedNames}
          rowActions={rowActions}
          loading={isLoading}
          empty={
            deferredSearch
              ? '当前筛选条件下没有分组。'
              : '暂无分组。点击右上角「新建分组」开始。'
          }
        />

        {/* 分页控制栏 */}
        {totalFilteredCount > 0 && (
          <div className="flex flex-col items-center justify-between gap-3 pt-2 sm:flex-row">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>每页</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v))
                  setPage(1)
                }}
              >
                <SelectTrigger className="h-7 w-[75px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="0">全部</SelectItem>
                </SelectContent>
              </Select>
              <span>条 · 共 {totalFilteredCount} 个分组</span>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                  上一页
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  第 {page} / {totalPages} 页
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  下一页
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 吸底批量操作栏 */}
      <BulkBar
        count={selectedNames.size}
        onClear={() => setSelectedNames(new Set())}
        noun="个分组"
      >
        <Button
          onClick={handleBatchDelete}
          size="sm"
          variant="destructive"
          className="h-8 px-3 text-xs gap-1.5 rounded-full"
          disabled={batchDeleting}
        >
          {batchDeleting && deleteProgress ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              删除中 {deleteProgress.current}/{deleteProgress.total}
            </>
          ) : (
            <>
              <Trash2 className="h-3.5 w-3.5" />
              批量删除
            </>
          )}
        </Button>
      </BulkBar>

      {/* 新建分组弹框 */}
      {createOpen && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>新建分组</DialogTitle>
              <DialogDescription>
                注册后即可在凭据 / 客户端 Key 中选择该分组。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">分组名 *</label>
                <Input
                  placeholder="例如：客户A、生产、备用池"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  disabled={createGroup.isPending}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">备注（可选）</label>
                <Input
                  placeholder="用途说明，方便后续辨认"
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  disabled={createGroup.isPending}
                />
              </div>

              {/* 跨分组借调配置 */}
              <GroupReferencesEditor
                references={createReferences}
                onChange={setCreateReferences}
                allGroupOptions={allGroupOptions}
                disabled={createGroup.isPending}
              />

              {/* 按字段条件自动筛选并归入账号 (可选) */}
              <div className="space-y-2 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <Filter className="h-3.5 w-3.5 text-primary" />
                      <span>自动按条件筛选并归入已有账号</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      创建分组成功后，自动将符合所选条件的现有账号批量加入该分组
                    </p>
                  </div>
                  <Switch
                    checked={createFilterEnabled}
                    onCheckedChange={setCreateFilterEnabled}
                    disabled={createGroup.isPending}
                  />
                </div>

                {createFilterEnabled && (
                  <div className="rounded-lg border bg-muted/20 p-2.5 space-y-2 mt-2">
                    <CredentialFilterPanel
                      filter={createFilter}
                      onChange={setCreateFilter}
                      disabled={createGroup.isPending}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="text-sm font-medium">计费折算模式</label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={createCreditMode === 'inherit' ? 'default' : 'outline'}
                    className="text-xs"
                    onClick={() => setCreateCreditMode('inherit')}
                  >
                    跟随全局
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={createCreditMode === 'enabled' ? 'default' : 'outline'}
                    className="text-xs"
                    onClick={() => setCreateCreditMode('enabled')}
                  >
                    按积分折算
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={createCreditMode === 'disabled' ? 'default' : 'outline'}
                    className="text-xs"
                    onClick={() => setCreateCreditMode('disabled')}
                  >
                    真实用量
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {createCreditMode === 'inherit' && '跟随全局设置：全局开启则换算，全局关闭则返回真实 Token。'}
                  {createCreditMode === 'enabled' && '对此分组强制按积分价值折算 Token 返回给下游平台。'}
                  {createCreditMode === 'disabled' && '对此分组如实返回上游产生的真实 Token 数量。'}
                </p>
              </div>
              {createCreditMode === 'enabled' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">专属计费单价</label>
                    <CreditPriceInput
                      value={createCreditPrice}
                      onChange={setCreateCreditPrice}
                      disabled={createGroup.isPending}
                    />
                  </div>

                  <div className="space-y-2 pt-1 border-t">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">模拟 Prompt 缓存策略</label>
                      <div className="grid grid-cols-3 gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={createCacheMode === 'inherit' ? 'default' : 'outline'}
                          className="text-xs"
                          onClick={() => setCreateCacheMode('inherit')}
                        >
                          跟随全局
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={createCacheMode === 'custom' ? 'default' : 'outline'}
                          className="text-xs"
                          onClick={() => setCreateCacheMode('custom')}
                        >
                          自定义缓存率
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={createCacheMode === 'disabled' ? 'default' : 'outline'}
                          className="text-xs"
                          onClick={() => setCreateCacheMode('disabled')}
                        >
                          禁用缓存模拟
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {createCacheMode === 'inherit' && '沿用全局设置中的模拟缓存开关及命中率配置。'}
                        {createCacheMode === 'custom' && '将输入 Token 按指定比例模拟拆分为普通输入与缓存读取，下游计费总额绝对恒等（0 误差）。'}
                        {createCacheMode === 'disabled' && '不模拟拆分缓存，所有输入用量均作为普通 input_tokens 返回。'}
                      </p>
                    </div>

                    {createCacheMode === 'custom' && (
                      <div className="space-y-1.5 pl-0.5">
                        <label className="text-xs font-medium text-muted-foreground">专属缓存命中率 (%)</label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            max={99}
                            value={createCacheRatio}
                            onChange={(e) => setCreateCacheRatio(e.target.value)}
                            className="w-24 text-xs h-8"
                            disabled={createGroup.isPending}
                          />
                          <span className="text-xs text-muted-foreground">%</span>
                          <div className="flex items-center gap-1">
                            {[50, 70, 80, 90].map((preset) => (
                              <Button
                                key={preset}
                                type="button"
                                size="sm"
                                variant={createCacheRatio === String(preset) ? 'secondary' : 'ghost'}
                                className="h-7 px-2 text-xs"
                                onClick={() => setCreateCacheRatio(String(preset))}
                                disabled={createGroup.isPending}
                              >
                                {preset}%
                              </Button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createGroup.isPending}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={createGroup.isPending || !createName.trim()}>
                {createGroup.isPending ? '创建中…' : '创建'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 编辑分组弹框 */}
      {editOpen && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>编辑分组：{editTarget?.name}</DialogTitle>
              <DialogDescription>
                改名会级联同步所有引用此分组的凭据与客户端 Key。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">分组名</label>
                <Input
                  value={editNewName}
                  onChange={(e) => setEditNewName(e.target.value)}
                  disabled={updateGroup.isPending}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">备注</label>
                <Input
                  placeholder="（清空备注请留空）"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  disabled={updateGroup.isPending}
                />
              </div>

              {/* 跨分组借调配置 */}
              <GroupReferencesEditor
                references={editReferences}
                onChange={setEditReferences}
                currentGroupName={editTarget?.name}
                allGroupOptions={allGroupOptions}
                disabled={updateGroup.isPending}
              />

              <div className="space-y-1.5 pt-1">
                <label className="text-sm font-medium">计费折算模式</label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={editCreditMode === 'inherit' ? 'default' : 'outline'}
                    className="text-xs"
                    onClick={() => setEditCreditMode('inherit')}
                  >
                    跟随全局
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={editCreditMode === 'enabled' ? 'default' : 'outline'}
                    className="text-xs"
                    onClick={() => setEditCreditMode('enabled')}
                  >
                    按积分折算
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={editCreditMode === 'disabled' ? 'default' : 'outline'}
                    className="text-xs"
                    onClick={() => setEditCreditMode('disabled')}
                  >
                    真实用量
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {editCreditMode === 'inherit' && '跟随全局设置：全局开启则换算，全局关闭则返回真实 Token。'}
                  {editCreditMode === 'enabled' && '对此分组强制按积分价值折算 Token 返回给下游平台。'}
                  {editCreditMode === 'disabled' && '对此分组如实返回上游产生的真实 Token 数量。'}
                </p>
              </div>
              {editCreditMode === 'enabled' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">专属计费单价</label>
                    <CreditPriceInput
                      value={editCreditPrice}
                      onChange={setEditCreditPrice}
                      disabled={updateGroup.isPending}
                    />
                  </div>

                  <div className="space-y-2 pt-1 border-t">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">模拟 Prompt 缓存策略</label>
                      <div className="grid grid-cols-3 gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={editCacheMode === 'inherit' ? 'default' : 'outline'}
                          className="text-xs"
                          onClick={() => setEditCacheMode('inherit')}
                        >
                          跟随全局
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={editCacheMode === 'custom' ? 'default' : 'outline'}
                          className="text-xs"
                          onClick={() => setEditCacheMode('custom')}
                        >
                          自定义缓存率
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={editCacheMode === 'disabled' ? 'default' : 'outline'}
                          className="text-xs"
                          onClick={() => setEditCacheMode('disabled')}
                        >
                          禁用缓存模拟
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {editCacheMode === 'inherit' && '沿用全局设置中的模拟缓存开关及命中率配置。'}
                        {editCacheMode === 'custom' && '将输入 Token 按指定比例模拟拆分为普通输入与缓存读取，下游计费总额绝对恒等（0 误差）。'}
                        {editCacheMode === 'disabled' && '不模拟拆分缓存，所有输入用量均作为普通 input_tokens 返回。'}
                      </p>
                    </div>

                    {editCacheMode === 'custom' && (
                      <div className="space-y-1.5 pl-0.5">
                        <label className="text-xs font-medium text-muted-foreground">专属缓存命中率 (%)</label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            max={99}
                            value={editCacheRatio}
                            onChange={(e) => setEditCacheRatio(e.target.value)}
                            className="w-24 text-xs h-8"
                            disabled={updateGroup.isPending}
                          />
                          <span className="text-xs text-muted-foreground">%</span>
                          <div className="flex items-center gap-1">
                            {[50, 70, 80, 90].map((preset) => (
                              <Button
                                key={preset}
                                type="button"
                                size="sm"
                                variant={editCacheRatio === String(preset) ? 'secondary' : 'ghost'}
                                className="h-7 px-2 text-xs"
                                onClick={() => setEditCacheRatio(String(preset))}
                                disabled={updateGroup.isPending}
                              >
                                {preset}%
                              </Button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
              {editTarget && (editTarget.credentialCount > 0 || editTarget.clientKeyCount > 0 || (editTarget.referencedBy?.length ?? 0) > 0) && (
                <p className="text-xs text-amber-600">
                  当前被 {editTarget.credentialCount} 凭据 + {editTarget.clientKeyCount} 客户端 Key + {editTarget.referencedBy?.length ?? 0} 其他分组引用，改名会自动同步。
                </p>
              )}

              {/* 快捷按条件筛选归入账号 */}
              <div className="pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs flex items-center justify-center gap-1.5"
                  onClick={() => {
                    if (editTarget) {
                      setFilterAssignTarget(editTarget)
                      setFilterAssignOpen(true)
                    }
                  }}
                  disabled={updateGroup.isPending}
                >
                  <UserPlus className="h-3.5 w-3.5 text-primary" />
                  <span>按字段条件筛选并归入账号到此分组...</span>
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={updateGroup.isPending}>
                取消
              </Button>
              <Button onClick={handleEdit} disabled={updateGroup.isPending || !editNewName.trim()}>
                {updateGroup.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 历史分组：按字段条件筛选归入弹窗 */}
      <GroupFilterAssignDialog
        open={filterAssignOpen}
        onOpenChange={setFilterAssignOpen}
        group={filterAssignTarget}
        onSuccess={() => {
          refetch()
          queryClient.invalidateQueries({ queryKey: ['credentials'] })
        }}
      />
    </div>
  )
}

