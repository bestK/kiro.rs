//! 模型定价与基于积分的 Token 倒推算法
//!
//! 数据源来自 `https://models.dev/api.json`。
//! 支持启动时加载本地缓存，后台异步拉取更新，并提供模型名称归一化匹配和兜底定价。
//! 核心算法：按本次请求消耗的积分（Credits）和设定的「1积分 = 多少金额」，
//! 逆向推导出 input_tokens 与 output_tokens，使得下游调用者根据官方模型定价计算出的
//! 总金额正好等于积分折算的金额。同时不用设置缓存 token 数（设为 0）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

/// 单个模型的输入与输出定价（单位：USD 每 1,000,000 tokens）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelCost {
    pub input: f64,
    pub output: f64,
}

impl Default for ModelCost {
    fn default() -> Self {
        // 默认兜底定价，按标准 Sonnet 定价 ($3 / $15 每 1M tokens)
        Self {
            input: 3.0,
            output: 15.0,
        }
    }
}

/// 倒推计算后的 Token 分配结果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdjustedTokens {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
}

/// models.dev API 的顶层 Provider 结构
#[derive(Debug, Deserialize)]
struct ModelsDevProvider {
    #[serde(default)]
    models: HashMap<String, ModelsDevModel>,
}

#[derive(Debug, Deserialize)]
struct ModelsDevModel {
    #[serde(default)]
    cost: Option<ModelsDevCost>,
}

#[derive(Debug, Deserialize)]
struct ModelsDevCost {
    #[serde(default)]
    input: Option<f64>,
    #[serde(default)]
    output: Option<f64>,
}

/// 全局模型定价管理器
pub struct ModelPricingManager {
    /// 归一化后的模型名 -> 定价
    prices: RwLock<HashMap<String, ModelCost>>,
    cache_path: Option<PathBuf>,
    models_dev_url: RwLock<String>,
}

pub type SharedPricingManager = Arc<ModelPricingManager>;

/// 全局按积分返回 Token 的运行时状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenByCreditState {
    pub enabled: bool,
    pub credit_price: f64,
    pub models_dev_url: String,
    pub pricing_refresh_hours: u64,
    pub simulated_cache_enabled: bool,
    pub simulated_cache_ratio: f64,
}

impl Default for TokenByCreditState {
    fn default() -> Self {
        Self {
            enabled: false,
            credit_price: 0.002,
            models_dev_url: "https://models.dev/api.json".to_string(),
            pricing_refresh_hours: 24,
            simulated_cache_enabled: false,
            simulated_cache_ratio: 0.8,
        }
    }
}

pub type SharedTokenByCredit = Arc<RwLock<TokenByCreditState>>;

impl ModelPricingManager {
    /// 创建新的定价管理器并从缓存加载（若存在）
    pub fn new(cache_dir: Option<&Path>, models_dev_url: Option<String>) -> Self {
        let url = models_dev_url.unwrap_or_else(|| "https://models.dev/api.json".to_string());
        let cache_path = cache_dir.map(|d| d.join("models_pricing_cache.json"));

        let mut initial_prices = HashMap::new();
        // 预置常见 Claude 模型的兜底定价
        load_builtin_fallback_prices(&mut initial_prices);

        if let Some(ref path) = cache_path {
            if path.exists() {
                if let Ok(content) = std::fs::read_to_string(path) {
                    if let Ok(cached) = serde_json::from_str::<HashMap<String, ModelCost>>(&content) {
                        tracing::info!("从本地缓存装载了 {} 条模型定价", cached.len());
                        for (k, v) in cached {
                            initial_prices.insert(k, v);
                        }
                    }
                }
            }
        }

        Self {
            prices: RwLock::new(initial_prices),
            cache_path,
            models_dev_url: RwLock::new(url),
        }
    }

    /// 设置模型定价数据源 URL
    pub fn set_models_dev_url(&self, url: String) {
        *self.models_dev_url.write() = url;
    }

    /// 获取当前模型定价数据源 URL
    pub fn models_dev_url(&self) -> String {
        self.models_dev_url.read().clone()
    }

    /// 归一化查找模型定价
    pub fn get_cost(&self, model: &str) -> ModelCost {
        let prices = self.prices.read();
        let normalized = normalize_model_name(model);

        // 1. 精确匹配归一化名称
        if let Some(cost) = prices.get(&normalized) {
            if cost.input > 0.0 || cost.output > 0.0 {
                return cost.clone();
            }
        }

        // 2. 去除日期后缀匹配（如 -20241022, -20250219）
        if let Some(base) = strip_date_suffix(&normalized) {
            if let Some(cost) = prices.get(base) {
                if cost.input > 0.0 || cost.output > 0.0 {
                    return cost.clone();
                }
            }
        }

        // 3. 常见模型家族模糊匹配
        if normalized.contains("opus") {
            return ModelCost { input: 15.0, output: 75.0 };
        }
        if normalized.contains("haiku") {
            return ModelCost { input: 0.8, output: 4.0 };
        }
        if normalized.contains("sonnet") {
            return ModelCost { input: 3.0, output: 15.0 };
        }

        ModelCost::default()
    }

