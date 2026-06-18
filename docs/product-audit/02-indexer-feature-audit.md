# Indexer 功能审计

## 1. 审计边界

Indexer 是 Research Network 的查询事实层。Sui 是最终事实源，Walrus manifest 是内容事实源，Indexer 是可重放投影。产品上，用户看到的搜索、资产页、收益面板、访问状态、委托状态和 agent 收益都依赖 Indexer。

本审计关注：

- 事件覆盖是否完整。
- public/encrypted/private 的搜索边界是否正确。
- 幂等、重放、checkpoint、生产调度是否足够。
- Indexer 输出是否能支撑 UI 和 E2E 断言。

## 2. 当前架构

当前实现以 `src/core/indexer.ts` 为核心：

```text
Sui Event / Local Event Log
-> normalizeSuiEvent / ProtocolEvent
-> applyEvent / applyEvents
-> IndexState
-> search_documents / reports / delegations / earnings / graph
-> API / SDK / Web
```

当前已具备：

- 事件幂等键：`tx_digest:event_seq`。
- 本地事件重放：`research replay`。
- Sui RPC poller V1：`research index:poll --package-id ...`。
- report、membership、subscription、receipt、delegation、settlement、earnings 等 Seal Access 投影。
- `private_delegation` 报告不进入公共搜索。

仍缺：

- 生产常驻 worker。
- 生产数据库写入。
- Walrus manifest 实时 fetcher。
- 向量检索和 embedding worker。
- 失败事件 retry queue 和告警。
- 明确的事件 schema fixture。

## 3. 事件覆盖矩阵

