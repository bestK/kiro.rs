//! Anthropic API 中间件

use std::sync::Arc;

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Json, Response},
};

use crate::admin::client_keys::{KeyAuth, SharedClientKeyManager};
use crate::admin::trace_db::{SharedTraceStore, TraceKeySource};
use crate::admin::usage_stats::{SharedAggregator, SharedRecorder};
use crate::common::auth;
use crate::kiro::provider::KiroProvider;

use super::cache_metering::SharedCacheMeter;
use super::types::ErrorResponse;

/// 按积分返回 Token 的生效配置
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TokenByCreditConfig {
    pub enabled: bool,
    pub credit_price: f64,
    pub simulated_cache_enabled: bool,
    pub simulated_cache_ratio: f64,
}

impl Default for TokenByCreditConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            credit_price: 0.002,
            simulated_cache_enabled: false,
            simulated_cache_ratio: 0.8,
        }
    }
}

impl TokenByCreditConfig {
    /// 三级继承解析：Key 设置 > 分组设置 > 全局配置
    ///
    /// 当全局未开启计费折算时，单独开启了折算的分组或 Key 仍可独立生效，
    /// 并且自定义缓存率或缓存模拟设置也按三级层级准确继承。
    pub fn resolve(
        client_key: Option<&crate::admin::client_keys::ClientKey>,
        group: Option<&crate::admin::groups::Group>,
        global_tbc: &crate::model::pricing::TokenByCreditState,
    ) -> Self {
        // 1. token_by_credit_enabled: Key > Group > Global
        let enabled = client_key
            .and_then(|k| k.token_by_credit_enabled)
            .or_else(|| group.and_then(|g| g.token_by_credit_enabled))
            .unwrap_or(global_tbc.enabled);

        // 2. credit_price: Key > Group > Global (<= 0.0 则兜底 0.002)
        let mut credit_price = client_key
            .and_then(|k| k.credit_price)
            .or_else(|| group.and_then(|g| g.credit_price))
            .unwrap_or(global_tbc.credit_price);
        if credit_price <= 0.0 {
            credit_price = 0.002;
        }

        // 3. simulated_cache_ratio: Key > Group > Global (范围 0.01..0.99)
        let simulated_cache_ratio = client_key
            .and_then(|k| k.simulated_cache_ratio)
            .or_else(|| group.and_then(|g| g.simulated_cache_ratio))
            .unwrap_or(global_tbc.simulated_cache_ratio)
            .clamp(0.01, 0.99);

        // 4. simulated_cache_enabled: Key > Group > Global
        // 若在当前层级显式配置了 simulated_cache_ratio 且未显式关闭 (Some(false))，
        // 则视为开启缓存模拟，确保设置了专属缓存率即自动启用模拟拆分。
        let simulated_cache_enabled = if let Some(key_cache) = client_key.and_then(|k| k.simulated_cache_enabled) {
            key_cache
        } else if client_key.and_then(|k| k.simulated_cache_ratio).is_some() {
            true
        } else if let Some(grp_cache) = group.and_then(|g| g.simulated_cache_enabled) {
            grp_cache
        } else if group.and_then(|g| g.simulated_cache_ratio).is_some() {
            true
        } else {
            global_tbc.simulated_cache_enabled
        };

        Self {
            enabled,
            credit_price,
            simulated_cache_enabled,
            simulated_cache_ratio,
        }
    }
}

/// 命中的鉴权上下文（注入到请求扩展，供 handler 记录用量）
#[derive(Clone, Debug)]
pub struct KeyContext {
    /// 命中的客户端 Key id
    pub key_id: u64,
    /// 该 Key 绑定的账号分组；None 表示未绑定，可使用全部账号
    pub group: Option<String>,
    /// 命中的入口 Key 类型。
    pub key_source: TraceKeySource,
    /// 客户端 IP（转发头优先，回落到 TCP 对端），仅用于请求日志
    pub client_ip: Option<String>,
    /// 按积分返回 Token 的生效配置
    pub token_by_credit: TokenByCreditConfig,
}

