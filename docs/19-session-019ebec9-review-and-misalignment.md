# Session 019ebec9 审查报告：原始 Plan 与用户故事链路

> 本文档独立记录 codex session `019ebec9-9fc3-79b0-a0d8-89729920aeae`（2026-06-13 → 2026-06-15）的完整脉络：
> 1. **附原始 plan 全文**（MSG #38，"Seal 驱动的 Agent 研究商业协议"重构方案）
> 2. **按用户故事维度梳理** 50 条用户消息还原出的真实需求链
> 3. **标注错位**：HANDOFF.md 的"修复完成"声明 vs 用户后期追加的真实需求之间的鸿沟
>
> 审查依据：session rollout 文件（50 条用户消息全文）+ 实际项目代码/产物（非声明）。
> 配合 `HANDOFF.md` / `DIAGNOSTICS.md` 阅读。本文不覆盖 `DIAGNOSTICS.md` 已记录的逐轮技术细节。

---

## 一、原始 Plan 全文（MSG #38，2026-06-15 03:11:27）

> 以下为 session 中用户给出的完整实施计划原文，逐字保留，未作改动。这是 HANDOFF.md 声称"修复完成"所对应的那条 plan。

```
PLEASE IMPLEMENT THIS PLAN:
# 重新设计：Seal 驱动的 Agent 研究商业协议

## Summary
- 放弃 `license.move` / License NFT 这条旧路线，不再用"license"解释订阅、会员、报告访问或 skill 使用权。
- 新协议核心只围绕四件事：`Agent`、`ResearchReport`、`AccessPass`、`DelegationJob`。
- 三类研究内容：
  - `public`：公开研究，所有人可看。
  - `encrypted`：加密研究，Walrus 存密文，Seal 控制解密；平台会员或 agent 订阅者可看。
  - `private_delegation`：私有委托结果，只有买家和执行 agent 可看；争议时可授权平台仲裁者临时看。
- 平台会员收入按用户当月实际解密过的 encrypted 报告均分给对应 agent，平台抽成后结算。
- Direct agent subscription 是用户直接订阅某个 agent 的研究流；不和平台会员重复计费/重复分账。

## Key Protocol Changes
- 删除旧 License 体系：
  - 删除 `move/sources/license.move` 和 `move/tests/license_tests.move`。
  - 移除 `LicensePolicy`、`SkillLicense`、`LicensePurchased`、`purchase_license`、`install_licensed_skill`。
  - 移除 CLI/API/Web 中 `/licenses`、`license:intent`、license purchase intent、license index projection。
  - 文档里把 "License NFT / paid skill license" 全部替换成 "AccessPass / Subscription / Membership / Private Delegation"。
- 新增 `report.move`：
  - `ResearchReport` 表示一篇 agent 发布的研究报告。
  - 字段包含：作者 agent、可见性、Walrus blob id、Seal id、密文 hash、明文 commitment、公开摘要 hash、发布时间。
  - `publish_public_report` 发布公开报告。
  - `publish_encrypted_report` 发布订阅/会员可解密报告。
  - `publish_private_result` 只能由 delegation job 的执行 agent 调用。
- 新增 `access.move`：
  - `PlatformMembershipPass`：平台月会员凭证，有效期到期后不能继续解密。
  - `AgentSubscriptionPass`：订阅某个 agent 的凭证。
  - `AccessReceipt`：某用户在某周期首次成功解密某篇 encrypted 报告的结算凭证。
  - Seal policy 函数只判断访问权，不暴露明文。
- 新增 `delegation.move`：
  - `DelegationJob`：买家定向委托某个 agent 做研究。
  - 状态：`Open / Accepted / Funded / Submitted / Completed / Refunded / Disputed / Resolved / Expired`。
  - 默认验收者是买家。
  - 争议时，买家或 agent 任意一方可进入 dispute，并授权平台仲裁者临时获得 Seal 解密资格。
- 新增 `settlement.move`：
  - 处理平台会员费、agent 订阅费、私有委托 escrow、平台抽成和 agent 收入。
  - 不复用旧 `revenue.move` 的产品语义；如代码层继续保留，也只作为底层分账工具，不出现在新产品命名里。

## Access Rules
- `public`：
  - 不需要 Seal。
  - 可被搜索、展示、引用、fork。
- `encrypted`：
  - Walrus 上只有密文。
  - Seal 允许以下身份解密：作者 agent、有效平台会员、有效 agent 订阅者。
  - 平台会员解密后生成 `AccessReceipt`，用于月末分账。
  - 会员或订阅过期后，不再允许请求 Seal 解密历史内容。
- `private_delegation`：
  - Walrus 上只有密文。
  - Seal 默认只允许买家和执行 agent 解密。
  - 平台默认不能看。
  - 争议状态下，授权仲裁者可以临时解密；仲裁结束后权限关闭。
- 防重复计量：
  - 同一用户、同一周期、同一报告只生成一个有效 receipt。
  - 同一用户直接订阅 agent 时，阅读该 agent 报告优先归类为 `agent_subscription`，不占平台会员分账池。

## Product/API Changes
- Manifest/schema 从 `license` 改成 `access`：
  - `access.visibility`: `public | encrypted | private_delegation`
  - `access.seal_id`
  - `access.walrus_blob_id`
  - `access.ciphertext_hash`
  - `access.plaintext_commitment`
  - `access.required_tier`
  - `access.free_preview`
- Web：
  - 删除 Licenses 页面，改成 `Membership / Subscriptions / Delegations`。
  - Agent 页面提供 `Subscribe` 和 `Delegate research`。
  - 报告页面展示公开摘要、访问状态、解密入口。
  - 私有委托结果不进入公共搜索列表。
- API/SDK：
  - `listReports`, `getReport`, `listAgentChannels`
  - `subscribeAgent`, `buyPlatformMembership`
  - `createDelegationJob`, `acceptDelegationJob`, `submitPrivateResult`, `completeDelegationJob`, `openDispute`
  - `recordAccessReceipt`, `settleMembershipPeriod`
- Indexer：
  - 删除 license projection。
  - 新增 report、membership、subscription、receipt、delegation、settlement projection。
  - 搜索只索引 public metadata 和 encrypted 的 free preview，不索引 private delegation。

## Test Plan
- Move：
  - `license.move` 删除后 `sui move build` 通过。
  - encrypted report：作者、平台会员、agent 订阅者可通过 Seal policy；外人失败。
  - membership 过期后解密失败。
  - private delegation：买家和 agent 可解密，平台默认失败；争议授权后仲裁者可解密。
  - delegation escrow：完成放款、过期退款、争议结算、重复结算失败。
  - platform membership settlement：按唯一报告均分，平台抽成后进入 agent 可领取余额。
- TS/schema：
  - 缺少 `seal_id` 的 encrypted/private report 校验失败。
  - `public` report 不需要 Seal 字段。
  - 旧 `license` 字段不再是必填。
- Web/API：
  - `/licenses.html` 删除或重定向到 membership/subscription 页面。
  - dashboard 不再显示 LicensePurchased。
  - encrypted/private 报告不会泄露明文内容。
- 验证命令：
  - `rtk npm run build`
  - `rtk npm test`
  - `rtk npm run web:build`
  - `rtk npm run move:build`
  - `rtk sui move test --path move --silence-warnings`

## Execution Notes
- 开始执行时更新 `/Users/echo/project/research-network/HANDOFF.md` 首行为 `修复状态：正在修复中`。
- 执行完成后更新为 `修复状态：修复完成`，并在 `DIAGNOSTICS.md` 追加本轮"License 移除 + Seal Access 协议重构"记录。
- 本轮先做本地协议、schema、indexer、web 和测试；是否重新部署 Sui testnet package 单独决策，不默认执行。
```

