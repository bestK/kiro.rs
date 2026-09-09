import { useState, useEffect, memo } from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  GripVertical,
  Trash2,
  Loader2,
  Pencil,
  LogIn,
  MoreHorizontal,
  RotateCcw,
  Zap,
  ZapOff,
  Wallet,
  Key,
  Flag,
  Copy,
  ScrollText,
  Boxes,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { SubscriptionBadge } from "@/components/subscription-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CredentialMetadataSchema,
  CredentialStatusItem,
  BalanceResponse,
  CredentialSortField,
  SortDir,
} from "@/types/api";
import { maskProxyUrl, extractErrorMessage, formatBalance, cn } from "@/lib/utils";
import {
  useSetDisabled,
  useSetPriority,
  useResetFailure,
  useDeleteCredential,
  useForceRefreshToken,
  useResetSuccessCount,
  useClearThrottle,
} from "@/hooks/use-credentials";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EditCredentialDialog } from "@/components/edit-credential-dialog";
import { UpdateTokenDialog } from "@/components/update-token-dialog";
import { ReloginDialog } from "@/components/relogin-dialog";
import { CredentialFailuresDialog } from "@/components/credential-failures-dialog";
import { AvailableModelsDialog } from "@/components/available-models-dialog";
import { BalanceDialog } from "@/components/balance-dialog";
import { getDisposition } from "@/components/console/credential-state";
import { CredentialLabel } from "@/components/console/credential-label";

interface CredentialTableProps {
  credentials: CredentialStatusItem[];
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelectAll: () => void;
  allSelected: boolean;
  balanceMap: Map<number, BalanceResponse>;
  loadingBalanceIds: Set<number>;
  onRefreshBalance: (id: number) => void | Promise<void>;
  failureStatsMap?: Record<string, { auth: number; throttle: number; other: number }>;
  dragDisabled?: boolean;
  preview?: boolean;
  metadataSchema?: CredentialMetadataSchema;
  sortField?: CredentialSortField;
  sortDir?: SortDir;
  onSort?: (field: CredentialSortField) => void;
}

interface TableSortHeaderProps {
  field: CredentialSortField;
  activeFields?: CredentialSortField[];
  currentField?: CredentialSortField;
  sortDir?: SortDir;
  onSort?: (field: CredentialSortField) => void;
  title?: string;
  className?: string;
  children: React.ReactNode;
}

function TableSortHeader({
  field,
  activeFields,
  currentField,
  sortDir,
  onSort,
  title,
  className,
  children,
}: TableSortHeaderProps) {
  const isMatch = activeFields
    ? activeFields.includes(currentField as CredentialSortField)
    : currentField === field;

  return (
    <th
      className={cn(
        "px-2.5 py-2.5 group select-none transition-colors",
        onSort ? "cursor-pointer hover:bg-muted/80 hover:text-foreground" : "",
        isMatch ? "text-foreground font-bold bg-muted/40" : "",
        className
      )}
      onClick={() => onSort?.(field)}
      title={title || "点击排序（再次点击切换升/降序）"}
    >
      <div className="inline-flex items-center gap-1">
        <span>{children}</span>
        {onSort && (
          <span className="shrink-0 transition-opacity">
            {isMatch ? (
              sortDir === "asc" ? (
                <ArrowUp className="h-3 w-3 text-primary animate-in fade-in duration-150" />
              ) : (
                <ArrowDown className="h-3 w-3 text-primary animate-in fade-in duration-150" />
              )
            ) : (
              <ArrowUpDown className="h-2.5 w-2.5 text-muted-foreground/30 group-hover:text-muted-foreground/80 opacity-0 group-hover:opacity-100 transition-all" />
            )}
          </span>
        )}
      </div>
    </th>
  );
}

