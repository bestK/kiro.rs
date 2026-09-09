//! 账号分组管理（独立实体版）
//!
//! 此模块把"分组"从依附于凭据 / 客户端 Key 的字符串标签，提升为一等实体：
//! - 分组在 `groups.json` 中独立持久化（与 `credentials.json` 同目录）
//! - 凭据 / 客户端 Key 的 `groups`/`group` 字段引用分组**名字**（保持 schema 兼容）
//! - 增删改凭据 / Key 时，校验所引用的每个分组名都已注册（防 typo 漂移）
//! - 改名走级联：自动同步所有引用的凭据与 Key
//!
//! 设计参考 `client_keys.rs` 的 RwLock + JSON 持久化模式。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::Utc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

/// 引用分组的优先级策略（层级）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceTier {
    /// 优先消耗（该分组下所有账号严格优先于宿主账号，默认行为）
    Prioritized,
    /// 平级合并（与宿主账号同级）
    Normal,
    /// 备用兜底（宿主账号全部不可用时才使用）
    Fallback,
}

impl Default for ReferenceTier {
    fn default() -> Self {
        Self::Prioritized
    }
}

fn default_true() -> bool {
    true
}

/// 分组引用项
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupReference {
    /// 被引用的目标分组名
    pub group: String,
    /// 优先级层级：prioritized (默认) / normal / fallback
    #[serde(default)]
    pub tier: ReferenceTier,
    /// 是否启用该引用（默认 true）
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// 单个分组（持久化实体）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    /// 分组名（主键，区分大小写、不允许重名、不允许首尾空白）
    pub name: String,
    /// 备注（可选）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 创建时间（ISO8601）
    pub created_at: String,
    /// 是否开启按积分返回 Token（None 表示继承全局配置）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_by_credit_enabled: Option<bool>,
    /// 该分组 1 积分对应的金额（None 表示继承全局配置）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit_price: Option<f64>,
    /// 是否开启模拟 Prompt 缓存拆分（None 表示继承全局）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simulated_cache_enabled: Option<bool>,
    /// 模拟 Prompt 缓存命中率（None 表示继承全局，范围 0.01..0.99）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simulated_cache_ratio: Option<f64>,
    /// 负载均衡模式（None 表示继承全局配置: "priority" 或 "balanced"）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load_balancing_mode: Option<String>,
    /// 优先级反转（None 表示继承全局配置；true 表示数字大优先，false 表示数字小优先）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invert_priority: Option<bool>,
    /// 引用的其他分组列表
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<GroupReference>,
}

/// 分组管理器（线程安全 + 自动持久化）
pub struct GroupManager {
    inner: RwLock<Inner>,
    path: Option<PathBuf>,
}

struct Inner {
    /// 按 name 索引；HashMap 保证 O(1) 存在性查询
    entries: std::collections::HashMap<String, Group>,
}