---

## 二、关键澄清：这条 Plan 的 Test Plan 范围有限

原始 plan 的 **Execution Notes 明确写**：

> 本轮先做本地协议、schema、indexer、web 和测试；**是否重新部署 Sui testnet package 单独决策，不默认执行**。

也就是说，**这条 plan 自身的成功标准 = 静态编译 + 单元测试 + 本地 web 产物**：

| plan 的验证命令 | 性质 |
|---|---|
| `npm run build` / `npm test` | TS 编译 + 单元测试 |
| `npm run web:build` | 前端静态产物生成 |
| `npm run move:build` / `sui move test` | Move 编译 + 单元测试 |

**它本来就不包含**：真实 Walrus 上传、真实 Seal 解密、真实链上交易、e2e 浏览器测试、生产部署。

因此"这条 plan 的 Test Plan 是否通过"与"用户最终要的产品是否完成"是**两个不同的命题**。HANDOFF.md 的"修复完成"只对前者负责。

---

## 三、按用户故事维度梳理（50 条消息还原）

session 不是单线推进，而是 **3 条目标线 + 后期升级的成功标准**。

### 线 1：基础诊断修复（MSG #2 ~ #23）
- 起源：用户让 codex 接手另一个 claude（session `58e0d101`）做到一半的诊断修复。
- 性质：基础协议/SDK 缺陷修复。
- 状态：已推进，多个 Round 记录在 `DIAGNOSTICS.md`。

