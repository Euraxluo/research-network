# 合约功能审计

## 1. 审计边界

本审计面向产品能力，不替代形式化安全审计。重点回答：

- 用户行为是否有明确的链上对象承载。
- 合约入口是否能发出 Indexer 可消费的事件。
- 合约状态是否足以支撑 UI 判断和收入结算。
- 哪些能力已经可验收，哪些仍处于设计态或生产阻塞。

当前 canonical 裁决来自 `../17-implementation-status-and-decisions.md`：

- 废弃旧 `license.move` / License NFT 路线。
- 商业访问围绕 `Agent`、`ResearchReport`、`AccessPass`、`DelegationJob`。
- 内容类型为 `public`、`encrypted`、`private_delegation`。
- `revenue.move` 只作为底层分账兼容工具，不再作为产品命名。

## 2. 合约模块总览

| 模块 | 产品能力 | 关键对象 | 关键入口 | 事件 | 状态 | 审计结论 |
| --- | --- | --- | --- | --- | --- | --- |
| `research_asset.move` | Research Asset 注册、引用、fork | `ResearchAsset` | `publish_research_asset`、`cite_asset`、`record_fork` | `ResearchAssetPublished`、`AssetCited`、`AssetForked` | 已实现 | 可作为资产事实源。产品仍需 Web 端完整 GitHub repo 发布向导和真实 index 等待。 |
| `skill.move` | Skill 发布与安装 | `SkillAsset` | `publish_skill`、`install_skill` | `SkillPublished`、`SkillInstalled` | 已实现 | Skill 可作为一等资产进入 graph。付费 Skill 不再走 license，应通过 report 或订阅解锁。 |
| `report.move` | public/encrypted/private 报告发布 | `ResearchReport` | `publish_public_report`、`publish_encrypted_report`、`publish_private_result` | `ResearchReportPublished` | 已实现 | Seal Access 的内容对象已成立。真实产品要保证 Walrus blob、Seal id、hash commitment 全部来自同一发布流水线。 |
| `access.move` | 平台会员、agent 订阅、Seal 解密策略、访问 receipt | `PlatformMembershipPass`、`AgentSubscriptionPass`、`AccessReceipt` | `seal_approve_*`、package 内 mint/record | `PlatformMembershipPurchased`、`AgentSubscriptionPurchased`、`AccessReceiptRecorded` | 已实现 | 解密策略和 receipt 计量核心已具备。需重点回归过期、tier 不足、错误 agent、重复 receipt。 |
| `delegation.move` | 私有委托状态机和争议授权 | `DelegationJob` | `create_delegation_job`、`accept_delegation_job`、`fund_delegation_job`、`complete_delegation_job`、`refund_expired_delegation_job`、`open_dispute`、`resolve_dispute` | `DelegationCreated`、`DelegationAccepted`、`DelegationFunded`、`DelegationResultSubmitted`、`DelegationCompleted`、`DelegationRefunded`、`DelegationDisputeOpened`、`DelegationDisputeResolved` | 已实现 | 状态机覆盖核心委托链。仲裁者只能在 `DISPUTED` 状态解密，`RESOLVED` 后权限关闭，符合产品承诺。 |
| `settlement.move` | 会员购买、agent 订阅支付、会员 receipt 结算、agent claim | `SettlementConfig`、`AgentEarnings`、`MembershipReceiptRegistry`、`AgentChannel` | `buy_platform_membership`、`buy_agent_subscription`、`record_platform_access_receipt`、`settle_membership_report`、`claim_agent_earnings` | `PlatformMembershipPaid`、`AgentSubscriptionPaid`、`MembershipSettlementCreated`、`MembershipReportSettled`、`AgentEarningsClaimed` | 部分实现 | 链上资金路径存在。需要产品层明确 `PlatformMembershipPaid` 与 `PlatformMembershipPurchased` 的查询语义，避免 Indexer 漏投影。 |
| `revenue.move` | 底层 revenue pool 兼容 | `RevenuePool` | `create_revenue_pool`、`deposit_revenue`、`record_revenue_claim` | `RevenuePoolCreated`、`RevenueDeposited`、`RevenueClaimed` | 已实现 | 适合兼容早期资产收益池，但不是 Seal Access 产品主线。 |
| `payment.move` | 跨链支付结算记录 | `SettlementRegistry`、`SettlerCap` | `settle_cross_chain_payment` | `CrossChainPaymentReceived` | 部分实现 | 合约防重复订单的基础存在。真实 CCTP/Wormhole VAA 验签、relayer、价格和状态 UI 未闭环。 |
| `agent.move` | Agent passport | `AgentPassport` | `create_passport` | `AgentPassportCreated` | 部分实现 | 有身份对象和事件，但还缺 UI/权限/密钥生命周期产品闭环。 |
| `reputation.move` | 声誉分 | `Reputation` | `create_reputation`、`add_reputation` | `ReputationCreated`、`ReputationAdjusted` | 设计态/骨架 | 事件骨架存在，反刷量和授予权限仍需产品规则。 |
| `badge.move` | Badge / Attestation | `Badge` | `issue_badge` | `BadgeIssued` | 设计态/骨架 | 需要 issuer 白名单、撤销、争议和 UI 展示规则。 |

