# E2E 用户故事场景

## 1. 目标

本文件把产品需求翻译成 E2E 场景。每个场景都必须同时覆盖：

- 前端：用户看到什么、点什么、错误/成功如何展示。
- 合约：触发哪些 Move 入口和事件。
- Indexer：投影出哪些记录、哪些内容可搜索或不可搜索。
- Walrus/Seal：上传、读取、加密、解密和 hash evidence。

这些场景可以拆成三层执行：

| 层级 | 用途 |
| --- | --- |
| 本地模拟 E2E | 快速回归 UI 状态机，不花钱，不证明真实链上。 |
| Testnet production acceptance | 真实 zkLogin、Walrus、Seal、Sui、Indexer，带资金上限，生成 receipt。 |
| UI acceptance | 用普通用户浏览器路径验证真实页面交互，生成截图/trace/receipt。 |

## 2. 公共前置条件

执行真实 testnet E2E 前必须准备：

1. 最新 testnet package 和 shared object 配置与 `DEFAULT_M3_CONFIG` 一致。
2. Walrus publisher/aggregator 和 Seal key server 可用。
3. 两个不同 Google zkLogin 账号：
   - `agentA`：发布 report、接受委托、claim earnings。
   - `buyerB`：购买会员、订阅、创建委托、完成验收。
4. 可选第三个账号：
   - `outsiderO`：未购买、未订阅、非委托参与方。
   - `arbitratorM`：争议仲裁者。
5. GitHub App 已对至少一个个人账号或组织 repo 授权。
6. Indexer 能 poll 当前 package 并写入测试 index。
7. E2E receipt 目录位于 `.research-network/acceptance/`，不得提交敏感 session。

## 3. 场景 S0：游客浏览公开内容

用户故事：

游客像逛 arXiv 一样无需登录即可搜索和阅读公开研究。

系统流程：

1. 游客打开首页或 `/search`。
2. 搜索关键字。
3. 点击 public report 或 public asset。
4. 查看 abstract/free preview、PDF/source、Sui object、Walrus blob、manifest hash、Git commit。

合约事件：

- 前置已存在 `ResearchAssetPublished` 或 `ResearchReportPublished(visibility=public)`。

Indexer 断言：

- public asset/report 存在于 `search_documents`。
- private delegation result 不出现在结果中。

UI 断言：

- 未登录也能打开。
- 页面没有强制登录弹窗。
- 所有 provenance 字段可见。

负向断言：

- 点击解锁类动作才要求登录。
- private delegation result 不可通过 URL 猜测公开打开。

## 4. 场景 S1：zkLogin 登录并连接 GitHub 组织/repo

用户故事：

研究者先用 Google zkLogin 获得 Sui 地址，再连接 GitHub App，选择授权 account/org 和 repo。

前端步骤：

1. 打开 `/account.html`。
2. 点击 Sign in with Google。
3. 完成 Google OAuth，返回站点。
4. 页面显示 zkLogin address。
5. 点击 Connect GitHub repos。
6. GitHub OAuth 返回 `/auth/github-callback.html`。
7. 页面展示 account/org scopes。
8. 用户多选一个或多个已授权 scope。
9. 用户从 repo 下拉中选择目标 research repo。

系统和合约：

- 本场景不需要 Move tx。
- API 调用 GitHub OAuth 和 `/user/installations`/installation repos/org membership。
- 服务端签发 binding attestation，绑定到 Sui address。

Indexer 断言：

- 无链上事件。
- 服务端 account store 或后续 DB 记录 GitHub binding。

UI 断言：

- 未登录时 GitHub 按钮提示先 zkLogin。
- 已授权组织 checkbox 可选。
- 未授权组织 checkbox disabled，并显示需要安装或批准 GitHub App。
- repo 下拉只包含选中 scope 下的 repo。
- 选中 repo 被持久化到 `rn_github.selected_repo` 或服务端 binding。

负向断言：

- 篡改 localStorage 不能显示 server-attested。
- GitHub OAuth state mismatch 不消费 code，触发安全恢复或要求重新登录。

## 5. 场景 S2：Agent 发布 public report

用户故事：

Agent A 发布公开研究报告，任何人可读，内容可以被搜索。

前端步骤：

1. Agent A 登录并确认 L2 signer ready。
2. 在 Workbench 或 Publish UI 选择 repo。
3. 填写 report title、public visibility、free preview、body。
4. 点击 Publish。
5. 页面展示 pending 状态。
6. 发布成功后展示 tx digest、report object id、Walrus blob id、readback hash。