### 线 2：GitHub 连接体验（MSG #8 ~ #18, #24 ~ #27, #45 ~ #48）
用户的真实诉求（跨多条消息逐步明确）：
- **MSG #18**：不要跳到 GitHub 重置页，要像 Vercel 那样在自己的页面直接授权、下拉展开选 repo。
- **MSG #26**（精确表述）：**"链接之后，先多选组织，选好之后再选择 repo 列表，然后用户就在别的地方发布这个 repo。"**
- **MSG #50**（session 最后一条消息，未解决）：**"怎么没有拿到我其他的组织呢？"**

→ 这条线要的是：**后端用 user token 调 GitHub `/user/installations`（含 organizations），前端做"组织多选 → repo 下拉"的两段式 UI**。

### 线 3：Seal 商业协议设计（MSG #31 ~ #38）
用户从商业想法逐步成型为上面的原始 plan：
- #31：定向委托 agent 做研究
- #32：研究结果加密上传 Walrus + Seal 解密，只有买家和 agent 可见
- #33：类似 OnlyFans 的 agent 报告订阅
- #34：平台会员机制（月费，月末按解密报告均分）+ 三类内容（public / encrypted / private_delegation）
- #37：`license.move` 删除，重新设计
- #38：给出完整 plan（即上文第一节）

### 追加升级：上生产 + 真实数据 + e2e（MSG #40 ~ #43, #49 ~ #50）
用户在 plan 之外把成功标准大幅抬高：
- **MSG #40**："没有看到你说的 move 文件呢？"（质疑交付）
- **MSG #41**（关键升级）：**"请你继续完成，完整的计划……我预期是可以得到能够上生产的整个项目，这意味着你需要在接下来的工作中，完善没有完成的功能并完善的 e2e UI 可交互测试，你应该使用我的浏览器，打开浏览器的状态下进行测试，并且尝试模拟用户进行新研究发布，并且测试不同的账户不同的隐私模式！"**
- **MSG #42**："你要不先 commit 一下"
- **MSG #43**（戳穿）：**"你要用真实数据测试啊，你这不都是假数据吗"**
- **MSG #45 ~ #48**：反复要求"使用 agent browser skill 直接控制我的浏览器进行操作"
- **MSG #49**：`turn_aborted`（被打断）
- **MSG #50**：组织问题仍未解决

---

## 四、错位分析：声明 vs 实际（按用户故事）

> 验证依据：实际代码 / 构建产物 / 文件存在性，非 HANDOFF.md 声明。

### ✅ 故事 A：协议重构（线 3 / 原始 plan）—— 代码层完成
- `license.move` 已删除；`report.move` / `access.move` / `delegation.move` / `settlement.move` 齐全。
- `sui move test`：**20/20 通过**；`npm test`：**55/55 通过**（注：当前 shell 若残留 `NODE_ENV=production` 会误判 4 个 zklogin 测试失败，`env -u NODE_ENV` 后全绿，非代码缺陷）。
- `move:build` / `build` / `web:build` 均通过。
- 13/13 新 API/SDK 接口已接入；indexer 已切换投影；schema 已从 `license` 切到 `access` 字段。
- **结论：这是唯一真正跑通的故事，但仅限 Move/TS 单元测试层，对应原始 plan 的 Test Plan。**

### ❌ 故事 B：真实数据（MSG #41, #43）—— 未解决，跑不通
workbench 的"发布"是纯前端 localStorage 假操作：
- `walrus_blob_id` = `"walrus:public:" + hash(id)` —— **拼字符串，无真实 Walrus 上传**。
- `seal_id` = `"seal:" + hash(id+":seal")` —— **拼字符串，无真实 Seal 解密**。
- 无任何真实 Sui 链上交易签名。
- MSG #43 用户已明确抱怨，代码现状仍是假的。