## 3. 产品能力审计

### 3.1 Research Asset 注册与来源证明

目标用户故事：

- 研究者从 GitHub repo 发布论文、代码、数据、workflow 和 skill。
- 浏览者可在页面看到 Sui object id、Walrus blob id、manifest hash、content hash、commit hash。
- Fork 和引用关系能进入 Research Graph。

链上承载：

- `ResearchAsset` 记录 owner、creator、asset type mask、version、manifest hash、Walrus blob id、repo commit、parent assets、created timestamp。
- `AssetCited`、`AssetForked` 提供 graph 边。

审计结论：

- 合约对象足以承载发布事实和 graph 边。
- 合约不存全文，这是正确边界，全文和 manifest 在 Walrus。
- Web 发布向导必须把 GitHub commit、Walrus upload、Sui tx、Indexer wait 做成一个一致事务。若 Walrus 成功但上链失败，需要 pending release 和 retry 注册。

产品风险：

- `asset_id` 和展示编号必须区分。链上 id 是 `ra:sui:<object_id>`，`RA:2026.00001` 只能是 Indexer 展示编号。
- `manifest_hash` 与 Walrus blob readback 必须在 UI 和 acceptance receipt 中证明，否则用户无法判断内容是否被替换。

验收建议：

- 发布一个含 paper + skill + workflow 的 repo。
- 合约发出 `ResearchAssetPublished` 和 `SkillPublished`。
- Indexer 生成资产页、Skill 页和 `publishes_skill`/`has_report`/`cites` 等边。
- UI 页面显示并可复制 object id、blob id、commit、manifest hash。

### 3.2 ResearchReport 和 Seal Access

目标用户故事：

- Agent 发布公开报告，任何人可读。
- Agent 发布加密报告，只有作者、平台会员、agent 订阅者能解密。
- Agent 提交私有委托结果，只有买家和执行 agent 能解密；争议中仲裁者临时可解密。

链上承载：

- `ResearchReport.visibility` 使用三值：public、encrypted、private_delegation。
- encrypted/private 报告写入 `walrus_blob_id`、`seal_id`、`ciphertext_hash`、`plaintext_commitment`、`free_preview_hash`。
- `seal_approve_report_author`、`seal_approve_report_with_platform_membership`、`seal_approve_report_with_agent_subscription`、`seal_approve_private_result` 作为 Seal key server policy。

审计结论：

- 当前模型符合“Walrus 存密文，Seal 根据链上状态判断解密资格”的设计。
- `seal_id` 由发布者选择并嵌入 ciphertext，合约 policy 校验 `id == report.seal_id`，解决了对象 id 交易后才生成的问题。
- private delegation 默认平台不可见；只有 job 处于 `DISPUTED` 且 caller 为 arbitrator 时可解密，`RESOLVED` 后 `arbitrator` 被清空，解密权限关闭。

产品风险：

- UI 必须明确区分 `free_preview` 与真实明文，不得在搜索索引或 DOM 中泄露 encrypted/private 明文。
- 解密成功不等于自动生成 receipt。平台会员路径需要链上 `record_platform_access_receipt`，直接 agent subscription 不应占平台会员池。
- 会员过期后是否还能解密历史内容，文档裁决为不能。E2E 必须覆盖过期拒绝。

验收建议：

- encrypted 报告发布后，Walrus readback 字节应与 ciphertext hash 匹配。
- 外人解密失败，作者解密成功，会员解密成功并能记录 receipt，agent subscriber 解密成功但不产生 platform_member receipt。
- private result 在 submitted 后，buyer 和 agent 解密成功，outsider 失败，arbitrator 只有 dispute 期间成功。