合约入口和事件：

- Walrus：上传 plaintext blob。
- Move：`report::publish_public_report`。
- 事件：`ResearchReportPublished(visibility=public)`。

Indexer 断言：

- `reports[report_id].visibility == public`。
- `search_documents[report_id]` 存在。
- 若关联 asset，存在 `has_report` relationship。

UI 断言：

- 游客可刷新页面后看到报告。
- 不出现 Seal 解密按钮或付费要求。
- provenance 信息完整。

负向断言：

- 如果 Walrus readback hash 不匹配，UI 不应显示发布成功。

## 6. 场景 S3：Agent 发布 encrypted report 并自解密

用户故事：

Agent A 发布加密研究报告，Walrus 只保存密文，作者可以自解密验证发布成功。

前端步骤：

1. Agent A 选择 encrypted visibility。
2. 输入 free preview 和 plaintext body。
3. 点击 Publish。
4. 系统生成 Seal id，Seal encrypt plaintext。
5. 上传 ciphertext 到 Walrus。
6. 发起 `publish_encrypted_report` 交易。
7. 发布后 Agent A 点击 Decrypt as author。

合约入口和事件：

- Move：`report::publish_encrypted_report`。
- Seal policy：`access::seal_approve_report_author`。
- 事件：`ResearchReportPublished(visibility=encrypted)`。

Indexer 断言：

- `reports[report_id].visibility == encrypted`。
- `reports[report_id].seal_id` 存在。
- `reports[report_id].ciphertext_hash` 存在。
- `search_documents[report_id].body` 只包含 free preview，不包含 plaintext。

UI 断言：

- 页面显示 Locked 状态和 free preview。
- 作者自解密成功并显示 plaintext。
- provenance 包含 Walrus readback evidence、Seal id、ciphertext hash、plaintext commitment。

负向断言：

- plaintext 不应出现在游客 DOM 或搜索 API response。

## 7. 场景 S4：平台会员购买、解密、receipt、结算和 claim

用户故事：

Buyer B 购买平台会员，解密 Agent A 的 encrypted report，生成唯一 receipt；平台按 receipt 结算给 Agent A，Agent A claim 到 SUI。

前端步骤：

1. Buyer B 登录并确认 L2 signer ready。
2. 打开 encrypted report。
3. 点击 Buy platform membership。
4. 购买成功后页面显示 membership pass object id 和 expires。
5. Buyer B 点击 Decrypt。
6. 解密成功后点击或自动触发 Record access receipt。
7. 系统运行 membership settlement。
8. Agent A 打开收益页，看到 unclaimed。
9. Agent A 点击 Claim。

合约入口和事件：

- `settlement::buy_platform_membership`
- `access::mint_platform_membership_pass`
- `settlement::record_platform_access_receipt`
- `settlement::settle_membership_report`
- `settlement::claim_agent_earnings`
- 事件：
  - `PlatformMembershipPaid`
  - `PlatformMembershipPurchased`
  - `AccessReceiptRecorded`
  - `MembershipSettlementCreated`
  - `MembershipReportSettled`
  - `AgentEarningsClaimed`

Indexer 断言：

- `platform_memberships` 有 Buyer B pass。
- `access_receipts` 有 `(period_id, Buyer B, report_id, access_type=platform_member)`。
- `membership_settlements` 有 report settlement。
- `agent_earnings[Agent A].total_earned` 增加。
- claim 后 `total_claimed` 增加。

UI 断言：

- 解密前显示需要会员或订阅。
- 购买后显示 active membership。
- 解密成功显示 plaintext。
- receipt id 和 tx digest 可见。
- Agent A 的 unclaimed 从 0 变为正数，claim 后归零或减少。

负向断言：

- 同一用户、同一周期、同一报告重复 receipt 失败。
- 会员过期后再次解密失败。

## 8. 场景 S5：直接订阅 Agent 并解密，不占平台会员池

用户故事：

Subscriber S 直接订阅 Agent A，能读该 agent 的 encrypted report；该次阅读归类为 agent subscription，不参与平台会员分账池。

前端步骤：

1. Subscriber S 打开 Agent A 的 encrypted report。
2. 点击 Subscribe Agent。
3. 订阅成功后点击 Decrypt。

合约入口和事件：

- `settlement::buy_agent_subscription`
- `access::mint_agent_subscription_pass`
- Seal policy：`seal_approve_report_with_agent_subscription`
- 事件：
  - `AgentSubscriptionPaid`
  - `AgentSubscriptionPurchased`

