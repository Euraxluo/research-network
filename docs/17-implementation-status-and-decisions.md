# 17. 实施状态、规范裁决与实施 Agent 指南

**实施 Agent 必须先读本篇，再读其他文档。**

docs/01-16 可能保留历史设计脉络；本篇给出当前代码与产品语义的最终裁决。文档与本篇冲突时，以本篇为准；文档与代码冲突且本篇未裁决时，以代码为准，并顺手修正文档。

## 当前总裁决

2026-06-15 起，商业访问协议改为 **Seal Access**：

- 旧 `license.move` / License NFT / paid skill license 路线已删除。
- 新核心对象是 `Agent`、`ResearchReport`、`AccessPass`、`DelegationJob`。
- 内容可见性是 `public`、`encrypted`、`private_delegation`。
- encrypted/private 内容只在 Walrus 存密文，Seal 判断解密资格。
- 平台会员、agent 订阅、私有委托和结算以 `report.move`、`access.move`、`delegation.move`、`settlement.move` 为准。
- `revenue.move` 可以作为底层分账工具保留，但不再作为产品命名。

## 实施状态矩阵

| 能力 | 状态 | 位置 | 说明 |
| --- | --- | --- | --- |
| Schema / 模板 / `init` / `validate` / `package` | ✅ 已实现 | `src/core/`、`schemas/`、`templates/` | `asset.yaml`/`skill.yaml` 已使用 `access`；旧 product license 字段不再必填 |
| 本地 `publish` / `replay` / `search` / `fork` / `install` | ✅ 已实现（本地模拟） | `src/core/adapters.ts`、`indexer.ts` | 本地 publish 会生成 `ResearchReportPublished`，并投影 report/search/graph |
| REST API / SDK / CLI | ✅ 已实现（本地后端） | `src/api/`、`src/core/sdk.ts`、`src/cli.ts` | 新增 reports/channels/delegations/access intent；旧 `/licenses` 和 `license:intent` 已移除 |
| 静态站点生成 + Walrus Sites + Vercel 入口 | ✅ 已实现 | `src/core/web.ts`、`web-auth.ts`、`api/walrus.ts`、`vercel.json` | Web 已从 Licenses 切到 Membership / Delegations；Vercel shell + Walrus proxy 仍按历史部署策略工作；mainnet 部署会拒绝默认 testnet Walrus/auth 配置 |
| Move 合约（Seal Access 本地源码） | ✅ 已实现 + Move 测试 | `move/sources/`、`move/tests/` | 新增 report/access/delegation/settlement，删除 license；本地 build/test 通过 |
| Move 包 testnet 部署 | ✅ 最新源码已发布到 testnet | `move/Published.toml`、docs/16 | 当前 package `0x5ecd...231e` 包含 `settled_receipts` 幂等保护；已完成真实 Walrus + Seal + Sui author decrypt 回归 |
| zkLogin | 🔶 真实地址派生 + salt service + CLI login + Web signer | `src/core/zklogin.ts`、`web-auth.ts`、`api/zklogin-salt.ts`、`web/src/lib/signer.ts` | Web signer 已对交易和 Seal personal message 组装 zkLogin composite signature；真实验收仍需要两个浏览器 zkLogin 会话文件和 prover |
| GitHub App 仓库接入 | 🔶 真实流程已实现 + 测试 + 生产配置已补齐 | `src/core/github.ts`、`github-binding.ts`、`api/github-oauth.ts` | 站内 repo 下拉、server-signed binding attestation、server-side account store V1 已实现 |
| Indexer 事件投影 | 🔶 全量本地目录 + Sui RPC poller V1 | `src/core/indexer.ts`、`sui-events.ts` | 新增 report/membership/subscription/receipt/delegation/settlement/earnings 投影；剩生产常驻调度和实时 Walrus fetcher |
| Seal Access 交易闭环 | 🔶 Web 真实路径已接入；两账号生产验收待跑 | `web/src/lib/`、`scripts/production-acceptance.ts` | Web 已接真实 Walrus + Seal + Sui publish/decrypt/purchase/delegation/claim；新增带资金上限的 production acceptance runner。Web/Vite config、Vercel Walrus proxy、auth shell 和 acceptance 均会拒绝 mainnet 混入已知 testnet 值。仍需两个真实 zkLogin 账号完成 `--preflight`/`--execute` 验收 |
| 跨链支付 CCTP / Wormhole | 🔶 合约入口历史实现；真实 VAA 待接 | `move/sources/payment.move`、docs/09 | payment intent 已改为 access intent；真实 relayer/prover 仍未完成 |
| Token / 声誉 / 治理 / 仲裁 | ❌ 仅设计 / 局部事件骨架 | docs/08、docs/12 | 仲裁在 private delegation dispute 中有最小授权语义；完整治理仍未实现 |