/// 应用共享状态
#[derive(Clone)]
pub struct AppState {
    /// Kiro Provider（可选，用于实际 API 调用）
    /// 内部使用 MultiTokenManager，已支持线程安全的多凭据管理
    pub kiro_provider: Option<Arc<KiroProvider>>,
    /// 是否开启非流式响应的 thinking 块提取
    pub extract_thinking: bool,
    /// 工具兼容模式（ClaudeCode 内置工具名/入参双向适配 / Raw 透传）
    pub tool_compatibility_mode: crate::model::config::ToolCompatibilityMode,
    /// 客户端 Key 管理器（可选，未启用 Admin 时为 None）
    pub client_keys: Option<SharedClientKeyManager>,
    /// 用量日志记录器
    pub usage_recorder: Option<SharedRecorder>,
    /// 用量聚合器
    pub usage_aggregator: Option<SharedAggregator>,
    /// 中转层缓存计量（基于 cache_control 断点的内存缓存）
    pub cache_meter: Option<SharedCacheMeter>,
    /// 请求链路追踪存储（SQLite，可选）
    pub trace_store: Option<SharedTraceStore>,
    /// 模型定价管理器
    pub pricing_manager: Option<crate::model::pricing::SharedPricingManager>,
    /// 账号分组管理器
    pub group_manager: Option<crate::admin::groups::SharedGroupManager>,
    /// 全局按积分返回 Token 共享状态
    pub token_by_credit: Option<crate::model::pricing::SharedTokenByCredit>,
    /// 自定义响应头管理器（热重载）
    pub custom_headers: Option<crate::model::custom_headers::CustomHeadersManager>,
}

impl AppState {
    /// 创建新的应用状态（不含 client_keys 的基础构造，供嵌入 / 测试使用）
    #[allow(dead_code)]
    pub fn new(
        extract_thinking: bool,
        tool_compatibility_mode: crate::model::config::ToolCompatibilityMode,
    ) -> Self {
        Self {
            kiro_provider: None,
            extract_thinking,
            tool_compatibility_mode,
            client_keys: None,
            usage_recorder: None,
            usage_aggregator: None,
            cache_meter: None,
            trace_store: None,
            pricing_manager: None,
            group_manager: None,
            token_by_credit: None,
            custom_headers: None,
        }
    }

    /// 注入可与 Admin 控制面共享的 KiroProvider。
    pub fn with_shared_kiro_provider(mut self, provider: Arc<KiroProvider>) -> Self {
        self.kiro_provider = Some(provider);
        self
    }

    /// 注入用量记录组件
    pub fn with_usage(
        mut self,
        client_keys: Option<SharedClientKeyManager>,
        recorder: Option<SharedRecorder>,
        aggregator: Option<SharedAggregator>,
    ) -> Self {
        self.client_keys = client_keys;
        self.usage_recorder = recorder;
        self.usage_aggregator = aggregator;
        self
    }

    /// 注入缓存计量器
    pub fn with_cache_meter(mut self, cache: Option<SharedCacheMeter>) -> Self {
        self.cache_meter = cache;
        self
    }

    /// 注入链路追踪存储
    pub fn with_trace_store(mut self, store: Option<SharedTraceStore>) -> Self {
        self.trace_store = store;
        self
    }

    /// 注入定价与分组配置
    pub fn with_pricing(
        mut self,
        pricing: Option<crate::model::pricing::SharedPricingManager>,
        token_by_credit: Option<crate::model::pricing::SharedTokenByCredit>,
        group_manager: Option<crate::admin::groups::SharedGroupManager>,
    ) -> Self {
        self.pricing_manager = pricing;
        self.token_by_credit = token_by_credit;
        self.group_manager = group_manager;
        self
    }