    /// 后台启动定时拉取任务
    pub fn spawn_refresher(self: Arc<Self>, interval_hours: u64) {
        tokio::spawn(async move {
            // 启动时延迟 3 秒后执行首次拉取，避免阻塞主程序启动
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            self.refresh_prices().await;

            let interval = std::time::Duration::from_secs(interval_hours.max(1) * 3600);
            loop {
                tokio::time::sleep(interval).await;
                self.refresh_prices().await;
            }
        });
    }

    /// 从 models.dev 刷新定价
    pub async fn refresh_prices(&self) {
        tracing::debug!("正在从 {} 获取最新模型定价...", self.models_dev_url());
        let client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("创建 HTTP 客户端失败: {}", e);
                return;
            }
        };

        let url = self.models_dev_url();
        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("拉取 models.dev 定价失败: {}", e);
                return;
            }
        };

        if !resp.status().is_success() {
            tracing::warn!("拉取 models.dev 定价返回非成功状态码: {}", resp.status());
            return;
        }

        let body = match resp.text().await {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("读取 models.dev 响应体失败: {}", e);
                return;
            }
        };

        let parsed: HashMap<String, ModelsDevProvider> = match serde_json::from_str(&body) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("解析 models.dev JSON 失败: {}", e);
                return;
            }
        };

        let mut new_map = HashMap::new();
        load_builtin_fallback_prices(&mut new_map);

        for (_provider_id, provider) in parsed {
            for (model_id, model_data) in provider.models {
                if let Some(cost) = model_data.cost {
                    if let (Some(input), Some(output)) = (cost.input, cost.output) {
                        if input > 0.0 || output > 0.0 {
                            let normalized = normalize_model_name(&model_id);
                            new_map.insert(normalized, ModelCost { input, output });
                        }
                    }
                }
            }
        }

        let count = new_map.len();
        if let Some(ref path) = self.cache_path {
            if let Ok(json) = serde_json::to_string_pretty(&new_map) {
                if let Err(e) = std::fs::write(path, json) {
                    tracing::warn!("写入模型定价缓存文件失败: {}", e);
                }
            }
        }

        *self.prices.write() = new_map;
        tracing::info!("已更新 models.dev 模型定价，共装载 {} 个模型", count);
    }
}

/// 归一化模型名：转小写，去除常见前缀，将点号统一替换为中划线
fn normalize_model_name(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    let stripped = lower
        .strip_prefix("anthropic/")
        .or_else(|| lower.strip_prefix("anthropic--"))
        .or_else(|| lower.strip_prefix("anthropic-"))
        .unwrap_or(&lower);

    stripped.replace('.', "-")
}

/// 去除日期后缀（如 -20241022 或 -latest）
fn strip_date_suffix(name: &str) -> Option<&str> {
    if let Some(pos) = name.rfind('-') {
        let suffix = &name[pos + 1..];
        if suffix == "latest" || (suffix.len() == 8 && suffix.chars().all(|c| c.is_ascii_digit())) {
            return Some(&name[..pos]);
        }
    }
    None
}

/// 预置常见 Claude 模型的兜底定价（以防网络不可用）
fn load_builtin_fallback_prices(map: &mut HashMap<String, ModelCost>) {
    // Claude 3.5 Sonnet / 3.7 Sonnet / 4.x Sonnet: $3.00 / $15.00
    let sonnet = ModelCost { input: 3.0, output: 15.0 };
    map.insert("claude-3-5-sonnet".to_string(), sonnet.clone());
    map.insert("claude-3-5-sonnet-20240620".to_string(), sonnet.clone());
    map.insert("claude-3-5-sonnet-20241022".to_string(), sonnet.clone());
    map.insert("claude-3-7-sonnet".to_string(), sonnet.clone());
    map.insert("claude-3-7-sonnet-20250219".to_string(), sonnet.clone());
    map.insert("claude-sonnet-4-6".to_string(), sonnet.clone());

    // Claude 3 / 3.5 Opus / 4.x Opus: $15.00 / $75.00
    let opus = ModelCost { input: 15.0, output: 75.0 };
    map.insert("claude-3-opus".to_string(), opus.clone());
    map.insert("claude-3-opus-20240229".to_string(), opus.clone());
    map.insert("claude-opus-4".to_string(), opus.clone());
    map.insert("claude-opus-4-5".to_string(), opus.clone());
    map.insert("claude-opus-4-6".to_string(), opus);

    // Claude 3 / 3.5 Haiku: $0.80 / $4.00 或 $0.25 / $1.25
    let haiku = ModelCost { input: 0.8, output: 4.0 };
    map.insert("claude-3-5-haiku".to_string(), haiku.clone());
    map.insert("claude-3-5-haiku-20241022".to_string(), haiku.clone());
    map.insert("claude-3-haiku".to_string(), ModelCost { input: 0.25, output: 1.25 });
    map.insert("claude-3-haiku-20240307".to_string(), ModelCost { input: 0.25, output: 1.25 });
}