| 事件 | 来源模块 | 投影结果 | 搜索策略 | 状态 | 审计结论 |
| --- | --- | --- | --- | --- | --- |
| `ResearchAssetPublished` | `research_asset` | `research_assets`、asset search doc、manifest 解析 | public metadata 可搜 | 已投影 | 资产主线成立。真实链路需 Walrus manifest fetcher 验证 hash。 |
| `SkillPublished` | `skill` | `skills`、skill search doc、relationships | 可搜 | 已投影 | Skill 一等资产可进入 marketplace/search。 |
| `SkillInstalled` | `skill` | install 计数或关系 | 可用于排序 | 已投影 | 需反刷量和同钱包去重规则。 |
| `AssetCited` | `research_asset` | relationship `cites` | 增加 graph 和 ranking | 已投影 | 真链不用本地 `AssetRelationshipRegistered`。 |
| `AssetForked` | `research_asset` | relationship `fork` | 增加 graph 和 ranking | 已投影 | `relation_type` 建议统一为 `forks` 或 `fork`，避免 API 语义漂移。 |
| `AssetRelationshipRegistered` | 本地模拟 | generic relationship | 本地可搜 | 已投影 | 仅本地桥接，真链不应依赖。 |
| `ResearchReportPublished` | `report` | `reports`、`has_report` relationship、report search doc | public/encrypted preview 可搜；private 不入 search | 已投影 | 权限边界符合 docs/18。 |
| `AgentChannelCreated` | `settlement` | `agent_channels`、channel search doc | 可搜 | 已投影 | 可支撑 agent 订阅入口。 |
| `PlatformMembershipPurchased` | `access` | `platform_memberships` | 不进公共搜索 | 已投影 | 用于判断 pass 和 account page。 |
| `PlatformMembershipPaid` | `settlement` | 当前未单独投影 | 不进公共搜索 | 缺口 | 若产品要展示支付金额和平台 fee，需补 handler。 |
| `AgentSubscriptionPurchased` | `access` | `agent_subscriptions` | 不进公共搜索 | 已投影 | 用于访问判断和 account page。 |
| `AgentSubscriptionPaid` | `settlement` | `agent_earnings.total_earned` 增加 net | 不进公共搜索 | 已投影 | 可支撑 agent earnings。 |
| `AccessReceiptRecorded` | `access` | `access_receipts` | 不进公共搜索 | 已投影 | 会员分账核心输入。 |
| `DelegationCreated` | `delegation` | `delegations`、delegation search doc | 当前 delegation metadata 可搜 | 已投影 | 产品需决定 delegation 本身是否公开；private result 内容不能公开。 |
| `DelegationAccepted` | `delegation` | delegation status | 不进公共搜索或只在授权视图 | 已投影 | 状态投影可用。 |
| `DelegationFunded` | `delegation` | delegation status | 不进公共搜索 | 已投影 | 建议记录 funded amount。 |
| `DelegationResultSubmitted` | `delegation/report` | delegation result_report_id | private result 不入 search | 已投影 | 与 report publish 事件组合后形成私有委托结果视图。 |
| `DelegationCompleted` | `delegation` | status、payout | 不进公共搜索 | 已投影 | 可支撑 buyer/agent dashboard。 |
| `DelegationRefunded` | `delegation` | status、refund | 不进公共搜索 | 已投影 | 当前用 amount > 0 判断 refunded，否则 expired。 |
| `DelegationDisputeOpened` | `delegation` | status、arbitrator | 不进公共搜索 | 已投影 | 可支撑仲裁 UI。 |
| `DelegationDisputeResolved` | `delegation` | status、refund/payout | 不进公共搜索 | 已投影 | 可支撑争议结案视图。 |
| `MembershipSettlementCreated` | `settlement` | `membership_settlements` | 不进公共搜索 | 已投影 | 汇总结算状态可用。 |
| `MembershipReportSettled` | `settlement` | settlement record、agent earnings 增加 | 不进公共搜索 | 已投影 | 核心收入投影可用。 |
| `AgentEarningsClaimed` | `settlement` | `agent_earnings.total_claimed` 增加 | 不进公共搜索 | 已投影 | 可计算 unclaimed。 |
| `RevenuePoolCreated` | `revenue` | `revenue_pools` | 可展示在 economics | 已投影 | 兼容旧收益池。 |
| `RevenueDeposited` | `revenue` | pool total_received | 可展示在 economics | 已投影 | 当前采用事件中的 authoritative cumulative total。 |
| `RevenueClaimed` | `revenue` | pool total_claimed、claimed_by | 可展示在 economics | 已投影 | 兼容旧 claim。 |
| `AgentPassportCreated` | `agent` | `agents`、agent search doc | 可搜 | 已投影 | Agent identity 可进入页面。 |
| `ReputationCreated` | `reputation` | `reputations` | 可用于排序 | 已投影 | 授权和反刷量仍设计态。 |
| `ReputationAdjusted` | `reputation` | reputation score 更新 | 可用于排序 | 已投影 | 需防滥用。 |
| `BadgeIssued` | `badge` | `badges` | 可显示质量徽章 | 已投影 | 需 issuer 白名单和撤销策略。 |
| `CrossChainPaymentReceived` | `payment` | `payments` | 不进公共搜索 | 已投影 | 合约事件可显示，真实 relayer 仍缺。 |

## 4. 搜索边界审计

### 4.1 Public

预期：

- public metadata、abstract、body、skill description、workflow summary 可索引。
- 游客无需登录即可搜索和查看。

当前状态：

- `ResearchReportPublished` 的 public report 会进入 `search_documents`。
- asset 和 skill 会进入 search。

风险：

- 搜索结果必须展示 chain/Walrus provenance，否则用户不能区分真实 indexed 数据和 demo/local 数据。

### 4.2 Encrypted

预期：

- 只索引 metadata 和 free preview。
- 不索引明文、Seal key、ciphertext 原文。

当前状态：

- encrypted report 进入 `search_documents`，body 使用 `free_preview`。
- ciphertext/hash/Seal 字段只进入 metadata/report record，不作为 body。

风险：

- 前端 demo fallback 中本地保存 plaintext 便于交互测试，生产 UI 必须确保 encrypted 明文不被写入公共 index 或持久化公共 storage。

### 4.3 Private Delegation

预期：

- private result 不进入公共搜索。
- 只在 buyer、agent、争议仲裁者授权视图中可查。

当前状态：

- `ResearchReportPublished` 遇到 `private_delegation` 会删除 search doc。
- Delegation job 本身当前会创建 delegation search doc，内容为 buyer + agent。

风险：

- 产品需要决定 `DelegationCreated` 是否公开可搜。若私有委托的存在本身也敏感，delegation search doc 应改为仅授权视图可查。
- Indexer API 需要支持按 caller address 做授权过滤，否则 UI 只能在前端过滤，安全语义不足。