    /// 注入自定义响应头管理器
    pub fn with_custom_headers(
        mut self,
        custom_headers: Option<crate::model::custom_headers::CustomHeadersManager>,
    ) -> Self {
        self.custom_headers = custom_headers;
        self
    }
}

/// API Key 认证中间件
///
/// 所有入口 Key 统一按已存储的完整值精确匹配，不限制前缀。命中后向请求扩展注入
/// [`KeyContext`]，供 handler 记录用量时使用。
pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let presented = match auth::extract_api_key(&request) {
        Some(k) => k,
        None => {
            let error = ErrorResponse::authentication_error();
            return (StatusCode::UNAUTHORIZED, Json(error)).into_response();
        }
    };

    if let Some(mgr) = &state.client_keys {
        match mgr.verify_and_touch_ex(&presented) {
            KeyAuth::Ok(id) => {
                let client_key = mgr.get(id);
                let group = client_key.as_ref().and_then(|k| k.group.clone()).or_else(|| mgr.group_of(id));
                let group_obj = group
                    .as_ref()
                    .and_then(|g| state.group_manager.as_ref().and_then(|gm| gm.get(g)));

                let global_tbc = state
                    .token_by_credit
                    .as_ref()
                    .map(|s| s.read().clone())
                    .unwrap_or_default();

                let token_by_credit = TokenByCreditConfig::resolve(
                    client_key.as_ref(),
                    group_obj.as_ref(),
                    &global_tbc,
                );

                let client_ip = auth::extract_client_ip(&request);
                request.extensions_mut().insert(KeyContext {
                    key_id: id,
                    group,
                    key_source: TraceKeySource::ClientKey,
                    client_ip,
                    token_by_credit,
                });
                return next.run(request).await;
            }
            KeyAuth::OverLimit { used, limit, .. } => {
                let error = ErrorResponse::new(
                    "rate_limit_error",
                    format!(
                        "该 API Key 已达到积分使用上限（已用 {:.2} / 上限 {:.2}），请联系管理员调整额度或重置统计",
                        used, limit
                    ),
                );
                return (StatusCode::TOO_MANY_REQUESTS, Json(error)).into_response();
            }
            KeyAuth::NotFound => {}
        }
    }

    let error = ErrorResponse::authentication_error();
    (StatusCode::UNAUTHORIZED, Json(error)).into_response()
}