### 3.3 平台会员、Agent 订阅和 AccessReceipt

目标用户故事：

- 用户购买平台会员后可以阅读符合 tier 的 encrypted 报告。
- 用户直接订阅某个 agent 后可阅读该 agent 的 encrypted 报告。
- 平台会员阅读会生成唯一 receipt，用于月末分账。
- 同一用户、同一周期、同一报告不能重复计量。

链上承载：

- `access.move` mint `PlatformMembershipPass`、`AgentSubscriptionPass`。
- `settlement.move` 的 `record_platform_access_receipt` 用 `MembershipReceiptRegistry.seen` 防重复。
- `AccessReceiptRecorded` 发出 receipt 事实。

审计结论：

- 访问凭证和 receipt 唯一性已经有链上保护。
- `assert_agent_subscription_access` 明确校验 pass owner、agent、expires、tier。
- 结算幂等由 `AgentEarnings.settled_receipts` 阻止同一 receipt 重复结算。

产品风险：

- 合约同时存在访问层事件 `PlatformMembershipPurchased` 和支付层事件 `PlatformMembershipPaid`。产品查询若只消费其中一个，会导致“pass 已有但支付状态不显示”或“支付显示但 pass 不显示”的错位。
- 会员周期 `period_id` 的生成规则是产品/后端责任，需要固定为 UTC 月、链上 epoch、或平台账期之一，不能由 UI 随意输入。
- 结算支付来源当前由 `settle_membership_report` 的 `Coin<SUI>` 输入承担。平台账务和链上资金池之间需要生产账本对账。

验收建议：

- 买会员交易返回 `PlatformMembershipPass` object，事件中含 owner、tier、expires。
- 解密后记录 receipt，重复记录同一 `(period_id, user, report_id)` 应失败。
- `settle_membership_report` 对同一 receipt 二次结算应失败。
- `claim_agent_earnings` 后 agent 余额变化应进入 acceptance receipt。

### 3.4 私有委托状态机

目标用户故事：

- 买家定向委托 agent 做研究并托管预算。
- Agent 接受、提交私有结果。
- 买家验收后放款。
- 过期可退款。
- 争议时仲裁者临时解密，解决后按 bps 分配 escrow。

链上状态：

```text
Open -> Accepted -> Funded -> Submitted -> Completed
Open/Accepted/Funded -> Refunded 或 Expired
Funded/Submitted -> Disputed -> Resolved
```

审计结论：

- 合约入口覆盖主流程和异常流程。
- `fund_delegation_job` 校验 buyer、status、expected budget、coin amount。
- `complete_delegation_job` 只能 buyer 调用，并要求 submitted。
- `resolve_dispute` 只能 arbitrator 调用，要求 buyer_bps + agent_bps = 10000。

产品风险：

- 当前 `open_dispute` 允许状态为 `SUBMITTED` 或 `FUNDED`。若 `FUNDED` 未提交报告，仲裁者虽可成为临时解密方，但没有 result report 可读；UI 必须清楚区分“资金争议”和“结果争议”。
- `refund_expired_delegation_job` 对 Open/Accepted/Funded 可用，但 Submitted 后不可直接过期退款。产品需明确 Submitted 之后只能 complete/dispute。
- 仲裁者身份来源和治理白名单仍是设计态，不能把任意地址 arbitrator 当作正式平台仲裁。

验收建议：

- happy path：create -> accept -> fund -> publish_private_result -> buyer decrypt -> complete -> agent 收到 payout。
- negative path：外人 accept/fund/complete 均失败；budget mismatch 失败；deadline 前 refund 失败。
- dispute path：arbitrator dispute 前不能解密，dispute 中能解密，resolved 后不能解密。

### 3.5 收益、分账和 Claim

目标用户故事：

- 作者或 agent 能看到自己 unclaimed 收益。
- Agent 能 claim 到真实 SUI。
- 平台抽成和 agent 净收入可审计。

链上承载：

- 直接订阅：`buy_agent_subscription` split fee 后把 net 计入 `AgentEarnings`。
- 会员池：`settle_membership_report` 把 amount_per_report 计入 agent earnings。
- claim：`claim_agent_earnings` 从 `AgentEarnings.balance` 中取 coin 并转给 agent。

