# 17. 实施状态、规范裁决与实施 Agent 指南

**实施 Agent 必须先读本篇，再读其他文档。**

docs/01–14 描述的是目标态设计；本目录同时包含一个可运行的本地协议实现（`src/`）和一套已部署到 testnet 的 Move 合约（`move/`）。三者进度不同，且历史上存在命名不一致。本篇做三件事：

1. 给出**实施状态矩阵**：哪些已实现、哪些是本地模拟、哪些仅是设计。
2. 给出**规范裁决**：文档之间、文档与代码之间冲突时的最终结论。
3. 给出**实施 Agent 工作守则**。

冲突处理规则：其他文档与本篇裁决冲突时，以本篇为准；文档与代码冲突且本篇未裁决时，以代码为准，并顺手修正文档。

## 实施状态矩阵

| 能力 | 状态 | 位置 | 说明 |
| --- | --- | --- | --- |
| Schema / 模板 / `init` / `validate` / `package` | ✅ 已实现 | `src/core/`、`schemas/`、`templates/` | vitest 覆盖 |
| 本地 `publish` / `replay` / `search` / `fork` / `install` | ✅ 已实现（**本地模拟**） | `src/core/adapters.ts`、`indexer.ts` | 事件由本地 adapter 生成，非链上事件 |
| REST API / SDK / CLI | ✅ 已实现（本地后端） | `src/api/`、`src/core/sdk.ts`、`src/cli.ts` | 无鉴权、无生产级数据库 |
| 静态站点生成 + Walrus Sites 部署 | ✅ 已实现 | `src/core/web.ts`、`testnet.ts` | testnet 已验证，见 docs/16 |
| Move 合约 | ⚠️ 骨架（事件公证层） | `move/sources/` | 见下文信任边界；**没有 Move 测试** |
| Move 包 testnet 部署 | ✅ 已完成 | `move/Published.toml`、docs/16 | 升级用 upgrade-capability |
| zkLogin | 🔶 模拟 | `src/core/auth.ts` | 地址为本地确定性派生，无真实 proof / prover |
| GitHub App 仓库接入 | ❌ 仅设计 | docs/04 | `auth:start` 只生成授权 URL，无 installation token 流程 |
| 真链 Indexer（消费 Sui 事件） | ❌ 仅设计 | docs/06 | 本地 replay 已有；不消费链上事件 |
| 支付 / License / 分账（真实资金） | ❌ 仅设计 | docs/08、09 | 合约不收 Coin，License 可免费自铸 |
| 跨链支付 CCTP / Wormhole | ❌ 仅设计 | docs/09 | 结算入口无 attestation 验证 |
| Token / 声誉 / 治理 / 仲裁 | ❌ 仅设计 | docs/08、12 | — |

## 信任边界声明（重要）

**当前 Move 合约是"事件公证层"，不是"执行层"。链上数据目前不能作为经济事实源。** 具体：

- `revenue::record_revenue_claim`：任何人可调用，`amount` 由调用者随意填写，无 Coin 转账，`total_received` 永不更新；`RevenuePool` 是 owned object（transfer 给创建者），其他受益人无法操作。
- `payment::settle_cross_chain_payment`：无权限控制、无跨链 attestation 验证（无 Wormhole VAA / CCTP 校验），任何人可凭空"结算"；`processed_orders` 用 vector 线性查重，gas 随订单数无上限增长。
- `license::mint_license`：无支付、无权限，任何人可免费给自己铸造任意 Skill 的 License。
- `research_asset::cite_asset` / `record_fork`：不验证资产存在性和调用者权限，引用/Fork 图谱可被任意刷写。
- 所有 `created_ms` / `issued_ms` 由调用者传入而非链上 `Clock`，时间戳可伪造。

这对原型阶段是可接受的，但意味着：**所有经济安全目前都在链下；任何 UI、文档、对外说明不得暗示链上支付/License/分账已生效。**

Move v2 升级必须包含：Coin<SUI>/Coin<USDC> 托管与结算、shared object + `Table`、capability 对象做权限控制、`Clock` 取时、跨链消息 attestation 验证、Move 单元测试（docs/10 测试用例清单）。

## 规范裁决

### 裁决 1：合约入口函数命名以已部署代码为准

testnet 包已发布（package id 见 `move/Published.toml`），命名锁定为现有实现。历史文档中的旧名一律按下表理解：

| 文档曾用名 | 实际函数（canonical） | 备注 |
| --- | --- | --- |
| `register_research_asset` | `research_asset::publish_research_asset` | |
| `register_skill` | `skill::publish_skill` | |
| `fork_asset` | `research_asset::record_fork` | |
| `claim_revenue` | `revenue::record_revenue_claim` | v2 改为真实领取 |
| `create_agent_passport` | `agent::create_passport` | |
| `accrue_reputation` | `reputation::add_reputation` | |
| `purchase_license`（收 Coin） | 当前为 `license::mint_license`（不收款） | v2 升级为收 Coin 版本，届时再命名 `purchase_license` |
| `mint_asset_nft` | **不存在** | v2 规划 |
| `create_license_policy` | **不存在** | v2 规划 |
| `register_relationships` | **不存在** | 链上用 `cite_asset` / `record_fork` 表达关系 |