## 信任边界声明

本轮 Seal Access 重构是**本地协议、schema、indexer、web、生产验收脚手架和测试**变更。不要对外宣称当前源码已经可上 mainnet，除非之后明确执行并记录：

1. 使用两个真实 zkLogin 账号运行 `npm run acceptance:production -- --network testnet --preflight ...`，确认 session/prover/地址派生一致性/余额无资金预检通过。
2. 使用同一组账号运行 `npm run acceptance:production -- --network testnet --execute ...` 并保留 receipt。
3. 确认 production Web 配置、indexer 和部署环境均指向该 testnet package/shared objects；Web 使用 `VITE_RN_*` 或 `window.__RN_M3_CONFIG__` 注入，Vercel API 使用 `RN_WEB_NETWORK`/`WALRUS_NETWORK`、`WALRUS_SITE_OBJECT_ID`、`WALRUS_SUI_RPC_URL`、`WALRUS_AGGREGATOR_URL`、`AUTH_SUI_RPC_URL`。
4. 再切换 mainnet package/shared objects/RPC/Walrus/Seal key server 配置并跑小额 mainnet preflight + acceptance。

历史部署记录仍有价值：

- v0.1 package `0x03d2...` 是早期骨架，保留为历史记录。
- v2 revenue/payment package `0x1c8ecc...` 曾完成真实 SUI revenue 入池和领取冒烟验证，详见 docs/16。
- M4-2 package `0x7a1eed5292d80ea04f37f18fbbfdd1fd7774becc7c4f85972ebe16e16183a283` 曾完成真实 Walrus + Seal author decrypt 验证，现保留为历史包。
- Current testnet package `0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e` 包含 `settlement::AgentEarnings.settled_receipts`，防止同一个 `AccessReceipt` 重复结算；Web 默认 testnet 配置已指向该包。

对外可说：

- 本地 Seal Access Move 源码、TS/web/indexer 和 production acceptance dry-run 已实现并测试通过。
- 最新 Seal Access package 已发布到 testnet，并完成真实 Walrus + Seal + Sui author decrypt 回归。
- 私有委托内容默认平台不可见，只有 dispute 授权后仲裁者可临时解密。
- mainnet 还未部署/验收，不允许注入正式资金运行。

## 规范裁决

### 裁决 1：商业访问命名

| 废弃命名 | 新命名 |
| --- | --- |
| License NFT | AccessPass / PlatformMembershipPass / AgentSubscriptionPass |
| Skill license purchase | access intent / subscription / membership |
| `/api/licenses` | `/api/reports`、`/api/agent-channels`、`/api/delegations` |
| `license:intent` | `access:intent` |
| paid skill unlock | Seal Access decrypt eligibility |

法律意义上的开源协议、论文版权条款、数据使用条款仍然可以存在，但必须放在 `legal_terms` 或仓库 `LICENSE`，不能用来表达平台访问权。

### 裁决 2：Move 模块目录

Canonical 模块：

```text
research_asset, skill, report, access, delegation, settlement,
revenue, agent, reputation, badge, payment
```

`license` 不再是协议模块。

### 裁决 3：事件目录

Canonical 事件目录：

```text
ResearchAssetPublished, AssetCited, AssetForked,
SkillPublished, SkillInstalled,
ResearchReportPublished,
AgentChannelCreated,
PlatformMembershipPurchased, AgentSubscriptionPurchased,
AccessReceiptRecorded,
DelegationCreated, DelegationAccepted, DelegationFunded,
DelegationResultSubmitted, DelegationCompleted, DelegationRefunded,
DelegationDisputeOpened, DelegationDisputeResolved,
AgentSubscriptionPaid,
MembershipSettlementCreated, MembershipReportSettled, AgentEarningsClaimed,
RevenuePoolCreated, RevenueDeposited, RevenueClaimed,
AgentPassportCreated,
ReputationCreated, ReputationAdjusted,
BadgeIssued,
CrossChainPaymentReceived
```

