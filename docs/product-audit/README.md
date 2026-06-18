# Product Audit 文档包

创建日期：2026-06-18

本目录用于承接一次面向产品闭环的审计。审计对象不是单个模块，而是 Research Network 从用户故事到合约、Indexer、Web UI、E2E 验收之间的完整链路。

## 输入依据

本审计已阅读并对齐以下材料：

- 顶层产品文档：`../../../PRODUCT.md`
- 协议和系统文档：`../00-glossary.md` 到 `../21-agent-交接清单.md`
- 当前状态和诊断：`../../../HANDOFF.md`、`../../../DIAGNOSTICS.md`
- 代码证据：
  - 合约：`../../move/sources/`
  - Indexer：`../../src/core/indexer.ts`、`../../src/core/sui-events.ts`
  - API/SDK/CLI：`../../src/api/server.ts`、`../../src/core/sdk.ts`、`../../src/cli.ts`
  - Web：`../../web/src/`、`../../src/core/web*.ts`
  - 生产验收脚手架：`../../scripts/production-acceptance.ts`、`../../scripts/ui-production-acceptance.ts`

## 审计产物

| 文档 | 作用 |
| --- | --- |
| `01-contract-feature-audit.md` | 合约产品功能审计，按 Move 模块、用户行为、事件和产品风险拆解。 |
| `02-indexer-feature-audit.md` | Indexer 功能审计，检查事件投影、搜索、图谱、权限边界和生产化缺口。 |
| `03-ui-feature-audit.md` | UI 功能审计，覆盖游客、登录、GitHub 授权、发布、访问、委托、账户页和 mainnet guard。 |
| `04-e2e-user-story-scenarios.md` | E2E 用户故事场景，按“前端操作 - 合约事件 - Indexer 投影 - UI 断言”设计验收流程。 |
| `05-acceptance-run-report.md` | 本轮测试、dry-run、浏览器 UI E2E 和 readiness gate 的实际执行记录。 |

## 状态标记

| 状态 | 含义 |
| --- | --- |
| 已实现 | 代码存在，已有本地测试或文档中的明确验证记录。 |
| 部分实现 | 主路径已经接入，但仍依赖 testnet 验收、真实账号、生产调度、外部服务或明确剩余工作。 |
| 设计态 | 文档已定义，但代码只有骨架或尚未实现产品闭环。 |
| 阻塞 | 需要用户配置、第三方权限、真实资金/账号、mainnet 配置或外部服务后才能验收。 |
| 不建议上线 | 可用于本地演示或测试，但产品语义上不能对真实用户开放。 |

## 总结判断

1. 合约层已经从旧 License 模型迁移到 Seal Access。`report/access/delegation/settlement` 是当前商业访问主线；最新 testnet 包已发布并完成 author decrypt 回归，但 mainnet 未放行。
2. Indexer 已具备全量本地事件投影和 Sui RPC poller V1，能处理 report、membership、subscription、receipt、delegation、settlement、earnings 等状态；生产常驻调度、生产数据库、实时 Walrus manifest fetcher、向量检索仍是缺口。
3. UI 已有 React/Vite workbench 和真实 Walrus + Seal + Sui 路径。无 signer 时仍保留 demo fallback，这对开发有价值，但必须在生产和审计口径里显式区分。
4. 真正的“可上生产”需要两类证据同时成立：合约/Indexer/配置 receipt，以及普通用户浏览器 UI acceptance receipt。仅 build/test 通过不足以证明产品闭环完成。

## 最高优先级风险

| 优先级 | 风险 | 说明 |
| --- | --- | --- |
| P0 | Mainnet 未验收 | `docs/17` 明确要求 testnet preflight、testnet execute、mainnet readiness、mainnet 小额 acceptance 全部有 receipt 后才能注入正式资金。 |
| P0 | Demo fallback 与真实链上路径并存 | `web/src/lib/clients.ts` 在无 signer 时会生成合成 Walrus/Seal/Sui id。生产 UI 必须避免用户把 demo 数据误认为真实链上数据。 |
| P1 | 合约事件命名和 Indexer 投影契约需要锁定 | `access.move` 发出 `PlatformMembershipPurchased`，`settlement.move` 发出 `PlatformMembershipPaid`。Indexer 当前投影前者和 `AgentSubscriptionPaid`，需要明确产品查询使用哪类事件。 |
| P1 | 生产 Indexer 还不是常驻服务 | poller V1 可用，但还缺监控、告警、重试队列和生产数据库写入策略。 |
| P1 | GitHub 组织 scope 受 GitHub App 安装和组织审批限制 | UI 已能展示授权和未授权 scope，但无法绕过组织管理员批准、SAML、sudo/passkey 等 GitHub 侧要求。 |