Indexer 断言：

- `agent_subscriptions` 有 Subscriber S -> Agent A pass。
- `agent_earnings[Agent A].total_earned` 因 subscription payment 增加。
- 不应新增 `AccessReceiptRecorded(access_type=platform_member)`。

UI 断言：

- 订阅成功后显示 active subscription。
- 解密成功。
- UI 标注 access type 为 agent subscription。

负向断言：

- Subscriber S 不能用 Agent A 的 pass 解密 Agent C 的 report。
- 订阅过期后解密失败。

## 9. 场景 S6：未授权用户被拒绝访问 encrypted report

用户故事：

Outsider O 未购买会员、未订阅 agent，只能看 preview，不能解密。

前端步骤：

1. Outsider O 打开 encrypted report。
2. 点击或尝试 Decrypt。

合约/Seal：

- Seal policy 应 abort 或 key server 拒绝返回足够 shares。

Indexer 断言：

- 不新增 receipt。
- 不新增 earnings。

UI 断言：

- 显示 `needs_membership_or_subscription` 或同等用户友好文案。
- 不显示 plaintext。
- 给出购买会员或订阅 agent 的入口。

负向断言：

- 刷新、复制 URL、切换 actor 不应绕过。

## 10. 场景 S7：私有委托 happy path

用户故事：

Buyer B 委托 Agent A 做研究。Agent A 提交私有结果，Buyer B 和 Agent A 可解密，Outsider O 不可解密，Buyer B 完成验收后 Agent A 收款。

前端步骤：

1. Buyer B 打开 Agent A 页面。
2. 点击 Delegate research。
3. 输入问题、source artifact、预算、deadline。
4. 创建 delegation job。
5. Agent A 接受 job。
6. Buyer B fund job。
7. Agent A 提交 private result。
8. Buyer B 解密查看结果。
9. Agent A 解密自查。
10. Outsider O 尝试打开，失败。
11. Buyer B 点击 Complete。

合约入口和事件：

- `delegation::create_delegation_job`
- `delegation::accept_delegation_job`
- `delegation::fund_delegation_job`
- `report::publish_private_result`
- `delegation::mark_submitted` 由 report package 内调用
- `delegation::complete_delegation_job`
- 事件：
  - `DelegationCreated`
  - `DelegationAccepted`
  - `DelegationFunded`
  - `ResearchReportPublished(visibility=private_delegation)`
  - `DelegationResultSubmitted`
  - `DelegationCompleted`

Indexer 断言：

- `delegations[job_id].status` 依次为 open、accepted、funded、submitted、completed。
- `delegations[job_id].result_report_id` 指向 private report。
- private report 存在于 `reports`。
- private report 不存在于 `search_documents`。

UI 断言：

- Buyer/Agent 可见 job 和结果。
- Outsider 不显示 plaintext。
- Complete 后 job 状态为 completed，并显示 payout tx。

负向断言：

- 非 buyer 不能 fund/complete。
- 非 agent 不能 accept/submit。
- budget mismatch 失败。

## 11. 场景 S8：私有委托争议和仲裁临时解密

用户故事：

Buyer B 对私有结果不满意，打开 dispute。Arbitrator M 在 dispute 期间可临时解密结果，resolve 后权限关闭。

前端步骤：

1. 延续 S7 到 submitted 状态。
2. Arbitrator M 先尝试解密，失败。
3. Buyer B 点击 Open dispute，指定 Arbitrator M。
4. Arbitrator M 再次解密，成功。
5. Arbitrator M resolve dispute，设置 buyer_bps 和 agent_bps。
6. Arbitrator M 再次尝试解密，失败。

合约入口和事件：

- `delegation::open_dispute`
- Seal policy：`seal_approve_private_result`
- `delegation::resolve_dispute`
- 事件：
  - `DelegationDisputeOpened`
  - `DelegationDisputeResolved`

Indexer 断言：

- dispute opened 后 `delegations[job_id].status == disputed`，`arbitrator == M`。
- resolved 后 `status == resolved`，payout/refund 记录存在。

UI 断言：

- dispute 前显示 arbitrator denied。
- dispute 中显示 arbitrator temporary access active。
- resolved 后显示 arbitrator access closed。
- 资金分配结果和 tx digest 可见。

负向断言：

- 非 buyer/agent 不能 open dispute。
- 非 arbitrator 不能 resolve。
- buyer_bps + agent_bps != 10000 失败。

## 12. 场景 S9：GitHub repo 发布完整 Research Asset

用户故事：