/// CORS 中间件层
///
/// **安全说明**：当前配置允许所有来源（Any），这是为了支持公开 API 服务。
/// 如果需要更严格的安全控制，请根据实际需求配置具体的允许来源、方法和头信息。
///
/// # 配置说明
/// - `allow_origin(Any)`: 允许任何来源的请求
/// - `allow_methods(Any)`: 允许任何 HTTP 方法
/// - `allow_headers(Any)`: 允许任何请求头
pub fn cors_layer() -> tower_http::cors::CorsLayer {
    use tower_http::cors::{Any, CorsLayer};

    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admin::client_keys::ClientKey;
    use crate::admin::groups::Group;
    use crate::model::pricing::TokenByCreditState;

    fn make_test_group(
        enabled: Option<bool>,
        price: Option<f64>,
        cache_enabled: Option<bool>,
        cache_ratio: Option<f64>,
    ) -> Group {
        Group {
            name: "test_grp".to_string(),
            description: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            token_by_credit_enabled: enabled,
            credit_price: price,
            simulated_cache_enabled: cache_enabled,
            simulated_cache_ratio: cache_ratio,
            references: Vec::new(),
        }
    }

    fn make_test_key(
        enabled: Option<bool>,
        price: Option<f64>,
        cache_enabled: Option<bool>,
        cache_ratio: Option<f64>,
    ) -> ClientKey {
        ClientKey {
            id: 1,
            key: "sk-test".to_string(),
            name: "test_key".to_string(),
            description: None,
            disabled: false,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            last_used_at: None,
            total_calls: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cache_creation_tokens: 0,
            total_cache_read_tokens: 0,
            total_credits: 0.0,
            max_credits: None,
            group: Some("test_grp".to_string()),
            is_system: false,
            token_by_credit_enabled: enabled,
            credit_price: price,
            simulated_cache_enabled: cache_enabled,
            simulated_cache_ratio: cache_ratio,
        }
    }

    #[test]
    fn test_global_disabled_group_enabled_works() {
        let global_tbc = TokenByCreditState {
            enabled: false,
            credit_price: 0.002,
            models_dev_url: "https://models.dev/api.json".to_string(),
            pricing_refresh_hours: 24,
            simulated_cache_enabled: false,
            simulated_cache_ratio: 0.8,
        };

        let grp = make_test_group(Some(true), Some(0.003), None, Some(0.85));
        let resolved = TokenByCreditConfig::resolve(None, Some(&grp), &global_tbc);

        assert!(resolved.enabled, "Group should enable token_by_credit even if global is false");
        assert_eq!(resolved.credit_price, 0.003);
        assert!(resolved.simulated_cache_enabled, "Simulated cache should be active when cache_ratio is set");
        assert_eq!(resolved.simulated_cache_ratio, 0.85);
    }

    #[test]
    fn test_global_disabled_key_enabled_works() {
        let global_tbc = TokenByCreditState {
            enabled: false,
            credit_price: 0.002,
            models_dev_url: "https://models.dev/api.json".to_string(),
            pricing_refresh_hours: 24,
            simulated_cache_enabled: false,
            simulated_cache_ratio: 0.8,
        };

        let key = make_test_key(Some(true), None, None, None);
        let grp = make_test_group(None, None, None, None);
        let resolved = TokenByCreditConfig::resolve(Some(&key), Some(&grp), &global_tbc);

        assert!(resolved.enabled, "Key should enable token_by_credit even if group and global are false");
        assert_eq!(resolved.credit_price, 0.002, "Should fallback to global default price");
        assert!(!resolved.simulated_cache_enabled, "Cache simulation should remain false if not configured");
    }

    #[test]
    fn test_group_explicitly_disables_cache() {
        let global_tbc = TokenByCreditState {
            enabled: true,
            credit_price: 0.002,
            models_dev_url: "https://models.dev/api.json".to_string(),
            pricing_refresh_hours: 24,
            simulated_cache_enabled: true,
            simulated_cache_ratio: 0.8,
        };

        let grp = make_test_group(Some(true), None, Some(false), Some(0.9));
        let resolved = TokenByCreditConfig::resolve(None, Some(&grp), &global_tbc);

        assert!(resolved.enabled);
        assert!(!resolved.simulated_cache_enabled, "Explicit false on group should override global true");
    }

    #[test]
    fn test_key_overrides_group() {
        let global_tbc = TokenByCreditState::default();

        let grp = make_test_group(Some(true), Some(0.003), Some(true), Some(0.7));
        let key = make_test_key(Some(false), Some(0.005), Some(false), Some(0.95));

        let resolved = TokenByCreditConfig::resolve(Some(&key), Some(&grp), &global_tbc);
        assert!(!resolved.enabled, "Key should override group enabled");
        assert_eq!(resolved.credit_price, 0.005, "Key should override group price");
        assert!(!resolved.simulated_cache_enabled, "Key should override group cache enabled");
        assert_eq!(resolved.simulated_cache_ratio, 0.95, "Key should override group cache ratio");
    }

    #[test]
    fn test_invalid_price_falls_back() {
        let global_tbc = TokenByCreditState {
            enabled: false,
            credit_price: 0.0,
            models_dev_url: "https://models.dev/api.json".to_string(),
            pricing_refresh_hours: 24,
            simulated_cache_enabled: false,
            simulated_cache_ratio: 0.8,
        };

        let grp = make_test_group(Some(true), Some(-1.0), None, None);
        let resolved = TokenByCreditConfig::resolve(None, Some(&grp), &global_tbc);

        assert_eq!(resolved.credit_price, 0.002, "Non-positive price should fallback to 0.002");
    }
}