`registry.move`、`errors.move`（docs/10 包结构）尚不存在，属规划文件。

### 裁决 2：事件目录与 Indexer 对接

链上真实事件（`move/sources/` 实际 emit）：

```text
ResearchAssetPublished, AssetCited, AssetForked,
SkillPublished, SkillInstalled,
LicensePurchased,
RevenuePoolCreated, RevenueClaimed,
AgentPassportCreated,
ReputationCreated, ReputationAdjusted,
BadgeIssued,
CrossChainPaymentReceived
```

- 文档曾用名 `ReputationAccrued` = 实际 `ReputationAdjusted`。
- **`AssetRelationshipRegistered` 是本地模拟专用事件**（`src/core/adapters.ts` 生成），链上不存在。对接真链时，Indexer 必须改为消费 `AssetCited` / `AssetForked` 并投影为 relationship；本地事件仅为开发期桥接。
- 当前本地 Indexer（`src/core/indexer.ts`）只处理 3 种事件：`ResearchAssetPublished`、`SkillPublished`、`AssetRelationshipRegistered`。接真链前必须扩展到全量事件目录。

### 裁决 3：Asset ID 格式

文档中出现过 `ra:local:<hash>`、`ra:sui:0xabc:1`、`RA:2026.00001` 三种写法。裁决如下：

- **canonical ID**：`ra:<network>:<identifier>`，不含版本。
  - 链上：`ra:sui:<sui_object_id>`
  - 本地模拟：`ra:local:<hash>`（现有实现）
- 引用特定版本时用 `@` 后缀：`ra:sui:0xabc...@0.2.0`。版本是资产对象的字段，不是身份的一部分。
- `RA:2026.00001` 是 Indexer 分配的**展示编号**（arXiv 风格 display number），仅用于页面渲染和人类引用，不上链、不作身份标识。
- `asset.yaml` 中 `id: null` 的语义：首次发布前为 null；发布时由注册流程（本地或链上）分配并写入 manifest；ID 一经分配不可变，后续版本沿用。

### 裁决 4：Release Manifest 以 v0.1 实现为准

`schema: research-asset-manifest/v0.1` 的 canonical 结构是**扁平结构**（docs/03 §3 与 `src/core/packager.ts` 实际输出一致）：顶层 `schema / repo / commit / asset_yaml_hash / content_hash / created_at / files / assets / skills / workflows / relationships / manifest_hash`。

docs/05 早期版本中的嵌套结构（`repo: {}`、`walrus: {}`、`hashes: {}`）作废；其中的增量能力（单独 PDF blob、manifest blob 引用）列入 v0.2 提案，引入时必须升级 schema 版本号。

relationship 字段名：manifest 内为 `src_id` / `dst_id`（packager 实现）；数据库投影为 `src_asset_id` / `dst_asset_id`（docs/06 SQL）。映射由 Indexer 负责，新代码不要混用两套名字。

### 裁决 5：CLI 命令以 `src/cli.ts` 为准

| 文档曾用写法 | 实际命令 |
| --- | --- |
| `research site publish` / `research-cli site publish` | `research web:build` + `research deploy:testnet` |
| `research-agent install ...` | `research install ...` |
| `research cite ...` | 尚未实现（规划中） |

## 实施 Agent 工作守则

1. **开工前确认基线绿色**：`npm install && npm run build && npm test && npm run demo`。任何改动后这四条必须保持通过。
2. **选工作流看依赖图**（docs/15），结合状态矩阵当前推荐的下一步（按价值排序）：
   - Move v2 经济安全（信任边界清单逐条消除 + Move 测试）；
   - GitHub App 真实接入（工作流 B）；
   - 真链 Indexer（工作流 F，按裁决 2 扩展事件处理）。
   不要在同一时间并行修改同一模块。
3. **命名纪律**：新增函数/事件/字段前先查裁决 1、2、4，不要引入第四套命名。
4. **每完成一项能力**：更新本篇状态矩阵、docs/15 对应工作流的状态行，并补测试。完成标准以 docs/15 各工作流"完成标准"为验收口径。
5. **Move 改动**：先在 `move/tests/` 补测试，`sui move build` + `sui move test` 通过后再部署；升级使用 `Published.toml` 记录的 upgrade-capability，**不要重新发包**导致 package id 漂移。
6. **不得对外暗示链上经济已生效**（见信任边界），直到 Move v2 落地。
7. **安全红线**：不提交 `.env`/私钥；validator 的 secret 扫描保持启用；`.research-network/deployments/*.json` 含环境敏感信息，保持 gitignore。
8. **版本控制**：本目录当前尚未 `git init`，开始持续开发前先初始化仓库；`dist/` 不入库（加入 `.gitignore`），以 `npm run build` 重建。

## 修订记录

- 2026-06-11：创建本篇；按裁决 1–5 同步修正 docs/00、03、05、06、07、09、10、11、15 与 README。