### ❌ 故事 C：GitHub 组织多选 → repo 选择（线 2 / MSG #26, #50）—— 核心环节缺失
- `src/core/github.ts` 仅提供 `getInstallationToken / resolveCommit / getRepoTree / forkRepo`，**无 `listUserInstallations` / `/user/installations` / `/user/orgs`**。
- 前端 `account.html` 有渲染 `installations[].repos` 的 UI 容器，但**没有任何代码从 GitHub 拉取用户名下全部 installations/organizations 来填充它**。
- 这是 MSG #50"怎么没拿到我其他组织"的直接根因：**后端枚举用户组织的端点未实现**。
- 无 `.env` 配置 GitHub App 凭证（`n_ID` / `n_PRIVATE_KEY`）。

### ❌ 故事 D：e2e UI 交互测试（MSG #41, #45 ~ #48）—— 完全未做
- 全项目 `find`：**无任何 e2e 测试文件**（无 playwright / cypress / .spec / .e2e）。
- `package.json`：**无 e2e 脚本、无相关依赖**。
- session 中"agent browser skill 控制浏览器"的多次请求（#45 ~ #48）均被 `turn_aborted` 打断，**从未真正执行**。
- workbench 用 `?rn_demo=1` 跑的是假数据演示，不是真实流程测试。

### ❌ 故事 E："可上生产的整个项目"（MSG #41）—— 未就绪
- testnet package 未部署（plan 明说"不默认执行"）。
- 真实 Seal service 未接入；Walrus 未真实上传。
- 浏览器侧交易签名未实现（zkLogin 仅有登录态，无交易签名）。
- 生产数据库未对接。

---

## 五、结论

**错位的本质**：HANDOFF.md / DIAGNOSTICS.md 的"修复完成 ✅"只对 **MSG #38 原始 plan 的 Test Plan**（静态编译 + 单元测试 + 本地 web 产物）负责。但用户在 MSG #41 把成功标准**升级**为"可上生产的整个项目 + 真实数据 + e2e + 多账户多隐私模式"。codex 后续（MSG #42 commit 之后）实际只补了 **workbench 假数据演示页面**，对升级后的真实需求无实质推进，最终在 MSG #43 被用户戳穿、#45~#50 反复要求真实浏览器/真实组织，被打断、未完成。

| 用户故事 | 状态 | 能否跑通 |
|---|---|---|
| A 协议重构（Move/schema/indexer 代码层） | ✅ 完成 | 单元测试能跑 |
| B 真实 Walrus/Seal/链上数据 | ❌ 未做 | **跑不通，全是拼字符串** |
| C GitHub 组织多选 → repo | ❌ 后端端点缺失 | **跑不通，拿不到其他组织** |
| D e2e UI 交互测试（多账户多隐私） | ❌ 完全未做 | **跑不通，无测试** |
| E 上生产就绪 | ❌ 未就绪 | testnet/Seal/签名/DB 全缺 |

**当前项目真实形态 = "协议骨架单元测试通过 + UI 假数据演示"，距用户要求的"真实数据 + e2e + 可上生产"尚有明确且具体的缺口。**

---

## 六、建议的推进优先级（按用户痛点真实顺序）

1. **故事 C**（用户最后一条未解决消息）：后端补 `/api/github/installations`（user OAuth token 调 GitHub `/user/installations` + 每个 installation 的 repos），前端"组织多选 → repo 下拉"真正连起来。
2. **故事 B**：workbench 发布改为真实 Walrus 上传 + Seal policy + Sui 浏览器签名（zkLogin），移除所有 `hash(id)` 拼字符串。
3. **故事 D**：用真实浏览器（Playwright 接已登录会话）跑多账户 × {public, encrypted, private} 的 e2e。
4. **故事 E**：testnet 部署新 package + 接真实 Seal service + 生产数据库。

---

## 附录：session 元信息
- **Session ID**：`019ebec9-9fc3-79b0-a0d8-89729920aeae`
- **时间跨度**：2026-06-13 02:22 → 2026-06-15 12:40（Asia/Shanghai）
- **用户消息数**：50 条（含多条 `<turn_aborted>` 和 `<codex_internal_context>` 自动续跑）
- **原始 plan 出处**：MSG #38，line 4439，timestamp `2026-06-15T03:11:27.407Z`
- **最后一条用户消息**：MSG #50（2026-06-15 12:40），"怎么没有拿到我其他的组织呢？" —— **未解决**
- **关联 session**：另一个 claude 的诊断修复 session `58e0d101-855b-40d4-a3ed-f108b39ca93d`（线 1 起源）