impl GroupManager {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(Inner {
                entries: std::collections::HashMap::new(),
            }),
            path: None,
        }
    }

    /// 从 `groups.json` 加载（不存在时返回空管理器）
    pub fn load<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let path = path.as_ref().to_path_buf();
        let list: Vec<Group> = if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            if content.trim().is_empty() {
                Vec::new()
            } else {
                serde_json::from_str(&content)?
            }
        } else {
            Vec::new()
        };

        let mut entries = std::collections::HashMap::with_capacity(list.len());
        for g in list {
            entries.insert(g.name.clone(), g);
        }

        Ok(Self {
            inner: RwLock::new(Inner { entries }),
            path: Some(path),
        })
    }

    fn save_locked(&self, inner: &Inner) {
        let path = match &self.path {
            Some(p) => p,
            None => return,
        };
        let mut list: Vec<&Group> = inner.entries.values().collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        match serde_json::to_string_pretty(&list) {
            Ok(json) => {
                if let Err(e) = std::fs::write(path, json) {
                    tracing::warn!("写入分组文件失败: {}", e);
                }
            }
            Err(e) => tracing::warn!("序列化分组失败: {}", e),
        }
    }

    /// 列出所有分组（按 name 字典序）
    pub fn list(&self) -> Vec<Group> {
        let inner = self.inner.read();
        let mut list: Vec<Group> = inner.entries.values().cloned().collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        list
    }

    /// 单个查询
    pub fn get(&self, name: &str) -> Option<Group> {
        self.inner.read().entries.get(name).cloned()
    }

    /// 是否存在指定分组（用于凭据 / Key 写入前校验）
    pub fn exists(&self, name: &str) -> bool {
        self.inner.read().entries.contains_key(name)
    }

    /// 校验一组名字是否全部已注册；返回未注册的名字列表（调用方据此决定是否拒绝写入）
    #[allow(dead_code)]
    pub fn missing<'a>(&self, names: impl IntoIterator<Item = &'a str>) -> Vec<String> {
        let inner = self.inner.read();
        names
            .into_iter()
            .filter(|n| !inner.entries.contains_key(*n))
            .map(|s| s.to_string())
            .collect()
    }

    /// 创建分组（支持指定积分配置、调度策略与引用配置）。重名直接报错，不会静默覆盖（避免误创建丢备注）
    pub fn create_with_options(
        &self,
        name: String,
        description: Option<String>,
        token_by_credit_enabled: Option<bool>,
        credit_price: Option<f64>,
        simulated_cache_enabled: Option<bool>,
        simulated_cache_ratio: Option<f64>,
        load_balancing_mode: Option<String>,
        invert_priority: Option<bool>,
        references: Vec<GroupReference>,
    ) -> anyhow::Result<Group> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            anyhow::bail!("分组名不能为空");
        }
        if trimmed.chars().count() > 64 {
            anyhow::bail!("分组名过长（最多 64 字符）");
        }
        let valid_mode = match load_balancing_mode.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some("priority") => Some("priority".to_string()),
            Some("balanced") => Some("balanced".to_string()),
            Some(other) => anyhow::bail!("不支持的负载均衡模式: {}", other),
            None => None,
        };
        let mut inner = self.inner.write();
        if inner.entries.contains_key(trimmed) {
            anyhow::bail!("分组已存在: {}", trimmed);
        }
        Self::validate_references_locked(trimmed, &references, &inner)?;

        let group = Group {
            name: trimmed.to_string(),
            description: description.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()),
            created_at: Utc::now().to_rfc3339(),
            token_by_credit_enabled,
            credit_price,
            simulated_cache_enabled,
            simulated_cache_ratio,
            load_balancing_mode: valid_mode,
            invert_priority,
            references,
        };
        inner.entries.insert(group.name.clone(), group.clone());
        self.save_locked(&inner);
        Ok(group)
    }

    /// 创建分组（支持指定积分配置）。重名直接报错，不会静默覆盖（避免误创建丢备注）
    pub fn create_with_pricing(
        &self,
        name: String,
        description: Option<String>,
        token_by_credit_enabled: Option<bool>,
        credit_price: Option<f64>,
    ) -> anyhow::Result<Group> {
        self.create_with_options(
            name,
            description,
            token_by_credit_enabled,
            credit_price,
            None,
            None,
            None,
            None,
            Vec::new(),
        )
    }

    /// 创建分组。重名直接报错，不会静默覆盖（避免误创建丢备注）
    #[allow(dead_code)]
    pub fn create(&self, name: String, description: Option<String>) -> anyhow::Result<Group> {
        self.create_with_pricing(name, description, None, None)
    }

    /// 更新积分返回 Token 及缓存模拟配置
    pub fn update_token_by_credit(
        &self,
        name: &str,
        token_by_credit_enabled: Option<bool>,
        reset_enabled: bool,
        credit_price: Option<f64>,
        reset_price: bool,
        simulated_cache_enabled: Option<bool>,
        reset_simulated_cache: bool,
        simulated_cache_ratio: Option<f64>,
        reset_simulated_cache_ratio: bool,
    ) -> anyhow::Result<Group> {
        let mut inner = self.inner.write();
        let entry = inner
            .entries
            .get_mut(name)
            .ok_or_else(|| anyhow::anyhow!("分组不存在: {}", name))?;
        if reset_enabled {
            entry.token_by_credit_enabled = None;
        } else if token_by_credit_enabled.is_some() {
            entry.token_by_credit_enabled = token_by_credit_enabled;
        }
        if reset_price {
            entry.credit_price = None;
        } else if credit_price.is_some() {
            entry.credit_price = credit_price;
        }
        if reset_simulated_cache {
            entry.simulated_cache_enabled = None;
        } else if simulated_cache_enabled.is_some() {
            entry.simulated_cache_enabled = simulated_cache_enabled;
        }
        if reset_simulated_cache_ratio || reset_simulated_cache {
            entry.simulated_cache_ratio = None;
        } else if simulated_cache_ratio.is_some() {
            entry.simulated_cache_ratio = simulated_cache_ratio;
        }
        let cloned = entry.clone();
        self.save_locked(&inner);
        Ok(cloned)
    }

    /// 更新分组的调度模式（负载均衡模式与优先级反转）
    pub fn update_dispatch_mode(
        &self,
        name: &str,
        load_balancing_mode: Option<String>,
        reset_load_balancing_mode: bool,
        invert_priority: Option<bool>,
        reset_invert_priority: bool,
    ) -> anyhow::Result<Group> {
        let mut inner = self.inner.write();
        let entry = inner
            .entries
            .get_mut(name)
            .ok_or_else(|| anyhow::anyhow!("分组不存在: {}", name))?;

        if reset_load_balancing_mode {
            entry.load_balancing_mode = None;
        } else if let Some(m) = load_balancing_mode {
            let m_trim = m.trim();
            if m_trim.is_empty() {
                entry.load_balancing_mode = None;
            } else if m_trim == "priority" || m_trim == "balanced" {
                entry.load_balancing_mode = Some(m_trim.to_string());
            } else {
                anyhow::bail!("不支持的负载均衡模式: {}", m_trim);
            }
        }

        if reset_invert_priority {
            entry.invert_priority = None;
        } else if invert_priority.is_some() {
            entry.invert_priority = invert_priority;
        }

        let cloned = entry.clone();
        self.save_locked(&inner);
        Ok(cloned)
    }

    /// 查询指定分组的调度模式与优先级反转配置
    pub fn resolve_load_balancing(&self, group: &str) -> (Option<String>, Option<bool>) {
        let inner = self.inner.read();
        inner
            .entries
            .get(group)
            .map(|g| (g.load_balancing_mode.clone(), g.invert_priority))
            .unwrap_or((None, None))
    }

    /// 更新分组的引用列表（带防环与存在性校验）
    pub fn update_references(
        &self,
        name: &str,
        references: Vec<GroupReference>,
    ) -> anyhow::Result<Group> {
        let mut inner = self.inner.write();
        if !inner.entries.contains_key(name) {
            anyhow::bail!("分组不存在: {}", name);
        }
        Self::validate_references_locked(name, &references, &inner)?;

        let entry = inner.entries.get_mut(name).unwrap();
        entry.references = references;
        let cloned = entry.clone();
        self.save_locked(&inner);
        Ok(cloned)
    }

    fn validate_references_locked(
        source_name: &str,
        references: &[GroupReference],
        inner: &Inner,
    ) -> anyhow::Result<()> {
        let mut seen = std::collections::HashSet::new();
        for r in references {
            let target = r.group.trim();
            if target.is_empty() {
                anyhow::bail!("被引用分组名不能为空");
            }
            if target == source_name {
                anyhow::bail!("分组不能引用自身: {}", source_name);
            }
            if !inner.entries.contains_key(target) {
                anyhow::bail!("被引用的分组不存在: {}", target);
            }
            if !seen.insert(target.to_string()) {
                anyhow::bail!("引用列表中存在重复的分组: {}", target);
            }
        }

        // 防环检测 (Cycle detection via BFS)
        let mut queue = std::collections::VecDeque::new();
        let mut visited = std::collections::HashSet::new();
        for r in references {
            if r.enabled {
                queue.push_back((r.group.clone(), vec![source_name.to_string(), r.group.clone()]));
                visited.insert(r.group.clone());
            }
        }
        while let Some((curr, path)) = queue.pop_front() {
            if curr == source_name {
                anyhow::bail!("检测到循环引用: {}", path.join(" -> "));
            }
            if path.len() > 10 {
                anyhow::bail!("引用层级过深（超过 10 层）: {}", path.join(" -> "));
            }
            if let Some(target_group) = inner.entries.get(&curr) {
                for next_ref in &target_group.references {
                    if next_ref.enabled {
                        let mut next_path = path.clone();
                        next_path.push(next_ref.group.clone());
                        if next_ref.group == source_name {
                            anyhow::bail!("检测到循环引用: {}", next_path.join(" -> "));
                        }
                        if visited.insert(next_ref.group.clone()) {
                            queue.push_back((next_ref.group.clone(), next_path));
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// 解析指定目标分组及其所有生效子分组的 tier_rank 映射。
    /// 返回：HashMap<group_name, tier_rank>
    /// 规则：
    /// - 数字越小优先级越高。
    /// - Prioritized 组：0, 1, 2...（按配置顺序，全部严格高于宿主组）
    /// - 宿主组自身与 Normal 组：1000
    /// - Fallback 组：2000, 2001...（低于宿主组）
    pub fn resolve_group_tiers(&self, target_group: &str) -> std::collections::HashMap<String, u32> {
        let inner = self.inner.read();
        let mut result = std::collections::HashMap::new();

        // 宿主组自身默认为 1000
        result.insert(target_group.to_string(), 1000);

        let Some(target) = inner.entries.get(target_group) else {
            return result;
        };

        let mut prioritized_idx = 0u32;
        let mut fallback_idx = 2000u32;

        for r in &target.references {
            if !r.enabled {
                continue;
            }
            let rank = match r.tier {
                ReferenceTier::Prioritized => {
                    let rank = prioritized_idx;
                    prioritized_idx += 1;
                    rank
                }
                ReferenceTier::Normal => 1000,
                ReferenceTier::Fallback => {
                    let rank = fallback_idx;
                    fallback_idx += 1;
                    rank
                }
            };
            result
                .entry(r.group.clone())
                .and_modify(|existing| *existing = (*existing).min(rank))
                .or_insert(rank);
        }

        result
    }

    /// 查询有哪些分组引用了指定分组
    pub fn referenced_by(&self, name: &str) -> Vec<String> {
        let inner = self.inner.read();
        let mut referrers = Vec::new();
        for g in inner.entries.values() {
            if g.references.iter().any(|r| r.group == name) {
                referrers.push(g.name.clone());
            }
        }
        referrers.sort();
        referrers
    }

    /// 更新备注（不改名字）
    pub fn update_description(
        &self,
        name: &str,
        description: Option<String>,
    ) -> anyhow::Result<Group> {
        let mut inner = self.inner.write();
        let entry = inner
            .entries
            .get_mut(name)
            .ok_or_else(|| anyhow::anyhow!("分组不存在: {}", name))?;
        entry.description = description.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
        let cloned = entry.clone();
        self.save_locked(&inner);
        Ok(cloned)
    }

    /// 改名。返回 `Ok(new_name)`；调用方负责级联更新凭据 / Key 中的引用。
    /// `new_name` 必须未被占用；若与 `old_name` 完全一致则视为 no-op 直接返回成功。
    pub fn rename(&self, old_name: &str, new_name: &str) -> anyhow::Result<Group> {
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            anyhow::bail!("新分组名不能为空");
        }
        if trimmed.chars().count() > 64 {
            anyhow::bail!("分组名过长（最多 64 字符）");
        }

        let mut inner = self.inner.write();
        if !inner.entries.contains_key(old_name) {
            anyhow::bail!("分组不存在: {}", old_name);
        }
        if trimmed == old_name {
            return Ok(inner.entries.get(old_name).cloned().unwrap());
        }
        if inner.entries.contains_key(trimmed) {
            anyhow::bail!("目标分组名已存在: {}", trimmed);
        }
        let mut group = inner.entries.remove(old_name).unwrap();
        group.name = trimmed.to_string();
        inner.entries.insert(group.name.clone(), group.clone());

        // 级联更新其他分组中的引用
        for other in inner.entries.values_mut() {
            for r in other.references.iter_mut() {
                if r.group == old_name {
                    r.group = trimmed.to_string();
                }
            }
        }

        self.save_locked(&inner);
        Ok(group)
    }

    /// 删除分组。调用方应先确认无引用（或显式接受级联清理）。
    /// 返回 `true` 表示真的删了；返回 `false` 表示原本就不存在。
    pub fn delete(&self, name: &str) -> bool {
        let mut inner = self.inner.write();
        let removed = inner.entries.remove(name).is_some();
        if removed {
            // 级联清理其他分组对已删分组的引用
            for other in inner.entries.values_mut() {
                other.references.retain(|r| r.group != name);
            }
            self.save_locked(&inner);
        }
        removed
    }

    /// 启动迁移：从已有名字集合（凭据 groups + Key.group 聚合）反向写入注册表。
    /// 已存在的名字保持原备注 / 创建时间不变；只补缺。返回新增数量。
    pub fn bootstrap_from_existing<I: IntoIterator<Item = String>>(&self, names: I) -> usize {
        let mut inner = self.inner.write();
        let now = Utc::now().to_rfc3339();
        let mut added = 0usize;
        for raw in names {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                continue;
            }
            if !inner.entries.contains_key(trimmed) {
                inner.entries.insert(
                    trimmed.to_string(),
                    Group {
                        name: trimmed.to_string(),
                        description: None,
                        created_at: now.clone(),
                        token_by_credit_enabled: None,
                        credit_price: None,
                        simulated_cache_enabled: None,
                        simulated_cache_ratio: None,
                        load_balancing_mode: None,
                        invert_priority: None,
                        references: Vec::new(),
                    },
                );
                added += 1;
            }
        }
        if added > 0 {
            self.save_locked(&inner);
        }
        added
    }
}

impl Default for GroupManager {
    fn default() -> Self {
        Self::new()
    }
}

/// 默认管理器路径（相对凭据目录）
pub fn default_path_in(dir: &Path) -> PathBuf {
    dir.join("groups.json")
}

/// Arc 包装，便于注入 axum State
pub type SharedGroupManager = Arc<GroupManager>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_then_list_sorted() {
        let mgr = GroupManager::new();
        mgr.create("zz".into(), None).unwrap();
        mgr.create("aa".into(), Some("first".into())).unwrap();
        let list = mgr.list();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "aa");
        assert_eq!(list[0].description.as_deref(), Some("first"));
        assert_eq!(list[1].name, "zz");
    }

    #[test]
    fn create_rejects_duplicate() {
        let mgr = GroupManager::new();
        mgr.create("dup".into(), None).unwrap();
        assert!(mgr.create("dup".into(), None).is_err());
        assert!(mgr.create("  dup  ".into(), None).is_err()); // trim 后等价
    }

    #[test]
    fn create_rejects_empty_or_too_long() {
        let mgr = GroupManager::new();
        assert!(mgr.create("".into(), None).is_err());
        assert!(mgr.create("   ".into(), None).is_err());
        assert!(mgr.create("a".repeat(65), None).is_err());
    }

    #[test]
    fn missing_reports_unregistered() {
        let mgr = GroupManager::new();
        mgr.create("known".into(), None).unwrap();
        let missing = mgr.missing(["known", "ghost", "another-ghost"].iter().copied());
        assert_eq!(missing.len(), 2);
        assert!(missing.contains(&"ghost".to_string()));
        assert!(missing.contains(&"another-ghost".to_string()));
    }

    #[test]
    fn rename_swaps_key() {
        let mgr = GroupManager::new();
        mgr.create("old".into(), Some("note".into())).unwrap();
        let renamed = mgr.rename("old", "new").unwrap();
        assert_eq!(renamed.name, "new");
        assert_eq!(renamed.description.as_deref(), Some("note"));
        assert!(!mgr.exists("old"));
        assert!(mgr.exists("new"));
    }

    #[test]
    fn rename_to_existing_fails() {
        let mgr = GroupManager::new();
        mgr.create("a".into(), None).unwrap();
        mgr.create("b".into(), None).unwrap();
        assert!(mgr.rename("a", "b").is_err());
        // 原数据不变
        assert!(mgr.exists("a"));
        assert!(mgr.exists("b"));
    }

    #[test]
    fn rename_same_name_is_noop() {
        let mgr = GroupManager::new();
        mgr.create("x".into(), None).unwrap();
        assert!(mgr.rename("x", "x").is_ok());
        assert!(mgr.rename("x", "  x  ").is_ok());
    }

    #[test]
    fn delete_returns_correct_flag() {
        let mgr = GroupManager::new();
        mgr.create("g".into(), None).unwrap();
        assert!(mgr.delete("g"));
        assert!(!mgr.delete("g"));
        assert!(!mgr.exists("g"));
    }

    #[test]
    fn bootstrap_dedups_and_skips_existing() {
        let mgr = GroupManager::new();
        mgr.create("existing".into(), Some("kept".into())).unwrap();
        let added = mgr.bootstrap_from_existing(vec![
            "existing".into(), // 已存在 → 跳过，备注保留
            "new1".into(),
            "new1".into(), // 重复 → 第二次跳过
            "  new2  ".into(),
            "".into(), // 空 → 跳过
        ]);
        assert_eq!(added, 2); // new1 + new2
        let list = mgr.list();
        assert_eq!(list.len(), 3);
        // existing 的备注没被覆盖
        let existing = mgr.get("existing").unwrap();
        assert_eq!(existing.description.as_deref(), Some("kept"));
    }

    #[test]
    fn load_empty_file_yields_empty_manager() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("kiro_test_groups_empty_{}.json", std::process::id()));
        std::fs::write(&path, "").unwrap();
        let mgr = GroupManager::load(&path).unwrap();
        assert!(mgr.list().is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn save_roundtrip_preserves_data() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("kiro_test_groups_{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);

        let mgr = GroupManager::load(&path).unwrap();
        mgr.create("alpha".into(), Some("a-desc".into())).unwrap();
        mgr.create("beta".into(), None).unwrap();

        // 重新加载
        let mgr2 = GroupManager::load(&path).unwrap();
        let list = mgr2.list();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "alpha");
        assert_eq!(list[0].description.as_deref(), Some("a-desc"));
        assert_eq!(list[1].name, "beta");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn references_crud_and_tier_resolution() {
        let mgr = GroupManager::new();
        mgr.create("expiring".into(), None).unwrap();
        mgr.create("expiring2".into(), None).unwrap();
        mgr.create("main".into(), None).unwrap();

        // main 引用 expiring (prioritized) 和 expiring2 (fallback)
        let refs = vec![
            GroupReference {
                group: "expiring".into(),
                tier: ReferenceTier::Prioritized,
                enabled: true,
            },
            GroupReference {
                group: "expiring2".into(),
                tier: ReferenceTier::Fallback,
                enabled: true,
            },
        ];
        let updated = mgr.update_references("main", refs).unwrap();
        assert_eq!(updated.references.len(), 2);

        // 验证 tier 解析
        let tiers = mgr.resolve_group_tiers("main");
        // expiring 是 prioritized -> 0
        assert_eq!(tiers.get("expiring").copied(), Some(0));
        // main 宿主是 1000
        assert_eq!(tiers.get("main").copied(), Some(1000));
        // expiring2 是 fallback -> 2000
        assert_eq!(tiers.get("expiring2").copied(), Some(2000));

        // 验证 referenced_by
        assert_eq!(mgr.referenced_by("expiring"), vec!["main".to_string()]);
        assert_eq!(mgr.referenced_by("expiring2"), vec!["main".to_string()]);

        // 改名级联
        mgr.rename("expiring", "expiring_renamed").unwrap();
        let main_group = mgr.get("main").unwrap();
        assert_eq!(main_group.references[0].group, "expiring_renamed");

        // 删除级联
        mgr.delete("expiring2");
        let main_group = mgr.get("main").unwrap();
        assert_eq!(main_group.references.len(), 1);
        assert_eq!(main_group.references[0].group, "expiring_renamed");
    }

    #[test]
    fn cycle_detection_rejects_cycles() {
        let mgr = GroupManager::new();
        mgr.create("g1".into(), None).unwrap();
        mgr.create("g2".into(), None).unwrap();
        mgr.create("g3".into(), None).unwrap();

        // 自引用报错
        assert!(mgr.update_references("g1", vec![GroupReference {
            group: "g1".into(),
            tier: ReferenceTier::Prioritized,
            enabled: true,
        }]).is_err());

        // g1 -> g2
        mgr.update_references("g1", vec![GroupReference {
            group: "g2".into(),
            tier: ReferenceTier::Prioritized,
            enabled: true,
        }]).unwrap();

        // g2 -> g1 形成环，应报错
        assert!(mgr.update_references("g2", vec![GroupReference {
            group: "g1".into(),
            tier: ReferenceTier::Prioritized,
            enabled: true,
        }]).is_err());

        // g2 -> g3
        mgr.update_references("g2", vec![GroupReference {
            group: "g3".into(),
            tier: ReferenceTier::Prioritized,
            enabled: true,
        }]).unwrap();

        // g3 -> g1 (g1 -> g2 -> g3 -> g1) 形成间接环，应报错
        assert!(mgr.update_references("g3", vec![GroupReference {
            group: "g1".into(),
            tier: ReferenceTier::Prioritized,
            enabled: true,
        }]).is_err());
    }

    #[test]
    fn test_group_dispatch_mode_and_resolve() {
        let mgr = GroupManager::new();
        // 创建带调度模式的分组
        let g1 = mgr.create_with_options(
            "g1".into(),
            None,
            None,
            None,
            None,
            None,
            Some("balanced".into()),
            Some(true),
            Vec::new(),
        ).unwrap();
        assert_eq!(g1.load_balancing_mode.as_deref(), Some("balanced"));
        assert_eq!(g1.invert_priority, Some(true));

        let (mode, invert) = mgr.resolve_load_balancing("g1");
        assert_eq!(mode.as_deref(), Some("balanced"));
        assert_eq!(invert, Some(true));

        // 更新调度模式
        let updated = mgr.update_dispatch_mode(
            "g1",
            Some("priority".into()),
            false,
            Some(false),
            false,
        ).unwrap();
        assert_eq!(updated.load_balancing_mode.as_deref(), Some("priority"));
        assert_eq!(updated.invert_priority, Some(false));

        // 重置为跟随全局
        let reset = mgr.update_dispatch_mode(
            "g1",
            None,
            true,
            None,
            true,
        ).unwrap();
        assert_eq!(reset.load_balancing_mode, None);
        assert_eq!(reset.invert_priority, None);

        let (mode_reset, invert_reset) = mgr.resolve_load_balancing("g1");
        assert_eq!(mode_reset, None);
        assert_eq!(invert_reset, None);

        // 不支持的模式报错
        assert!(mgr.update_dispatch_mode("g1", Some("invalid_mode".into()), false, None, false).is_err());
    }
}