/// 核心倒推算法：
/// 将本次请求消耗的 credits 折算为总目标金额 target_amount = credits * credit_price。
/// 然后依据模型的 input 与 output 单价，反推 input_tokens 与 output_tokens。
/// 保证下游按公式 (in * P_in + out * P_out) / 1,000,000 计算的总价恰好等于 target_amount。
/// 缓存 token（cache_creation / cache_read）始终置 0。
pub fn calculate_tokens_by_credit(
    raw_input: u64,
    raw_output: u64,
    credits: f64,
    credit_price: f64,
    cost: &ModelCost,
    simulated_cache_enabled: bool,
    simulated_cache_ratio: f64,
) -> AdjustedTokens {
    let target_amount = credits * credit_price;
    let input_cost_per_token = cost.input / 1_000_000.0;
    let output_cost_per_token = cost.output / 1_000_000.0;

    // 边界保护：若金额 <= 0，或模型单价全为 0，直接返回原始或最小量
    if target_amount <= 0.0 || (input_cost_per_token <= 0.0 && output_cost_per_token <= 0.0) {
        return AdjustedTokens {
            input_tokens: raw_input,
            output_tokens: raw_output.max(1),
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
        };
    }

    // 计算实际原始 token 对应的基准单价
    let raw_price = (raw_input as f64) * input_cost_per_token
        + (raw_output as f64) * output_cost_per_token;

    let (mut final_in, mut final_out) = if raw_price > 0.0 {
        let ratio = target_amount / raw_price;
        (
            ((raw_input as f64) * ratio).floor() as u64,
            ((raw_output as f64) * ratio).floor() as u64,
        )
    } else {
        // 无原始 token 或无法按比例缩放时，按 50%:50% 分配预算
        let in_budget = target_amount * 0.5;
        let out_budget = target_amount * 0.5;
        let in_tokens = if input_cost_per_token > 0.0 {
            (in_budget / input_cost_per_token).floor() as u64
        } else {
            0
        };
        let out_tokens = if output_cost_per_token > 0.0 {
            (out_budget / output_cost_per_token).floor() as u64
        } else {
            0
        };
        (in_tokens, out_tokens)
    };

    // 确保至少有 1 个 output token，避免部分下游客户端报错空回复
    if final_out == 0 && output_cost_per_token > 0.0 {
        final_out = 1;
    }

    // 精确消除舍入差额：
    // 计算当前分配所得金额与目标金额的差额
    let current_amount = (final_in as f64) * input_cost_per_token
        + (final_out as f64) * output_cost_per_token;
    let mut diff = target_amount - current_amount;

    // 优先通过微调 output_tokens 补齐差额（但 output_tokens 保底不能低于 1）
    if output_cost_per_token > 0.0 {
        let adjust_out = (diff / output_cost_per_token).round() as i64;
        if adjust_out != 0 {
            let candidate = ((final_out as i64) + adjust_out).max(1);
            let actual_adjust = candidate - (final_out as i64);
            final_out = candidate as u64;
            diff -= (actual_adjust as f64) * output_cost_per_token;
        }
    }

    // 剩余差额由 input_tokens 精细微调补齐
    if input_cost_per_token > 0.0 && diff.abs() > 1e-9 {
        let adjust_in = (diff / input_cost_per_token).round() as i64;
        if adjust_in != 0 {
            let candidate = ((final_in as i64) + adjust_in).max(0);
            final_in = candidate as u64;
        }
    }

    // 模拟 Prompt 缓存拆分：
    // 当开启模拟缓存且输入单价大于 0 时，将 final_in 拆为 (普通 input_tokens + 模拟 cache_read_tokens)。
    // 下游系统对 cache read 按 0.1 * P_in 计费，因此 10 个 cache read token = 1 个 input token。
    // 我们选择 cache_read 为 10 的倍数，使得 0.1 * cache_read 为精确整数，
    // 从而保证 (input_tokens + 0.1 * cache_read) 恒等于 final_in，下游计算金额零误差！
    let (cache_read, adjusted_in) = if simulated_cache_enabled
        && input_cost_per_token > 0.0
        && final_in > 0
    {
        let c = simulated_cache_ratio.clamp(0.01, 0.99);
        let denom = 1.0 - 0.9 * c;
        let ideal_total = (final_in as f64) / denom;
        let ideal_r = (ideal_total * c).round() as u64;
        let r_10 = ((ideal_r + 5) / 10) * 10;
        let max_r = final_in * 10;
        let r = r_10.min(max_r);
        let i = final_in - (r / 10);
        (r, i)
    } else {
        (0, final_in)
    };

    AdjustedTokens {
        input_tokens: adjusted_in,
        output_tokens: final_out,
        cache_creation_tokens: 0,
        cache_read_tokens: cache_read,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_model_name() {
        assert_eq!(normalize_model_name("anthropic/claude-3.5-sonnet"), "claude-3-5-sonnet");
        assert_eq!(normalize_model_name("claude-3.7-sonnet"), "claude-3-7-sonnet");
        assert_eq!(normalize_model_name("anthropic--claude-3-opus"), "claude-3-opus");
    }

    #[test]
    fn test_calculate_tokens_by_credit_exact_match() {
        let cost = ModelCost {
            input: 3.0,   // $3 / 1M => $0.000003
            output: 15.0, // $15 / 1M => $0.000015
        };

        // 假设 0.1 积分，1 积分 = $0.05，总目标金额 = $0.005
        let credits = 0.1;
        let credit_price = 0.05;
        let raw_in = 1000;
        let raw_out = 200;

        let adj = calculate_tokens_by_credit(raw_in, raw_out, credits, credit_price, &cost, false, 0.0);
        assert_eq!(adj.cache_creation_tokens, 0);
        assert_eq!(adj.cache_read_tokens, 0);

        // 下游算出来的金额：
        let downstream_price = (adj.input_tokens as f64 * (cost.input / 1_000_000.0))
            + (adj.output_tokens as f64 * (cost.output / 1_000_000.0));

        let target_price = credits * credit_price;
        // 误差应小于 1 个 token 的单价 ($0.000015)
        assert!((downstream_price - target_price).abs() <= cost.output / 1_000_000.0);
    }

    #[test]
    fn test_calculate_tokens_with_simulated_cache() {
        let cost = ModelCost {
            input: 3.0,
            output: 15.0,
        };
        let credits = 0.5;
        let credit_price = 0.002;
        // 目标金额 = $0.001
        let adj = calculate_tokens_by_credit(500, 50, credits, credit_price, &cost, true, 0.8);
        assert!(adj.cache_read_tokens > 0);

        // 下游按 Claude 缓存定价计算: input * $3/M + cache_read * $0.3/M + output * $15/M
        let downstream_calc = (adj.input_tokens as f64 * (3.0 / 1_000_000.0))
            + (adj.cache_read_tokens as f64 * (0.3 / 1_000_000.0))
            + (adj.output_tokens as f64 * (15.0 / 1_000_000.0));
        let target = credits * credit_price;
        assert!((downstream_calc - target).abs() <= cost.input / 1_000_000.0);

        // 验证缓存命中率接近 80%
        let total_prompt = adj.input_tokens + adj.cache_read_tokens;
        let hit_ratio = (adj.cache_read_tokens as f64) / (total_prompt as f64);
        assert!((hit_ratio - 0.8).abs() < 0.05);
    }

    #[test]
    fn test_pricing_manager_fallback() {
        let mgr = ModelPricingManager::new(None, None);
        let sonnet_cost = mgr.get_cost("claude-3-5-sonnet-20241022");
        assert_eq!(sonnet_cost.input, 3.0);
        assert_eq!(sonnet_cost.output, 15.0);

        let opus_cost = mgr.get_cost("anthropic/claude-3-opus-20240229");
        assert_eq!(opus_cost.input, 15.0);
        assert_eq!(opus_cost.output, 75.0);
        let haiku_cost = mgr.get_cost("claude-3-5-haiku-20241022");
        assert_eq!(haiku_cost.input, 0.8);
        assert_eq!(haiku_cost.output, 4.0);
    }

    #[test]
    fn test_calculate_tokens_small_credits_clamped_output() {
        let cost = ModelCost {
            input: 5.0,
            output: 25.0,
        };
        let credits = 0.0277551576782753;
        let credit_price = 0.002;
        let adj = calculate_tokens_by_credit(760, 1, credits, credit_price, &cost, false, 0.0);
        assert_eq!(adj.output_tokens, 1);
        assert_eq!(adj.input_tokens, 6);
        let calculated = (adj.input_tokens as f64 * (5.0 / 1_000_000.0))
            + (adj.output_tokens as f64 * (25.0 / 1_000_000.0));
        let target = credits * credit_price;
        assert!((calculated - target).abs() < 1e-6);
    }
}

