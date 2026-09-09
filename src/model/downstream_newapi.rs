//! 下游 NewAPI 关联与盈亏配置模型

use serde::{Deserialize, Serialize};

/// 下游 NewAPI 关联与盈亏核算配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownstreamNewApiConfig {
    /// 是否开启关联下游 NewAPI 查询与盈亏计算（默认 false）
    #[serde(default)]
    pub enabled: bool,
    /// 下游 NewAPI 地址（如 http://localhost:3000 或 https://api.newapi.com）
    #[serde(default)]
    pub base_url: String,
    /// 下游 NewAPI 管理员 API Key
    #[serde(default)]
    pub admin_key: String,
    /// 上游成本单价（每 1 credit 多少元人民币，默认 0.08，即 80元/1000分）
    #[serde(default = "default_cost_per_credit")]
    pub cost_per_credit: f64,
    /// 下游额度点数换算率（每个货币单位对应的 Quota，NewAPI 默认 500,000 点/元）
    #[serde(default = "default_quota_per_unit")]
    pub quota_per_unit: f64,
}

pub fn default_cost_per_credit() -> f64 {
    0.08
}

pub fn default_quota_per_unit() -> f64 {
    500_000.0
}

impl Default for DownstreamNewApiConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: String::new(),
            admin_key: String::new(),
            cost_per_credit: default_cost_per_credit(),
            quota_per_unit: default_quota_per_unit(),
        }
    }
}
