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

/// 真实缓存命中率 = cache_read / (uncached_input + cache_write + cache_read)。
/// 用于约束模拟缓存拆分：真实无缓存时不编造 cache_read。
pub fn cache_hit_ratio(uncached_input: i32, cache_write: i32, cache_read: i32) -> f64 {
    let total = (uncached_input.max(0) as i64)
        + (cache_write.max(0) as i64)
        + (cache_read.max(0) as i64);
    if total <= 0 {
        return 0.0;
    }
    (cache_read.max(0) as f64) / (total as f64)
}

/// 核心倒推算法：
/// 将本次请求消耗的 credits 折算为总目标金额 target_amount = credits * credit_price。
/// 然后依据模型的 input 与 output 单价，反推出下游可见的 token 分布，
/// 保证下游按 (in * P_in + 0.1 * cache_read * P_in + out * P_out) / 1e6 算出的总价等于 target_amount。
///
/// 关键约束：**output_tokens 锚定真实值**。
/// 下游 NewAPI 用 output_tokens / duration 计算生成速度，等比缩放 output 会让速度严重失真
/// （实测小输入请求把 1 token 放大到 30~40 倍，出现 1682 t/s 这种不可能的值；
/// 反之大输入请求 ratio < 1 会把 10 token 压成 1，速度被低估）。
/// 因此这里只把预算差额交给输入侧（uncached input + 模拟 cache_read）吸收：
/// 输入侧 token 数量不参与任何速度计算，放大它不会产生可观测的失真。
///
/// cache_creation 始终置 0；仅在开启模拟缓存时产生 cache_read。
///
/// `real_cache_hit_ratio` 是本次请求**真实**的缓存命中率
/// （real_cache_read / real_prompt_total），用来约束模拟拆分：
/// 配置的 `simulated_cache_ratio` 只作上限，实际取二者较小值。
/// 真实没有缓存命中就不编造 cache_read —— 否则会出现「只发了个 hi
/// 却报 13.5 万 cache_read」这种离谱数字。金额恒等只依赖
/// `input + 0.1 * cache_read` 这个当量，怎么拆不影响计费，
/// 所以没有任何理由为了缓存而缓存。
pub fn calculate_tokens_by_credit(
    raw_input: u64,
    raw_output: u64,
    credits: f64,
    credit_price: f64,
    cost: &ModelCost,
    simulated_cache_enabled: bool,
    simulated_cache_ratio: f64,
    real_cache_hit_ratio: f64,
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

    // 输出锚定真实值：保底 1 个 token，避免部分下游客户端报错空回复。
    let final_out = raw_output.max(1);

    // 极端兜底：真实输出成本本身已超预算（credit 单价极低 / 输出极长）。
    // 此时无法既保住真实输出又压到目标金额，只能缩放输出——这是唯一诚实的选择。
    if output_cost_per_token > 0.0 {
        let out_only_cost = (final_out as f64) * output_cost_per_token;
        if out_only_cost > target_amount {
            let capped = (target_amount / output_cost_per_token).floor() as u64;
            return AdjustedTokens {
                input_tokens: 0,
                output_tokens: capped.max(1),
                cache_creation_tokens: 0,
                cache_read_tokens: 0,
            };
        }
    }

    // 剩余预算全部交给输入侧吸收，换算为「输入 token 当量」。
    // final_in 表示 uncached_input + 0.1 * cache_read 的等效总量。
    let input_budget = target_amount - (final_out as f64) * output_cost_per_token;
    let final_in = if input_cost_per_token > 0.0 {
        (input_budget / input_cost_per_token).round().max(0.0) as u64
    } else {
        0
    };

    // 模拟 Prompt 缓存拆分：
    // 当开启模拟缓存且输入单价大于 0 时，将 final_in 拆为 (普通 input_tokens + 模拟 cache_read_tokens)。
    // 下游系统对 cache read 按 0.1 * P_in 计费，因此 10 个 cache read token = 1 个 input token。
    // 我们选择 cache_read 为 10 的倍数，使得 0.1 * cache_read 为精确整数，
    // 从而保证 (input_tokens + 0.1 * cache_read) 恒等于 final_in，下游计算金额零误差！
    // 有效缓存率 = min(配置上限, 真实命中率)。真实无缓存 ⇒ 不拆分。
    let effective_cache_ratio = simulated_cache_ratio
        .min(real_cache_hit_ratio.clamp(0.0, 1.0))
        .clamp(0.0, 0.99);

    let (cache_read, adjusted_in) = if simulated_cache_enabled
        && input_cost_per_token > 0.0
        && final_in > 0
        && effective_cache_ratio >= 0.01
    {
        let c = effective_cache_ratio;
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

        let adj = calculate_tokens_by_credit(raw_in, raw_out, credits, credit_price, &cost, false, 0.0, 0.0);
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
        let adj = calculate_tokens_by_credit(500, 50, credits, credit_price, &cost, true, 0.8, 0.8);
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

    /// 回归：输出 token 必须锚定真实值，否则下游按 output/duration 算出的生成速度会失真。
    #[test]
    fn test_output_tokens_anchored_to_real_value() {
        let cost = ModelCost { input: 3.0, output: 15.0 };
        let credit_price = 0.08;

        // 场景 1：小输入 + 小输出。旧算法 ratio≈35，会把 1 token 放大到 35（速度虚高数十倍）
        let adj = calculate_tokens_by_credit(6, 1, 0.0144, credit_price, &cost, true, 0.8, 0.8);
        assert_eq!(adj.output_tokens, 1, "输出必须保持真实值 1");

        // 场景 2：大输入 + 多输出。旧算法 ratio<1，会把 10 token 压成 1（速度被低估）
        let adj = calculate_tokens_by_credit(6482, 10, 0.0157, credit_price, &cost, true, 0.8, 0.8);
        assert_eq!(adj.output_tokens, 10, "输出必须保持真实值 10");

        // 场景 3：真实输出为 0 时保底 1，避免下游客户端报空回复
        let adj = calculate_tokens_by_credit(100, 0, 0.02, credit_price, &cost, false, 0.0, 0.0);
        assert_eq!(adj.output_tokens, 1);
    }

    /// 回归：输出锚定后，计费金额仍需精确 —— 差额由输入侧吸收，误差不超过 1 个 input token。
    #[test]
    fn test_billing_exact_with_anchored_output() {
        let cost = ModelCost { input: 3.0, output: 15.0 };
        let credit_price = 0.08;
        let input_unit = cost.input / 1_000_000.0;

        for &(raw_in, raw_out, credits) in &[
            (6u64, 1u64, 0.0144f64),
            (6482, 10, 0.0157),
            (6511, 21, 0.0183),
            (15, 1, 0.0161),
            (4, 1, 0.0247),
        ] {
            for &cache_on in &[false, true] {
                let adj = calculate_tokens_by_credit(
                    raw_in, raw_out, credits, credit_price, &cost, cache_on, 0.8, 0.8,
                );
                // 下游计价：input * P_in + cache_read * 0.1 * P_in + output * P_out
                let downstream = (adj.input_tokens as f64) * input_unit
                    + (adj.cache_read_tokens as f64) * input_unit * 0.1
                    + (adj.output_tokens as f64) * (cost.output / 1_000_000.0);
                let target = credits * credit_price;
                assert!(
                    (downstream - target).abs() <= input_unit,
                    "计费误差超过 1 个 input token: raw_in={raw_in} cache={cache_on} \
                     downstream={downstream:.10} target={target:.10}"
                );
                assert_eq!(adj.output_tokens, raw_out.max(1));
                assert_eq!(adj.cache_creation_tokens, 0);
            }
        }
    }

    /// 回归：真实没有缓存命中时，绝不编造 cache_read。
    /// 线上真实案例：只发了个 "hi"，旧行为按配置 0.9 硬拆出 135730 cache_read。
    #[test]
    fn test_no_fabricated_cache_when_real_request_has_none() {
        let cost = ModelCost { input: 5.0, output: 25.0 };
        let credits = 0.23318407973466004;
        let credit_price = 0.615385;

        // 真实无缓存命中（real_cache_hit_ratio = 0），但配置缓存率为 0.9
        let adj = calculate_tokens_by_credit(
            760, 9, credits, credit_price, &cost, true, 0.9, 0.0,
        );
        assert_eq!(adj.cache_read_tokens, 0, "真实无缓存时不得编造 cache_read");
        assert_eq!(adj.cache_creation_tokens, 0);
        assert_eq!(adj.output_tokens, 9, "输出仍锚定真实值");

        // 金额仍须精确
        let input_unit = cost.input / 1_000_000.0;
        let downstream = (adj.input_tokens as f64) * input_unit
            + (adj.output_tokens as f64) * (cost.output / 1_000_000.0);
        assert!((downstream - credits * credit_price).abs() <= input_unit);

        // 对照：真实确有 0.9 命中时才允许拆出大量 cache_read
        let adj_real = calculate_tokens_by_credit(
            760, 9, credits, credit_price, &cost, true, 0.9, 0.9,
        );
        assert!(adj_real.cache_read_tokens > 0);
        assert!(
            adj_real.cache_read_tokens > adj.cache_read_tokens,
            "真实有缓存时才放大"
        );
    }

    /// 回归：配置值只作上限，实际取 min(配置, 真实)。
    #[test]
    fn test_configured_ratio_is_only_an_upper_bound() {
        let cost = ModelCost { input: 3.0, output: 15.0 };
        // 真实命中 30%，配置上限 90% ⇒ 应按 30% 拆分，不得夸大到 90%
        let adj = calculate_tokens_by_credit(1000, 50, 0.5, 0.08, &cost, true, 0.9, 0.3);
        let total_prompt = adj.input_tokens + adj.cache_read_tokens;
        let hit = (adj.cache_read_tokens as f64) / (total_prompt as f64);
        assert!(
            (hit - 0.3).abs() < 0.02,
            "应贴合真实 30%，实际 {hit:.4}"
        );

        // 真实命中 95%，配置上限 50% ⇒ 受配置封顶为 50%
        let adj = calculate_tokens_by_credit(1000, 50, 0.5, 0.08, &cost, true, 0.5, 0.95);
        let total_prompt = adj.input_tokens + adj.cache_read_tokens;
        let hit = (adj.cache_read_tokens as f64) / (total_prompt as f64);
        assert!((hit - 0.5).abs() < 0.02, "应被配置封顶为 50%，实际 {hit:.4}");
    }

    #[test]
    fn test_cache_hit_ratio_helper() {
        assert_eq!(cache_hit_ratio(0, 0, 0), 0.0);
        assert_eq!(cache_hit_ratio(100, 0, 0), 0.0);
        assert!((cache_hit_ratio(20, 0, 80) - 0.8).abs() < 1e-9);
        assert!((cache_hit_ratio(10, 10, 80) - 0.8).abs() < 1e-9);
        // 负值防御
        assert_eq!(cache_hit_ratio(-5, -5, 0), 0.0);
    }

    /// 回归：开启模拟缓存时命中率应贴合配置值，缓存量不再被 ratio 二次放大。
    #[test]
    fn test_simulated_cache_hit_ratio_matches_config() {
        let cost = ModelCost { input: 3.0, output: 15.0 };
        for &ratio in &[0.5, 0.8, 0.9] {
            let adj = calculate_tokens_by_credit(6, 1, 0.0144, 0.08, &cost, true, ratio, ratio);
            let total_prompt = adj.input_tokens + adj.cache_read_tokens;
            let hit = (adj.cache_read_tokens as f64) / (total_prompt as f64);
            assert!(
                (hit - ratio).abs() < 0.02,
                "命中率偏离配置: ratio={ratio} actual={hit:.4}"
            );
        }
    }

    /// 边界：真实输出成本已超预算时，只能缩放输出（唯一诚实选择），且不得为 0。
    #[test]
    fn test_output_capped_when_real_cost_exceeds_budget() {
        let cost = ModelCost { input: 3.0, output: 15.0 };
        let output_unit = cost.output / 1_000_000.0;

        // 预算够放几十个 output token：应精确压到预算内
        let target = 0.001_f64;
        let adj = calculate_tokens_by_credit(100, 5000, 1.0, target, &cost, true, 0.8, 0.8);
        assert!(adj.output_tokens >= 1);
        assert!(adj.output_tokens < 5000, "预算不足时输出应被缩减");
        assert_eq!(adj.input_tokens, 0);
        assert_eq!(adj.cache_read_tokens, 0);
        let downstream = (adj.output_tokens as f64) * output_unit;
        assert!(
            downstream <= target + 1e-12,
            "缩放后仍超预算: downstream={downstream:.10} target={target:.10}"
        );

        // 预算连 1 个 output token 都不够：保底 1 token 优先（避免下游报空回复），
        // 此时允许超出，但超出量不得大于 1 个 output token 的单价。
        let tiny = 0.000_001_f64;
        let adj = calculate_tokens_by_credit(100, 5000, 0.001, 0.001, &cost, true, 0.8, 0.8);
        assert_eq!(adj.output_tokens, 1, "保底 1 个 output token");
        let downstream = (adj.output_tokens as f64) * output_unit;
        assert!(downstream - tiny <= output_unit);
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
        let adj = calculate_tokens_by_credit(760, 1, credits, credit_price, &cost, false, 0.0, 0.0);
        assert_eq!(adj.output_tokens, 1);
        assert_eq!(adj.input_tokens, 6);
        let calculated = (adj.input_tokens as f64 * (5.0 / 1_000_000.0))
            + (adj.output_tokens as f64 * (25.0 / 1_000_000.0));
        let target = credits * credit_price;
        assert!((calculated - target).abs() < 1e-6);
    }
}