## 5. 数据模型能力审计

| 查询问题 | 当前 IndexState 是否支持 | 缺口 |
| --- | --- | --- |
| 游客搜索 public/encrypted preview | 支持 | 语义向量检索未实现。 |
| 资产页展示 manifest、Walrus、Sui、Git commit | 部分支持 | 需要实时 Walrus manifest fetcher 和 hash 验证。 |
| Skill 页面展示 install/fork tree | 部分支持 | install 计数、fork tree、dependency graph 需要更完整 projection/query。 |
| Account 页面展示我的发布 | 部分支持 | 需要稳定的 address/github/account binding 和生产数据库。 |
| Account 页面展示我的会员/订阅/委托 | 支持本地状态 | 需要按 caller 过滤的服务端 API。 |
| Agent earnings unclaimed | 支持 | 需要真实 claim tx 和 receipt 对账。 |
| 平台会员月末分账 | 部分支持 | 需要账期、scheduler、重复结算检测和财务 receipt。 |
| 私有委托授权查询 | 部分支持 | 需要服务端权限过滤和 Seal policy 结果回填。 |
| Cross-chain payment 状态 | 部分支持 | 需要 relayer 状态机：pending、bridged、settled、failed。 |

## 6. 生产化缺口

### 6.1 常驻调度

当前 poller V1 可以手动运行，但生产需要：

- per-package/module checkpoint。
- 失败事件重试。
- dead-letter queue。
- lag 指标。
- replay 和 reindex 操作审计。
- 多 RPC fallback。

建议指标：

```text
indexer_latest_checkpoint
indexer_event_lag_ms
indexer_failed_event_count
indexer_replay_duration_ms
walrus_manifest_fetch_failure_count
search_zero_result_rate
```

### 6.2 存储

当前本地 `index.json` 适合开发，不适合生产。生产建议：

- PostgreSQL：events、assets、reports、delegations、memberships、earnings。
- pgvector/Qdrant：semantic search。
- Redis/queue：manifest fetch、embedding、retry。
- Object cache：Walrus manifest/package read-through cache。

### 6.3 Walrus manifest fetcher

发布事件只给链上 hash/blob，页面需要 manifest 才能展示：

- title、abstract、tags、authors。
- PDF/README/workflow/skill file map。
- legal terms/access policy。
- relationships。

生产 fetcher 必须：

1. 拉取 Walrus blob。
2. 校验 manifest hash。
3. 解包或读取 manifest。
4. 校验 schema。
5. 写入 asset/search/graph。
6. 失败时标记 `invalid` 或 `pending_manifest`，不要把未校验内容当真。

### 6.4 API 授权过滤

需要区分：

- public read：游客可访问。
- personalized read：需要 L1 zkLogin 地址。
- decrypt/action read：需要 L2 signer 或 Seal policy 成功。
- private delegation read：buyer/agent/dispute arbitrator。

Indexer 本身是 projection，不应该承担所有权限判断，但 API 不得把 private records 直接无过滤返回给浏览器。

## 7. Indexer 验收清单

每条 E2E 应收集以下 Indexer 证据：

| 证据 | 说明 |
| --- | --- |
| raw event | `tx_digest`、`event_seq`、`event_type`、payload。 |
| normalized event | Sui raw event 到 `ProtocolEvent` 的映射结果。 |
| processed key | `tx_digest:event_seq` 进入 `processed_event_keys`，重复 replay 不重复投影。 |
| projection record | 对应 `reports`、`delegations`、`access_receipts`、`agent_earnings` 等记录存在。 |
| search record | public/encrypted preview 存在，private result 不存在。 |
| graph edge | asset-report、cite、fork、skill dependency 等边存在。 |
| API response | `/api/search`、`/api/reports`、`/api/delegations`、`/api/assets/:id/economics` 返回符合 UI 需求。 |

最低生产门禁：

1. `research index:poll` 能从当前 testnet package 读到真实事件。
2. 同一事件重复 poll 不重复计数。
3. Walrus manifest hash mismatch 会阻止资产进入可交易状态。
4. private delegation result 不出现在游客搜索、首页、公开 API 列表。
5. membership receipt 和 settlement replay 后 agent earnings 不重复增长。