function formatLastUsed(lastUsedAt: string | null): string {
  if (!lastUsedAt) return "从未使用";
  const date = new Date(lastUsedAt);
  const diff = Date.now() - date.getTime();
  if (diff < 0) return "刚刚";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function formatCreatedAt(createdAt: string | null | undefined): string {
  if (!createdAt) return "未知";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "未知";
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${m}-${d} ${hh}:${mm}`;
}

export function CredentialTable({
  credentials,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  allSelected,
  balanceMap,
  loadingBalanceIds,
  onRefreshBalance,
  failureStatsMap,
  dragDisabled = false,
  preview = false,
  metadataSchema,
  sortField,
  sortDir,
  onSort,
}: CredentialTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs select-none">
      <table className="w-full text-left border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-muted border-b border-border">
          <tr className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {/* 勾选 & 拖拽 & 序号 */}
            <th className="w-12 min-w-[50px] py-2.5 pl-3 pr-1 text-center">
              <div className="flex items-center justify-center gap-1">
                <Checkbox
                  className="h-3.5 w-3.5 [&_svg]:h-2.5 [&_svg]:w-2.5"
                  checked={allSelected}
                  onCheckedChange={onSelectAll}
                  aria-label="全选当前页"
                  disabled={preview || credentials.length === 0}
                />
              </div>
            </th>

            {/* 账号 / 标识 */}
            <TableSortHeader
              field="name"
              activeFields={["name", "id"]}
              currentField={sortField}
              sortDir={sortDir}
              onSort={onSort}
              className="min-w-[200px]"
              title="点击按账号标识字母排序（再次点击切换升/降序）"
            >
              凭据账号 / 标识
            </TableSortHeader>

            {/* 状态与处置 */}
            <TableSortHeader
              field="status"
              activeFields={["status"]}
              currentField={sortField}
              sortDir={sortDir}
              onSort={onSort}
              className="min-w-[110px]"
              title="点击按运行状态健康度排序"
            >
              运行状态
            </TableSortHeader>

            {/* 并发与 RPM 调度情况 */}
            <TableSortHeader
              field="inFlight"
              activeFields={["inFlight", "currentRpm"]}
              currentField={sortField}
              sortDir={sortDir}
              onSort={onSort}
              className="min-w-[125px]"
              title="点击按当前在途并发数排序（再次点击切换升/降序）"
            >
              <div className="flex items-center gap-1">
                <span>并发与 RPM</span>
                <Zap className="h-3 w-3 text-amber-500" />
              </div>
            </TableSortHeader>

            {/* 调度优先级 */}
            <TableSortHeader
              field="priority"
              activeFields={["priority"]}
              currentField={sortField}
              sortDir={sortDir}
              onSort={onSort}
              className="min-w-[85px]"
              title="点击按调度优先级排序（数值小优先）"
            >
              优先级
            </TableSortHeader>

            {/* 成功 / 失败 */}
            <TableSortHeader
              field="successCount"
              activeFields={["successCount", "totalFailureCount"]}
              currentField={sortField}
              sortDir={sortDir}
              onSort={onSort}
              className="min-w-[105px]"
              title="点击按成功调用次数排序"
            >
              调用统计
            </TableSortHeader>

            {/* 余额 / 配额 */}
            <TableSortHeader
              field="balance"
              activeFields={["balance"]}
              currentField={sortField}
              sortDir={sortDir}
              onSort={onSort}
              className="min-w-[130px]"
              title="点击按剩余余额 / 可用额度排序"
            >
              余额 / 配额
            </TableSortHeader>

            {/* 路由 / 代理 */}
            <th className="min-w-[105px] px-2.5 py-2.5">
              路由 / 代理
            </th>

            {/* 时间 */}
            <TableSortHeader
              field="lastUsedAt"
              activeFields={["lastUsedAt", "createdAt"]}
              currentField={sortField}
              sortDir={sortDir}
              onSort={onSort}
              className="min-w-[100px]"
              title="点击按最近活跃使用时间排序"
            >
              活跃时间
            </TableSortHeader>

            {/* 操作 */}
            <th className="min-w-[135px] py-2.5 pl-2.5 pr-4 text-right">
              操作
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-border/50">
          {credentials.map((credential) => (
            <CredentialTableRow
              key={credential.id}
              credential={credential}
              selected={selectedIds.has(credential.id)}
              onToggleSelect={onToggleSelect}
              balance={
                balanceMap.get(credential.id) ||
                credential.balance ||
                null
              }
              loadingBalance={loadingBalanceIds.has(credential.id)}
              onRefreshBalance={onRefreshBalance}
              failureStats={failureStatsMap?.[String(credential.id)]}
              dragDisabled={dragDisabled}
              preview={preview}
              metadataSchema={metadataSchema}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface CredentialTableRowProps {
  credential: CredentialStatusItem;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  balance: BalanceResponse | null;
  loadingBalance: boolean;
  onRefreshBalance: (id: number) => void | Promise<void>;
  failureStats?: { auth: number; throttle: number; other: number };
  dragDisabled?: boolean;
  preview?: boolean;
  metadataSchema?: CredentialMetadataSchema;
}

function CredentialTableRowComponent({
  credential,
  selected,
  onToggleSelect,
  balance,
  loadingBalance,
  onRefreshBalance,
  failureStats,
  dragDisabled = false,
  preview = false,
}: CredentialTableRowProps) {
  const setDisabled = useSetDisabled();
  const setPriority = useSetPriority();
  const resetFailure = useResetFailure();
  const deleteCredential = useDeleteCredential();
  const forceRefresh = useForceRefreshToken();
  const resetSuccess = useResetSuccessCount();
  const clearThrottle = useClearThrottle();

  const [editingPriority, setEditingPriority] = useState(false);
  const [priorityValue, setPriorityValue] = useState(String(credential.priority));

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showUpdateTokenDialog, setShowUpdateTokenDialog] = useState(false);
  const [showReloginDialog, setShowReloginDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showFailuresDialog, setShowFailuresDialog] = useState(false);
  const [showAvailableModelsDialog, setShowAvailableModelsDialog] = useState(false);
  const [showBalanceDialog, setShowBalanceDialog] = useState(false);

  // 429 冷却倒计时实时递减
  const initialThrottleRemaining = credential.throttledRemainingSecs ?? 0;
  const [throttleRemaining, setThrottleRemaining] = useState(initialThrottleRemaining);

  useEffect(() => {
    setThrottleRemaining(credential.throttledRemainingSecs ?? 0);
  }, [credential.throttledRemainingSecs]);

  useEffect(() => {
    if (throttleRemaining <= 0) return;
    const timer = setInterval(() => {
      setThrottleRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [throttleRemaining]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: credential.id,
    disabled: dragDisabled || preview,
  });

  const rowStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleToggleDisabled = () => {
    if (preview) return;
    const willEnable = credential.disabled;
    setDisabled.mutate(
      { id: credential.id, disabled: !credential.disabled },
      {
        onSuccess: (res) => {
          toast.success(res.message);
          if (willEnable) onRefreshBalance(credential.id);
        },
        onError: (err) => toast.error("操作失败: " + (err as Error).message),
      },
    );
  };

  const handlePriorityChange = () => {
    const np = parseInt(priorityValue, 10);
    if (isNaN(np) || np < 0) {
      toast.error("优先级要填 0 或更大的整数，0 最先被使用");
      return;
    }
    setPriority.mutate(
      { id: credential.id, priority: np },
      {
        onSuccess: (res) => {
          toast.success(res.message);
          setEditingPriority(false);
        },
        onError: (err) => toast.error("操作失败: " + (err as Error).message),
      },
    );
  };

  const handleResetSuccess = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (preview) return;
    resetSuccess.mutate(credential.id, {
      onSuccess: (res) => toast.success(res.message),
      onError: (err) => toast.error("重置失败: " + (err as Error).message),
    });
  };

  const handleClearThrottle = () => {
    if (preview) return;
    clearThrottle.mutate(credential.id, {
      onSuccess: (res) => {
        toast.success(res.message);
        setThrottleRemaining(0);
      },
      onError: (err) => toast.error("解除失败: " + (err as Error).message),
    });
  };

  const handleForceRefresh = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (preview) return;
    forceRefresh.mutate(credential.id, {
      onSuccess: (res) => toast.success(res.message),
      onError: (err) => toast.error("刷新失败: " + extractErrorMessage(err)),
    });
  };

  const handleRefreshBalanceClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (preview) return;
    onRefreshBalance(credential.id);
  };

  const handleDelete = () => {
    if (preview) return;
    deleteCredential.mutate(credential.id, {
      onSuccess: (res) => {
        toast.success(res.message);
        setShowDeleteDialog(false);
      },
      onError: (err) => toast.error("删除失败: " + (err as Error).message),
    });
  };

  const disposition = getDisposition(credential, balance, throttleRemaining);

  const isThrottled = !credential.disabled && throttleRemaining > 0;

  const authLabel = (() => {
    if (credential.authMethod === "api_key") return "API Key";
    const provider = credential.provider?.toLowerCase();
    if (credential.authMethod === "social") {
      if (provider === "github") return "GitHub";
      if (provider === "google") return "Google";
      return "Social";
    }
    if (credential.authMethod === "idc") {
      if (provider === "enterprise") return "Enterprise";
      if (provider === "iam_sso") return "IAM SSO";
      if (provider === "builderid") return "Builder ID";
      return "IdC";
    }
    return credential.authMethod || "OAuth";
  })();

  const groups = credential.groups ?? [];

  return (
    <>
      <tr
        ref={setNodeRef}
        style={rowStyle}
        className={cn(
          "group transition-colors h-[48px]",
          selected ? "bg-primary/6 dark:bg-primary/10" : "hover:bg-muted/40",
          isDragging && "opacity-75 bg-muted/60 shadow-md",
          credential.disabled && "opacity-60 bg-muted/20",
        )}
      >
        {/* Checkbox / Drag Handle / ID */}
        <td className="py-1.5 pl-3 pr-1 text-center whitespace-nowrap">
          <div className="flex items-center justify-center gap-1">
            {!dragDisabled && !preview && (
              <button
                type="button"
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-foreground transition-colors p-0.5"
                title="拖拽排序优先级"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
            )}
            <Checkbox
              className="h-3.5 w-3.5 [&_svg]:h-2.5 [&_svg]:w-2.5"
              checked={selected}
              onCheckedChange={() => onToggleSelect(credential.id)}
              disabled={preview}
            />
          </div>
        </td>

        {/* 凭据信息 / 账号标识 (双行紧凑换行) */}
        <td className="px-2.5 py-1.5 min-w-[200px] max-w-[260px]">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-[10px] text-muted-foreground/70 font-semibold shrink-0">
                #{credential.id}
              </span>
              <div className="truncate font-mono text-xs font-semibold text-foreground">
                <CredentialLabel
                  id={credential.id}
                  email={credential.email}
                  showId={false}
                  className="truncate"
                />
              </div>
            </div>

            <div className="flex items-center gap-1 flex-wrap overflow-hidden">
              <SubscriptionBadge
                title={balance?.subscriptionTitle ?? credential.subscriptionTitle}
                className="text-[10px] py-0 px-1 h-4"
              />
              <span className="inline-flex items-center text-[10px] font-medium text-muted-foreground/80 bg-muted/60 px-1 rounded h-4">
                {authLabel}
              </span>
              {groups.map((g) => (
                <span
                  key={g}
                  title="账号分组"
                  className="inline-flex items-center rounded bg-secondary/80 px-1 text-[10px] font-medium text-secondary-foreground h-4"
                >
                  {g}
                </span>
              ))}
              {credential.sourceChannel && (
                <span
                  title="渠道备注"
                  className="text-[10px] text-muted-foreground/60 truncate max-w-[70px]"
                >
                  {credential.sourceChannel}
                </span>
              )}
            </div>
          </div>
        </td>

        {/* 运行状态 (双行：状态标签 + 429 倒计时/原因) */}
        <td className="px-2.5 py-1.5 min-w-[110px] whitespace-nowrap">
          <div className="flex flex-col gap-0.5">
            <div>
              {credential.disabled ? (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-muted-foreground/30 text-muted-foreground bg-muted/40 font-normal">
                  已禁用
                </Badge>
              ) : isThrottled ? (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 font-mono animate-pulse">
                  429 风控
                </Badge>
              ) : credential.failureCount > 0 ? (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                  失败 x{credential.failureCount}
                </Badge>
              ) : (
                <Badge variant="success" className="text-[10px] px-1.5 py-0 h-4 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-normal">
                  正常
                </Badge>
              )}
            </div>

            <div className="text-[10px] font-mono text-muted-foreground truncate">
              {isThrottled ? (
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  冷却 {throttleRemaining}s
                </span>
              ) : credential.disabled ? (
                <span title={credential.disabledReason}>
                  {credential.disabledReason === "QuotaExceeded"
                    ? "超额禁用"
                    : credential.disabledReason === "Manual"
                      ? "手动禁用"
                      : credential.disabledReason || "原因未知"}
                </span>
              ) : (
                <span className="text-emerald-600/80 dark:text-emerald-400/80">
                  健康就绪
                </span>
              )}
            </div>
          </div>
        </td>

        {/* 并发与 RPM 调度情况 (双行：在途请求 + 滑动窗口 RPM) */}
        <td className="px-2.5 py-1.5 min-w-[125px] whitespace-nowrap">
          <div className="flex flex-col gap-0.5">
            {/* 在途并发 */}
            <div className="flex items-center gap-1">
              {(credential.inFlight ?? 0) > 0 ? (
                <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/15 dark:bg-amber-500/25 px-1.5 py-0 rounded h-4 animate-pulse">
                  <Zap className="h-2.5 w-2.5 fill-current" />
                  {credential.inFlight} 在途
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground/60">
                  <ZapOff className="h-2.5 w-2.5 opacity-40" />
                  0 在途
                </span>
              )}
            </div>

            {/* RPM 频次 */}
            <div className="text-[10px] font-mono tabular-nums text-muted-foreground flex items-center gap-1">
              {credential.rpmLimit ? (
                <span
                  className={
                    (credential.currentRpm ?? 0) >= credential.rpmLimit * 0.8
                      ? "text-amber-600 dark:text-amber-400 font-semibold"
                      : ""
                  }
                  title={`单账号 RPM 限流：当前 60 秒请求 ${credential.currentRpm ?? 0}，上限 ${credential.rpmLimit}`}
                >
                  {credential.currentRpm ?? 0}/{credential.rpmLimit} RPM
                </span>
              ) : (
                <span title="近 60 秒请求频次">
                  {credential.currentRpm ?? 0} req/m
                </span>
              )}
            </div>
          </div>
        </td>

        {/* 优先级 (双行：优先级按钮 + 当前优先指示) */}
        <td className="px-2.5 py-1.5 min-w-[85px] whitespace-nowrap">
          <div className="flex flex-col gap-0.5">
            {editingPriority ? (
              <div className="flex items-center gap-0.5">
                <Input
                  type="number"
                  value={priorityValue}
                  onChange={(e) => setPriorityValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handlePriorityChange();
                    if (e.key === "Escape") {
                      setEditingPriority(false);
                      setPriorityValue(String(credential.priority));
                    }
                  }}
                  className="h-5 w-12 text-center text-xs font-mono p-0"
                  min="0"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handlePriorityChange}
                  className="text-xs text-emerald-600 font-bold px-1"
                >
                  ✓
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (!preview) setEditingPriority(true);
                }}
                className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-foreground hover:text-primary transition-colors text-left"
                title="点击修改优先级（数字越小越先被使用）"
              >
                #{credential.priority}
                <Pencil className="h-2.5 w-2.5 opacity-40 hover:opacity-100" />
              </button>
            )}

            <div>
              {credential.isCurrent ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium font-mono">
                  <Flag className="h-2.5 w-2.5 fill-current" />
                  当前调度
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground/50 font-mono">
                  顺序排队
                </span>
              )}
            </div>
          </div>
        </td>

        {/* 调用统计 (双行：成功次数 + 失败明细) */}
        <td className="px-2.5 py-1.5 min-w-[105px] whitespace-nowrap">
          <div className="flex flex-col gap-0.5">
            <div>
              <button
                type="button"
                onClick={handleResetSuccess}
                disabled={preview}
                className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors group"
                title="点击重置成功次数"
              >
                <span>✓ {credential.successCount}</span>
                <RotateCcw className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
              </button>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowFailuresDialog(true)}
                className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                title="鉴权失败 / 429 风控 / 其他。点击查看日志"
              >
                {failureStats ? (
                  <span>
                    <span className="text-destructive font-medium">{failureStats.auth}</span>
                    <span className="opacity-40">/</span>
                    <span className="text-amber-500 font-medium">{failureStats.throttle}</span>
                    <span className="opacity-40">/</span>
                    <span>{failureStats.other}</span>
                  </span>
                ) : (
                  <span className={credential.totalFailureCount > 0 ? "text-destructive font-medium" : ""}>
                    ✗ {credential.totalFailureCount} 失败
                  </span>
                )}
                <ScrollText className="h-2.5 w-2.5 opacity-50" />
              </button>
            </div>
          </div>
        </td>

        {/* 余额 / 配额 (双行：金额 + 迷你进度条) */}
        <td className="px-2.5 py-1.5 min-w-[130px] whitespace-nowrap">
          {loadingBalance ? (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>查询中…</span>
            </div>
          ) : balance ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-1 text-xs font-mono">
                <span
                  className={`font-semibold ${
                    balance.remaining < 0
                      ? "text-red-600 dark:text-red-400"
                      : balance.remaining === 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {balance.remaining < 0
                    ? `-$${formatBalance(balance.remaining)}`
                    : `$${formatBalance(balance.remaining)}`}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {balance.usagePercentage.toFixed(0)}%
                </span>
              </div>
              <Progress
                value={balance.usagePercentage}
                className="h-1.5 w-24 bg-muted"
              />
            </div>
          ) : (
            <div className="flex flex-col">
              <span className="text-[11px] text-muted-foreground/60">未查询余额</span>
              <button
                type="button"
                onClick={handleRefreshBalanceClick}
                disabled={credential.disabled}
                className="text-[10px] text-primary/70 hover:text-primary text-left"
              >
                点击获取
              </button>
            </div>
          )}
        </td>

        {/* 路由 / 代理 (双行：端点名 + 代理地址) */}
        <td className="px-2.5 py-1.5 min-w-[105px] whitespace-nowrap">
          <div className="flex flex-col gap-0.5">
            <div className="text-xs font-mono font-medium text-foreground truncate max-w-[100px]" title={credential.endpoint}>
              {credential.endpoint}
            </div>
            <div className="text-[10px] text-muted-foreground/80 truncate max-w-[100px]" title={credential.proxyUrl}>
              {credential.hasProxy ? maskProxyUrl(credential.proxyUrl ?? "") : "直连"}
            </div>
          </div>
        </td>

        {/* 活跃时间 (双行：上次使用 + 创建时间) */}
        <td className="px-2.5 py-1.5 min-w-[100px] whitespace-nowrap">
          <div className="flex flex-col gap-0.5">
            <div className="text-xs text-foreground/90">
              {formatLastUsed(credential.lastUsedAt)}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground/60">
              {formatCreatedAt(credential.createdAt)}
            </div>
          </div>
        </td>

        {/* 操作快捷按钮组 */}
        <td className="py-1.5 pl-2.5 pr-4 min-w-[135px] text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-1">
            {/* 处置动作优先按钮 (如解除冷却) */}
            {disposition.action === "clearThrottle" && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-1.5 text-[11px] text-amber-600 border-amber-500/40 hover:bg-amber-500/10"
                onClick={handleClearThrottle}
                disabled={clearThrottle.isPending}
                title="立即解除 429 冷却"
              >
                解除
              </Button>
            )}

            {/* 刷新 Token */}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleForceRefresh}
              disabled={
                forceRefresh.isPending ||
                credential.disabled ||
                credential.authMethod === "api_key"
              }
              title={
                credential.authMethod === "api_key"
                  ? "API Key 无需刷新"
                  : credential.disabled
                    ? "已禁用"
                    : "强制刷新 Token"
              }
            >
              <RefreshCw
                className={`h-3 w-3 ${forceRefresh.isPending ? "animate-spin text-primary" : ""}`}
              />
            </Button>

            {/* 查余额 */}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleRefreshBalanceClick}
              disabled={loadingBalance || credential.disabled}
              title={credential.disabled ? "已禁用" : "刷新余额"}
            >
              {loadingBalance ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Wallet className="h-3 w-3" />
              )}
            </Button>

            {/* 编辑 */}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setShowEditDialog(true)}
              title="编辑凭据"
            >
              <Pencil className="h-3 w-3" />
            </Button>

            {/* 启用/禁用 Switch */}
            <Switch
              checked={!credential.disabled}
              onCheckedChange={handleToggleDisabled}
              disabled={preview || setDisabled.isPending}
              title={credential.disabled ? "点击启用" : "点击禁用"}
              className="scale-75 origin-center"
            />

            {/* 更多菜单 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 text-xs">
                {credential.maskedApiKey && (
                  <DropdownMenuItem
                    onClick={() => {
                      navigator.clipboard.writeText(credential.maskedApiKey ?? "");
                      toast.success("已复制脱敏 API Key");
                    }}
                  >
                    <Copy className="mr-2 h-3.5 w-3.5" />
                    复制 Key
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setShowBalanceDialog(true)}>
                  <Wallet className="mr-2 h-3.5 w-3.5" />
                  查看余额详情
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowAvailableModelsDialog(true)}>
                  <Boxes className="mr-2 h-3.5 w-3.5" />
                  可用模型诊断
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowFailuresDialog(true)}>
                  <ScrollText className="mr-2 h-3.5 w-3.5" />
                  失败调用记录
                </DropdownMenuItem>

                {credential.authMethod !== "api_key" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setShowUpdateTokenDialog(true)}>
                      <Key className="mr-2 h-3.5 w-3.5" />
                      手动更新 Token
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setShowReloginDialog(true)}>
                      <LogIn className="mr-2 h-3.5 w-3.5" />
                      重新授权登录
                    </DropdownMenuItem>
                  </>
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => resetFailure.mutate(credential.id)}
                  disabled={resetFailure.isPending}
                >
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                  清空连续失败
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  删除凭据
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </td>
      </tr>

      {/* 弹窗层 */}
      <EditCredentialDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        credential={credential}
      />
      {showUpdateTokenDialog && (
        <UpdateTokenDialog
          open={showUpdateTokenDialog}
          onOpenChange={setShowUpdateTokenDialog}
          credential={credential}
        />
      )}
      {showReloginDialog && (
        <ReloginDialog
          open={showReloginDialog}
          onOpenChange={setShowReloginDialog}
          credential={credential}
        />
      )}
      {showFailuresDialog && (
        <CredentialFailuresDialog
          open={showFailuresDialog}
          onOpenChange={setShowFailuresDialog}
          credentialId={credential.id}
          email={credential.email}
        />
      )}
      {showAvailableModelsDialog && (
        <AvailableModelsDialog
          open={showAvailableModelsDialog}
          onOpenChange={setShowAvailableModelsDialog}
          credentialId={credential.id}
        />
      )}
      {showBalanceDialog && (
        <BalanceDialog
          open={showBalanceDialog}
          onOpenChange={setShowBalanceDialog}
          credentialId={showBalanceDialog ? credential.id : null}
        />
      )}

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除凭据</DialogTitle>
            <DialogDescription>
              确定要删除凭据 #{credential.id} 吗？此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteCredential.isPending}
            >
              {deleteCredential.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const CredentialTableRow = memo(CredentialTableRowComponent);