审计结论：

- 链上收益余额和已领取余额可查询。
- claim 以 sender 作为 agent 身份，避免替他人领取。
- 需要 UI 侧展示 `total_earned`、`total_claimed`、`unclaimed`，并链接 tx。

产品风险：

- 平台会员费在 `buy_platform_membership` 中转给 treasury，net portion 在注释中描述为 off-chain payment ledger 到结算时入账。产品需要清楚展示：会员费不是直接进入链上共享池，而是后续结算时由平台提供结算 coin。
- 若平台不按期调用 `settle_membership_report`，agent earnings 不会增加。需要 settlement scheduler 和审计日志。

### 3.6 跨链支付

目标用户故事：

- 用户可用 EVM/Solana/Sui 等支付入口购买会员、订阅或创建委托，最终在 Sui canonical registry 激活访问。

链上承载：

- `payment.move` 提供 `settle_cross_chain_payment`，通过 `SettlementRegistry` 防重复 order。
- 事件 `CrossChainPaymentReceived` 可被 Indexer 投影。

审计结论：

- 订单去重和 Sui 侧 settlement record 有基础。
- 真实跨链产品还缺 relayer、CCTP/Wormhole attestation 验证、支付状态机、失败重试和前端 pending/settled UI。

上线建议：

- 不把跨链支付放入 V1 真实资金路径。
- 先完成 Sui 原生支付和 Seal Access production acceptance，再开放跨链。

### 3.7 Reputation、Badge、治理和 Token

目标用户故事：

- 用户根据 verified reads、订阅、委托、引用、复现等行为判断 agent/asset 质量。
- 平台能治理垃圾内容、抄袭、恶意引用和争议。

当前状态：

- `agent.move`、`reputation.move`、`badge.move` 存在对象和事件骨架。
- `docs/08`、`docs/12` 给出 token、策展质押、仲裁、badge 类型等设计。

审计结论：

- 不能把 reputation/token/governance 作为已实现卖点。
- 当前最小可用质量信号应来自 Indexer 投影：真实阅读、真实订阅、真实委托完成、真实引用/fork、badge 事件。

## 4. 合约到 Indexer 的事件契约风险

必须冻结以下事件名和 payload，否则会出现“链上成功但页面不更新”：

| 产品事实 | 合约事件 | Indexer 当前预期 | 风险 |
| --- | --- | --- | --- |
| 平台会员 pass 被 mint | `PlatformMembershipPurchased` | 已投影 | 稳定。 |
| 平台会员支付发生 | `PlatformMembershipPaid` | 当前未在 `applyEvent` switch 中单独投影 | 若 UI 要展示支付金额、platform fee、duration，应补投影或明确只展示 pass。 |
| Agent subscription pass 被 mint | `AgentSubscriptionPurchased` | 已投影 | 稳定。 |
| Agent subscription 支付进入 earnings | `AgentSubscriptionPaid` | 已投影 | 稳定。 |
| 会员 receipt 记录 | `AccessReceiptRecorded` | 已投影 | 稳定。 |
| 会员 receipt 结算 | `MembershipReportSettled` | 已投影 | 稳定。 |
| 私有委托结果提交 | `DelegationResultSubmitted` | 已投影 | 稳定。 |

建议新增一个机器可读的事件契约文档或 fixture：

```text
move-event-fixtures/
├── PlatformMembershipPurchased.json
├── PlatformMembershipPaid.json
├── ResearchReportPublished.encrypted.json
├── DelegationDisputeResolved.json
└── CrossChainPaymentReceived.json
```

每个 fixture 同时用于 Move event shape、Sui normalizer、Indexer、API response 和 UI snapshot。

## 5. 合约验收门禁

合约层进入生产前，应至少满足：

1. `rtk npm run move:build` 通过。
2. `rtk sui move test --path move --silence-warnings` 通过。
3. 最新 testnet package、shared objects、Seal key server、Walrus endpoint 全部写入配置并被 `readiness:mainnet` 校验。
4. 两个真实 zkLogin 账号完成 testnet preflight 和 capped execute。
5. production acceptance receipt 包含 tx digest、object ids、events、balanceChanges、Walrus blob id、Seal id、hash evidence、spend cap。
6. mainnet 只允许小额 capped acceptance，且 readiness report `ready: true` 后才能对外宣称正式网可用。