`AssetRelationshipRegistered` 是本地模拟专用事件；真链使用 `AssetCited` / `AssetForked`。

### 裁决 4：Asset ID 格式

canonical ID：`ra:<network>:<identifier>`，不含版本。

- 链上：`ra:sui:<sui_object_id>`
- 本地模拟：`ra:local:<hash>`
- 引用特定版本：`ra:sui:0xabc...@0.2.0`
- `RA:2026.00001` 是 Indexer 展示编号，不上链、不作身份标识。

### 裁决 5：Release Manifest

`schema: research-asset-manifest/v0.1` 的 canonical 结构仍是 `src/core/packager.ts` 输出的扁平结构：顶层 `schema / repo / commit / asset_yaml_hash / content_hash / created_at / files / assets / skills / workflows / relationships / manifest_hash`。

新增访问控制字段在 `asset.yaml` / `skill.yaml` 的 `access` 中表达，不改变 release manifest 顶层结构。

### 裁决 6：CLI 命令

以 `src/cli.ts` 为准：

```text
research reports [report-id]
research channels
research delegations [job-id]
research access:intent --kind platform_membership|agent_subscription|private_delegation
```

历史 `research licenses` / `research license:intent` 不再使用。

## 实施 Agent 工作守则

1. **开工前确认基线绿色**：`npm install && npm run build && npm test`，Move 改动还要跑 `npm run move:build` 和 `sui move test --path move --silence-warnings`。
2. **不要恢复旧 License 模型**：新增访问、订阅、委托、解密都接 Seal Access。
3. **不要默认部署 Sui**：本轮要求是本地协议与测试；testnet 发布必须由用户单独拍板。
4. **private delegation 默认不可搜索、平台不可见**：只有买家、agent 和 dispute 临时仲裁者能解密。
5. **文档与代码同步**：修改 API/CLI/schema/indexer 时同步 OpenAPI、docs/06、docs/10、docs/18。
6. **安全红线**：不提交 `.env`/私钥；validator 的 secret 扫描保持启用；`.research-network/deployments/*.json` 保持 gitignored。
7. **版本控制**：保留用户/其他 Agent 既有改动，不做无关回退；`dist/` 不入库，以 build 重建。

## 验证命令

本轮完成标准：

```bash
npm run build
npm test
npm run web:build
npm run move:build
sui move test --path move --silence-warnings
```

在本 Codex 环境中执行命令需按根目录 AGENTS 指示加 `rtk` 前缀。

## 生产验收命令

Dry-run 只校验配置、预算和步骤，不读取 session，不会花钱：

```bash
npm run acceptance:production -- --network testnet --receipt .research-network/acceptance/dry-run.json
```

Preflight 会读取两个不同 zkLogin 会话文件，检查地址、当前 epoch、余额和 prover，不会发交易、不花钱：

两个会话文件可在 `/account.html` 从完成 Google zkLogin 的同一浏览器 tab 导出：buyer 账号点击 **Export buyer session**，agent 账号重新登录后点击 **Export agent session**，再分别移动到 `.research-network/secrets/acceptance-buyer.json` 和 `.research-network/secrets/acceptance-agent.json`。这些文件含 ephemeral zkLogin 材料，严禁提交。

```bash
ZKLOGIN_PROVER_URL=https://<prover> \
npm run acceptance:production -- --network testnet --preflight \
  --buyer-session .research-network/secrets/acceptance-buyer.json \
  --agent-session .research-network/secrets/acceptance-agent.json \
  --receipt .research-network/acceptance/testnet-preflight.json
```

真实 testnet production acceptance 必须显式传入同一组会话文件和资金上限：

```bash
ZKLOGIN_PROVER_URL=https://<prover> \
npm run acceptance:production -- --network testnet --execute \
  --buyer-session .research-network/secrets/acceptance-buyer.json \
  --agent-session .research-network/secrets/acceptance-agent.json \
  --max-spend-mist 110000000 \
  --receipt .research-network/acceptance/testnet-production.json
```

会话文件必须来自真实 Google zkLogin 登录，放在 `.research-network/secrets/`，包含 `address`、`ephemeralSecretKey`、`idToken`、`salt`、`maxEpoch`、`randomness`，也可以使用浏览器 storage 形状的 `rn_zk_eph` / `rn_zk_session`。脚本覆盖 encrypted report 发布、平台会员购买、Seal 解密、receipt 记录、agent subscription 购买与解密、会员 receipt 结算、agent claim、私有委托创建/资金托管/结果提交/买家解密/完成放款。`--execute` 会真实花费 testnet/mainnet SUI，预算由 `--max-spend-mist` 硬限制；`--network mainnet` 会拒绝已知 testnet object ids 和 testnet endpoints。

