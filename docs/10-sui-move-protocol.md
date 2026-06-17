# 10. Sui Move 协议设计

> **状态提示**：本篇描述当前 `move/sources/` 的 Seal Access 协议目标态与本地实现。旧 `license.move` / License NFT 路线已删除。最新源码已发布到 Sui testnet package `0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e`，并完成真实 Walrus + Seal + Sui author decrypt 回归；mainnet 仍未验收，不能注入正式资金。

## 包结构

```text
move/
├── Move.toml
└── sources/
    ├── research_asset.move
    ├── skill.move
    ├── report.move
    ├── access.move
    ├── delegation.move
    ├── settlement.move
    ├── revenue.move
    ├── agent.move
    ├── reputation.move
    ├── badge.move
    └── payment.move
```

## 设计原则

- 链上只存最小可信状态。
- 内容在 Walrus；encrypted/private 内容只存密文。
- Seal 判断解密资格，不把明文暴露给链上或平台。
- 搜索在 Indexer；private delegation 不进入公共搜索。
- 所有核心行为 emit event。
- 付费访问围绕 `PlatformMembershipPass`、`AgentSubscriptionPass` 和 `DelegationJob`，不再使用 License NFT。
- `revenue.move` 只作为底层分账工具；产品语义以 `settlement.move` 为准。

## ResearchAsset Object

```move
struct ResearchAsset has key, store {
    id: UID,
    owner: address,
    creator: address,
    asset_type_mask: u64,
    version: String,
    manifest_hash: vector<u8>,
    walrus_blob_id: vector<u8>,
    repo_commit: vector<u8>,
    parent_assets: vector<ID>,
    created_ms: u64,
}
```

`asset_type_mask`：

```text
1 = paper
2 = skill
4 = workflow
8 = dataset
16 = experiment
32 = benchmark
64 = code
128 = review
```

## Skill Object

Skill 是能力资产。可被公开引用、vendored、fork，也可以随某个 encrypted report 的包一起由 Seal Access 解锁。

```move
struct SkillAsset has key, store {
    id: UID,
    owner: address,
    creator: address,
    name_hash: vector<u8>,
    version: String,
    manifest_hash: vector<u8>,
    walrus_blob_id: vector<u8>,
    source_asset_id: ID,
    derived_from: Option<ID>,
    dependencies: vector<ID>,
    created_ms: u64,
}
```

## ResearchReport

`ResearchReport` 是 agent 发布的研究报告：

```text
0 = public
1 = encrypted
2 = private_delegation
```

字段包含：

```move
struct ResearchReport has key, store {
    id: UID,
    agent: address,
    asset_id: Option<ID>,
    visibility: u8,
    required_tier: u64,
    walrus_blob_id: vector<u8>,
    seal_id: vector<u8>,
    ciphertext_hash: vector<u8>,
    plaintext_commitment: vector<u8>,
    free_preview_hash: vector<u8>,
    delegation_job_id: Option<ID>,
    created_ms: u64,
}
```

入口：

- `publish_public_report`
- `publish_encrypted_report`
- `publish_private_result`

`publish_private_result` 只能由对应 delegation job 的执行 agent 调用。

## Access

访问凭证：

```move
struct PlatformMembershipPass has key, store
struct AgentSubscriptionPass has key, store
struct AccessReceipt has key, store
```

规则：

- public 报告不需要 Seal。
- encrypted 报告允许作者、有效平台会员、有效 agent 订阅者解密。
- 平台会员解密后生成 receipt，用于月末分账。
- 同一用户、同一周期、同一报告只能有一个有效 receipt。
- 会员或订阅过期后，不再允许请求 Seal 解密历史 encrypted 内容。
- 直接订阅 agent 的阅读不占平台会员分账池。

## DelegationJob

私有委托状态：

```text
Open / Accepted / Funded / Submitted / Completed / Refunded / Disputed / Resolved / Expired
```

规则：

- 买家定向委托某个 agent。
- 默认验收者是买家。
- 私有结果只能由买家和执行 agent 解密。
- 平台默认不能看。
- 争议状态下，买家或 agent 任意一方可打开 dispute，并授权平台仲裁者临时 Seal 解密资格。
- 仲裁结束后权限关闭。

## Settlement

`settlement.move` 处理：

- 平台会员费。
- Agent 订阅费。
- 私有委托 escrow。
- 平台抽成。
- Agent earnings。

平台会员周期结算：

```text
member monthly fee
- platform fee
= net pool

net pool / unique encrypted reports decrypted by this member in this period
=> per-report payout to report agent
```

## 核心事件

```text
ResearchAssetPublished
AssetCited
AssetForked
SkillPublished
SkillInstalled
ResearchReportPublished
AgentChannelCreated
PlatformMembershipPurchased
AgentSubscriptionPurchased
AccessReceiptRecorded
DelegationCreated
DelegationAccepted
DelegationFunded
DelegationResultSubmitted
DelegationCompleted
DelegationRefunded
DelegationDisputeOpened
DelegationDisputeResolved
AgentSubscriptionPaid
MembershipSettlementCreated
MembershipReportSettled
AgentEarningsClaimed
RevenuePoolCreated
RevenueDeposited
RevenueClaimed
AgentPassportCreated
ReputationCreated
ReputationAdjusted
BadgeIssued
CrossChainPaymentReceived
```

## 错误码

```text
E_INVALID_BPS_SUM
E_INVALID_MANIFEST_HASH
E_NOT_OWNER
E_ACCESS_DENIED
E_EXPIRED_PASS
E_DUPLICATE_RECEIPT
E_INVALID_VISIBILITY
E_INVALID_DELEGATION_STATE
E_NOT_BUYER
E_NOT_AGENT
E_NOT_ARBITRATOR
E_ALREADY_SETTLED
E_ALREADY_PROCESSED_ORDER
E_INSUFFICIENT_PAYMENT
```

## 测试用例

当前 Move 测试覆盖：

- `license.move` 删除后 build 通过。
- 发布 public / encrypted / private delegation 报告。
- encrypted report：作者、平台会员、agent 订阅者可通过访问判断；外人失败。
- membership 过期后解密失败。
- private delegation：买家和 agent 可解密，平台默认失败；争议授权后仲裁者可临时解密。
- delegation escrow：完成放款、过期退款、争议结算、重复结算失败。
- platform membership settlement：按唯一报告均分，平台抽成后进入 agent 可领取余额。
- 旧 revenue/payment/research_asset/skill 基础行为保持可测试。
