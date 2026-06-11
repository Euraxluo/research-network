# 10. Sui Move 协议设计

> **状态提示**：本篇描述的是目标态（v2）。当前 `move/sources/` 的实现是事件公证层骨架，与本篇存在已知差距（无 Coin 托管、无权限校验、部分 struct 字段未实现），差距清单与信任边界见 docs/17。函数命名以已部署代码为准（docs/17 裁决 1）。

## 包结构

```text
move/research_protocol/
├── Move.toml
└── sources/
    ├── research_asset.move
    ├── skill.move
    ├── license.move
    ├── revenue.move
    ├── agent.move
    ├── reputation.move
    ├── badge.move
    ├── payment.move
    ├── registry.move   # 规划中，尚未创建
    └── errors.move     # 规划中，尚未创建
```

## 设计原则

- 链上只存最小可信状态。
- 内容在 Walrus。
- 搜索在 Indexer。
- 所有核心行为 emit event。
- 所有付费行为进入 RevenuePool。
- 所有可下载付费 Skill 由 License NFT 控制。

## ResearchAsset Object

字段：

```move
struct ResearchAsset has key, store {
    id: UID,
    owner: address,
    creator: address,
    asset_type_mask: u64,
    version: String,
    title_hash: vector<u8>,
    manifest_hash: vector<u8>,
    walrus_blob_id: vector<u8>,
    repo_commit: vector<u8>,
    license_id: Option<ID>,
    revenue_pool_id: Option<ID>,
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
    license_policy_id: Option<ID>,
    revenue_pool_id: Option<ID>,
    created_ms: u64,
}
```

## License NFT

```move
struct SkillLicense has key, store {
    id: UID,
    skill_id: ID,
    license_type: u8,
    owner: address,
    issued_ms: u64,
    expires_ms: Option<u64>,
    commercial: bool,
    agent_allowed: bool,
    seats: u64,
}
```

## RevenuePool

```move
struct RevenuePool has key, store {
    id: UID,
    asset_id: ID,
    recipients: vector<address>,
    weights_bps: vector<u64>,
    total_received: u64,
    claimed: Table<address, u64>,
}
```

## Agent Passport

```move
struct AgentPassport has key, store {
    id: UID,
    owner: address,
    agent_hash: vector<u8>,
    metadata_blob_id: vector<u8>,
    reputation: u64,
    created_ms: u64,
}
```

## 核心事件

```move
struct ResearchAssetPublished has copy, drop {
    asset_id: ID,
    owner: address,
    asset_type_mask: u64,
    version: String,
    walrus_blob_id: vector<u8>,
    manifest_hash: vector<u8>,
    repo_commit: vector<u8>,
    created_ms: u64,
}

struct SkillPublished has copy, drop {
    skill_id: ID,
    source_asset_id: ID,
    owner: address,
    version: String,
    walrus_blob_id: vector<u8>,
    manifest_hash: vector<u8>,
    derived_from: Option<ID>,
    dependencies: vector<ID>,
    created_ms: u64,
}

struct LicensePurchased has copy, drop {
    license_id: ID,
    skill_id: ID,
    buyer: address,
    price_paid: u64,
    currency_type: String,
    created_ms: u64,
}
```

## 入口函数

| 当前实现（已部署） | 目标态（v2） | 说明 |
| --- | --- | --- |
| `publish_research_asset` | 同名 | v2 增加 `license_id`/`revenue_pool_id` 关联 |
| `publish_skill` | 同名 | |
| `cite_asset` | 同名 | v2 增加资产存在性与权限校验 |
| `record_fork` | 同名 | 文档曾用名 `fork_asset` |
| `install_skill` | 同名 | v2 增加 License 校验 |
| `mint_license` | `purchase_license` | v2 收取 `Coin<USDC>` 并进入 RevenuePool；当前为无支付自助铸造 |
| — | `create_license_policy` | 尚未实现 |
| `create_revenue_pool` | 同名 | v2 改 shared object + `Table` |
| `record_revenue_claim` | `claim_revenue` | v2 实际转出 Coin |
| `create_passport` | 同名 | 文档曾用名 `create_agent_passport` |
| `issue_badge` | 同名 | |
| `add_reputation` | `accrue_reputation` | |
| `settle_cross_chain_payment` | 同名 | v2 必须验证 CCTP/Wormhole attestation |

## 错误码

```text
E_INVALID_BPS_SUM
E_INVALID_MANIFEST_HASH
E_NOT_OWNER
E_LICENSE_REQUIRED
E_ALREADY_PROCESSED_ORDER
E_INVALID_DEPENDENCY
E_EXPIRED_LICENSE
E_INSUFFICIENT_PAYMENT
```

## 测试用例

> 当前 `move/` 下没有任何测试。以下用例是 v2 的强制验收项，实施时在 `move/tests/` 落地。

- 发布 Paper + Skill + Workflow 组合资产。
- 发布 Skill，并声明 derived_from。
- 购买 License NFT（含支付不足拒绝）。
- 通过 License 验证安装；无 License 安装付费 Skill 被拒绝。
- 收益分账：实际 Coin 按 bps 分配，重复领取拒绝。
- 重复 order_id 跨链结算拒绝；非授权 relayer 调用结算拒绝。
- 事件字段正确。
- Indexer 能根据事件获取 Walrus Manifest。