Mainnet readiness gate 用来汇总“是否可上 mainnet/注入真实资金”的证据，默认不花钱：

```bash
npm run readiness:mainnet -- --stage mainnet-config \
  --testnet-preflight-receipt .research-network/acceptance/testnet-preflight.json \
  --testnet-execute-receipt .research-network/acceptance/testnet-production.json \
  --skip-chain
```

`--stage mainnet-config` 要求 testnet preflight + capped execute receipt 已通过，并且 acceptance/Web/Vercel/Auth/prover mainnet 配置都存在、无 testnet 泄漏、关键 RPC/object/endpoint 在各部署面之间一致。`--stage mainnet-final` 还要求 mainnet preflight + 小额 capped execute receipt 通过、mainnet receipt 中的配置与当前 acceptance env 完全一致；不加 `--skip-chain` 时还会查询 mainnet RPC，确认 package/shared objects 存在，且 settlement shared objects 类型匹配预期。只有 readiness report `ready: true` 时，才可以说当前证据支持正式网资金运行。

Web/Vercel 生产配置防护：

- Vite 构建可用 `VITE_RN_NETWORK`、`VITE_RN_SUI_RPC_URL`、`VITE_RN_PACKAGE_ID`、`VITE_RN_SETTLEMENT_CONFIG_ID`、`VITE_RN_AGENT_EARNINGS_ID`、`VITE_RN_MEMBERSHIP_RECEIPT_REGISTRY_ID`、`VITE_RN_WALRUS_PUBLISHER_URL`、`VITE_RN_WALRUS_AGGREGATOR_URL`、`VITE_RN_SEAL_KEY_SERVER_OBJECT_ID`、`VITE_RN_SEAL_KEY_SERVER_AGGREGATOR_URL` 注入，也可继续使用 `window.__RN_M3_CONFIG__` runtime 注入。
- `network: "mainnet"` 时，Web config 会拒绝默认 testnet package/shared objects、testnet RPC、testnet Walrus endpoint 和 testnet Seal key server。
- `api/walrus.ts` 在 `RN_WEB_NETWORK=mainnet` 或 `WALRUS_NETWORK=mainnet` 时必须显式配置 Walrus Site object、Sui RPC 和 aggregator，并拒绝 testnet 值。
- `web-auth.ts` 在 `RN_WEB_NETWORK=mainnet` 或 `AUTH_NETWORK=mainnet` 时必须显式配置 `AUTH_SUI_RPC_URL`，并拒绝 testnet RPC，避免正式登录页仍按 testnet epoch 构造 zkLogin session。

## 修订记录

- 2026-06-17：Account 页新增 production acceptance session 导出入口，可从真实同 tab Google zkLogin 状态生成 buyer/agent session JSON；新增纯函数与 UI 集成测试覆盖成功导出和缺失 ephemeral key 时失败闭合。
- 2026-06-17：加硬 mainnet readiness gate。mainnet receipts 现在会拒绝已知 testnet object ids、超过小额 acceptance cap 的 execute receipt、与当前 mainnet acceptance env 不一致的 receipt 配置；链上 object 检查会额外验证 settlement shared object 类型后缀。
- 2026-06-17：补生产配置防误用 guard。Web/Vite config、Vercel Walrus proxy、auth shell 与 production acceptance 均拒绝 mainnet 混入已知 testnet object ids/endpoints；acceptance 会校验 zkLogin session 中可选 `address` 必须等于 `idToken + salt` 派生地址。
- 2026-06-17：新增 `npm run readiness:mainnet` 可执行门禁，检查 testnet/mainnet acceptance receipts、mainnet env/Web/Vercel/Auth/prover 配置和可选链上 object 存在性，防止把 dry-run 或缺失凭据误判为 mainnet ready。
- 2026-06-15：Seal Access 协议重构。删除 `license.move` / license tests；新增 `report.move`、`access.move`、`delegation.move`、`settlement.move`；schema/API/CLI/SDK/indexer/web 从 licenses 改为 reports/access/membership/subscriptions/delegations；新增 Move 和 TS 测试；testnet 重发包留待单独决策。