研究者选择已授权 repo，校验 `asset.yaml`，打包上传 Walrus，注册 ResearchAsset 和 Skill，Indexer 渲染资产页。

前端步骤：

1. 用户登录 L2 并连接 GitHub repo。
2. 选择 repo 和 branch/commit。
3. 点击 Validate。
4. UI 展示 schema/file/legal/access/revenue split 检查。
5. 点击 Package。
6. UI 展示 manifest hash、file count、storage estimate。
7. 点击 Publish。
8. Walrus 上传 release package。
9. Sui 注册 asset/skill/citation/fork。
10. UI 等待 Indexer indexed。
11. 跳转资产页。

合约事件：

- `ResearchAssetPublished`
- `SkillPublished`
- 可选 `AssetCited`
- 可选 `AssetForked`
- 可选 `ResearchReportPublished`

Indexer 断言：

- asset 存在。
- skill 存在。
- manifest 被 fetch 并 hash match。
- search doc 存在。
- graph 边存在。

UI 断言：

- Validate 错误不能继续发布。
- Walrus 成功但 Sui 失败时进入 pending retry，而不是显示成功。
- 发布成功页提供 asset URL、tx digest、blob id。

负向断言：

- secret leak 命中时阻止发布。
- encrypted/private 缺 Seal 字段时阻止发布。
- revenue split bps 不等于 10000 时阻止发布。

## 13. 场景 S10：Mainnet readiness 防误用

用户故事：

团队准备切 mainnet，但系统必须拒绝 testnet object id、testnet endpoint、缺失 receipt 或 dirty provenance。

执行步骤：

1. 配置 `network=mainnet`。
2. 故意注入 testnet package/shared object/Walrus/Seal endpoint。
3. 运行 Web build、production acceptance dry-run、mainnet readiness。
4. 再替换为 mainnet 配置，但缺少 testnet execute receipt。
5. 再提供旧 commit 或 dirty tree receipt。

预期：

- Web config 拒绝 testnet 值。
- `api/walrus.ts` 拒绝 mainnet 下缺少显式 Walrus 配置。
- `web-auth.ts` 拒绝 mainnet 下 testnet auth RPC。
- `readiness:mainnet` 拒绝缺少 receipt、receipt provenance 不匹配、经济参数不一致、超过 cap。

UI 断言：

- Mainnet 下无 signer 不允许本地 demo publish、membership purchase、delegation create。
- 页面明确显示当前 network 和 package id。

## 14. E2E 证据包格式

每次真实 E2E 应产出一个非敏感 receipt：

```json
{
  "schema": "research-network-e2e-receipt/v1",
  "network": "testnet",
  "scenario": "S4-platform-membership-decrypt-settle-claim",
  "actors": {
    "agent": "0x...",
    "buyer": "0x..."
  },
  "config": {
    "packageId": "0x...",
    "settlementConfigId": "0x...",
    "agentEarningsId": "0x...",
    "walrusAggregatorUrl": "...",
    "sealKeyServers": []
  },
  "steps": [
    {
      "name": "publish_encrypted_report",
      "txDigest": "...",
      "createdObjects": [],
      "events": [],
      "walrusBlobId": "...",
      "sealId": "...",
      "ciphertextHash": "sha256:...",
      "plaintextCommitment": "sha256:...",
      "uiEvidence": {
        "screenshot": "...",
        "text": "Report published"
      }
    }
  ],
  "indexer": {
    "processedEventKeys": [],
    "searchAssertions": [],
    "privateSearchLeakCheck": "passed"
  },
  "spend": {
    "maxSpendMist": "110000000",
    "totalSpentMist": "..."
  },
  "provenance": {
    "gitCommit": "...",
    "gitTreeState": "clean"
  }
}
```

不得写入 receipt：

- Google id_token。
- zkLogin ephemeral secret key。
- GitHub user access token。
- Seal plaintext。
- 私有委托完整问题文本或结果全文。

## 15. 最小发布门禁矩阵

| 阶段 | 必跑场景 |
| --- | --- |
| 本地开发 PR | S0、S1 demo、S3 demo、S6、S7 demo、S10 config guard。 |
| Testnet release candidate | S1、S2、S3、S4、S5、S6、S7、S8，全部真实 Walrus/Seal/Sui。 |
| Mainnet readiness | S10 全部通过，加 testnet preflight/execute receipt 与 mainnet preflight。 |
| Mainnet 小额上线 | S2、S3、S4、S7 小额 capped execute，确认 spend cap 和 rollback/暂停开关。 |
