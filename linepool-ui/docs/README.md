# LP 应用文档索引

启动与当前架构先读[应用 README](../README.md)，整体目录先读[仓库导航](../../docs/README.md)。以下方案与交接记录按各自版本阅读，旧路径、端口和验证结果不应直接套用于当前环境。

## 接入与业务专题

| 文档 | 阅读目的 |
| --- | --- |
| [API / Webhook 接入指南](api-webhook-integration-guide.md) | 现有内部接口、Webhook 和接入边界 |
| [PC / LP 接入规格](pc-lp-integration-spec.md) | 供号、收信、资源和订单的接口设计；包含历史方案 |
| [PC / LP 接入确认](pc-lp-integration-confirmation.md) | 接入约定及待确认事项 |
| [PC / LP 接口清单](pc-lp-api-checklist.md) | 按能力核对上游接口 |
| [下级代理管理方案](subagent-management-plan.md) | 代理关系、权限与交付方案；实际进度以源码为准 |
| [代理中心开发交接](agent-center-handoff.md) | 新前端接手状态、当前类型错误、统计权限问题、修复顺序与验收边界 |
| [数据库优化交付记录](backend-database-optimization-delivery.md) | 数据库优化的当时改动和验证边界 |
| [沙盒验收记录](SANDBOX-ACCEPTANCE.md) | 历史沙盒环境与验收范围 |

PC 接入文档中的早期“交付取码链接”方案已被站内收信方向取代，具体以最新确认与源码为准。现有 provider 仍装配 Mock，不能将设计清单视为真实供应商接入完成。

## 历史开发与交接

| 主题 | 文档 |
| --- | --- |
| 后端与 API | [后端交接](backend-handoff.md)、[工作台 API 验收](workspace-api-acceptance.md) |
| React 工作台 | [重建计划](workspace-reference-react-rebuild-plan.md)、[工作台计划](workspace-reference-plan.md)、[外壳交接](workspace-reference-shell-handoff.md) |
| 首页 | [React 首页交接](welcome-react-handoff.md) |
| 旧平台迁移 | [工程交接](platform-engineering-handoff.md)、[集成交接](platform-integration-handoff.md)、[详情页](platform-details-handoff.md)、[偏好设置](platform-preferences-handoff.md)、[对齐计划](platform-parity-plan.md) |

根目录原有 LP / ONCE 文档现归入[历史文档索引](../../docs/archive/README.md)。旧 Vue `platform/` 已移除；它出现在历史文档中时仅用于解释迁移背景。
