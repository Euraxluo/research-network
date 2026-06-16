# 修复 Plan：功能缺口 + 前端生产化重构

> 配合 `19-session-019ebec9-review-and-misalignment.md` 阅读。
> 19 号文档回答了"用户要什么 / 缺什么"；本文档回答"**怎么补 / 按什么顺序 / 验收标准是什么**"。
>
> 本 plan 分两条主线，可并行，但有依赖关系：
> - **主线 I（功能）**：补齐故事 B/C/D/E 的真实业务能力。
> - **主线 II（前端架构）**：把"TS 内联字符串拼 HTML"重构成真正的生产级前端。
>
> 主线 II 是主线 I 的地基——如果继续在 `WORKBENCH_JS = \`...\`` 这种巨型字符串里写真实 Walrus/Seal/签名逻辑，会不可维护。**建议主线 II 先行或并行启动。**

---

## 零、现状诊断（为什么"不像生产代码"）

### 前端架构的根因

| 维度 | 现状 | 问题 |
|---|---|---|
| 前端源码目录 | ❌ 无 `web/src/` | 前端没有独立源码，全部寄生在后端 TS 里 |
| 页面生成方式 | `src/core/web.ts` (1733行) / `web-auth.ts` (1028行) / `web-workbench.ts` (751行) 里用**模板字符串拼 HTML+内联 JS**，`fs.writeFile` 落盘成静态 `.html` | 共 **3606 行 TS，相当比例是 HTML/JS 字符串** |
| 业务 JS | `WORKBENCH_JS = \`...\`` 单个常量 **706 行**；`LOGIN_JS`/`CALLBACK_JS`/`GITHUB_CALLBACK_JS` 同理 | 一个文件一坨，无模块化、无组件、无类型 |
| 框架/构建 | `dependencies`: `@mysten/sui, ajv, express, yaml`；`devDependencies`: `esbuild, vitest, tsx, ts, jsdom`。**零前端框架，零前端构建工具**（esbuild 只用于编译后端 TS） | 无组件复用、无 HMR、无 tree-shake、无 CSS 方案、无类型检查覆盖前端 JS |
| 状态/路由 | ❌ 无 router、无 state management | 全靠 `localStorage` + 页面跳转 |
| 数据真实性 | workbench 用 `hash(id)` 拼 `walrus_blob_id` / `seal_id` | 假数据（故事 B） |

**结论**：当前前端是"**后端 SSR 一次拼成静态 HTML + 内联 vanilla JS**"的形态，适合做早期 demo/原型，但无法承载真实链上交易、Seal 解密、多账户状态的复杂交互。这正是它"看起来不像生产代码"的原因。

---

## 一、修复 Plan 总览

```
主线 II（前端地基）          主线 I（功能）
┌─────────────────────┐    ┌──────────────────────────┐
│ II-1 前端工程脚手架  │───▶│ I-C GitHub 组织枚举 (最先,用户最后抱怨) │
│ II-2 页面迁移        │    │ I-B 真实 Walrus/Seal/签名             │
│ II-3 组件化+状态层   │    │ I-D e2e 测试                          │
│ II-4 移除字符串生成  │    │ I-E 上生产部署                        │
└─────────────────────┘    └──────────────────────────┘
```

**依赖关系**：
- `I-C`（GitHub 组织枚举）**不依赖前端重构**，可立即开始（纯后端 + 现有前端接入）。
- `I-B`（真实 Walrus/Seal/签名）**强烈建议在 II-1/II-2 之后做**，否则又在巨型字符串里堆复杂逻辑。
- `I-D`（e2e）依赖 `I-B`/`I-C` 完成才有意义。
- `I-E`（上生产）是 `I-B`+`I-C`+`I-D` 全绿后的收口。

**建议执行顺序**：`I-C → II-1 → II-2 → I-B → II-3 → I-D → II-4 → I-E`

---

## 二、主线 I：功能补齐（故事 B/C/D/E）

### I-C：GitHub 组织多选 → repo 选择（最先做）

> **为什么最先**：这是用户 session 最后一条未解决消息（MSG #50："怎么没拿到我其他组织"），且纯后端，不依赖前端重构。

#### 缺口
- `src/core/github.ts` 只有 `getInstallationToken/resolveCommit/getRepoTree/forkRepo`，**缺 `listUserInstallations`**。
- 前端 `account.html` 有 `installations[].repos` 的 UI 容器，但无人填充。
- 无 GitHub App 凭证配置（`n_ID` / `n_PRIVATE_KEY`）。

#### 任务
1. **后端 `src/core/github.ts`**：
   - 新增 `listUserInstallations(userAccessToken)`：调 GitHub `GET /user/installations`，返回 `[{id, account:{login, type}, ...}]`。
   - 新增 `listInstallationRepos(client, installationId)`：调 `GET /installation/repositories`（用 installation token），返回该 installation 下 repos。
   - 新增 `listUserOrgs(userAccessToken)`：调 `GET /user/orgs?per_page=100`（分页），作为"组织多选"数据源。
2. **API `src/api/server.ts`**：
   - `GET /api/github/installations`：用当前登录用户的 user OAuth token（zkLogin 绑定的 GitHub identity）→ 返回 installations + 每个 installation 的 repos。
   - `GET /api/github/orgs`：返回用户 organizations（用于"先多选组织"）。
   - 复用现有 `githubAppFromEnv` + user token 两条路径。
3. **前端**：在 `account.html`（暂留旧架构，II 阶段再迁移）接 `/api/github/installations`，实现两段式 UI：组织多选 → 选中的组织下 repo 列表。
4. **凭证**：`.env` / Vercel 配 `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` + 确认 OAuth App client secret 已配（HANDOFF 提到 `GITHUB_APP_CLIENT_SECRET` 已加 Vercel）。

#### 验收
- [ ] 已登录用户在 `/account.html` 能看到自己**全部** GitHub organizations（含个人 account 和所有 org installation），不再是只显示一个。
- [ ] 多选组织后，repo 列表正确刷新。
- [ ] 单元测试：mock GitHub API 响应，覆盖多组织 + 分页 + 空 installation 场景。
- [ ] 用真实 GitHub 账号（用户浏览器）走通一遍。

---

### I-B：真实 Walrus / Seal / 链上签名

> **依赖**：建议 II-1（前端工程化）先落地，否则在 706 行字符串里写加密+签名+错误处理会失控。

#### 缺口
- `web-workbench.ts:447` `walrus_blob_id = "walrus:public:" + hash(id)` —— 拼字符串。
- `web-workbench.ts:448` `seal_id = "seal:" + hash(id+":seal")` —— 拼字符串。
- 无真实 Walrus 上传、无真实 Seal policy 调用、无 Sui 浏览器签名（zkLogin 仅有登录态，无交易签名）。

#### 任务
1. **Walrus 真实上传**：
   - 封装 `src/core/walrus-client.ts`：`uploadBlob(content: Uint8Array): Promise<{blobId, endEpoch}>`，调 Walrus aggregator（testnet `https://aggregator.walrus-testnet.walrus.space` 或自建）。
   - `downloadBlob(blobId)`：真实下载。
   - public 报告上传明文；encrypted/private 报告上传**客户端加密后的密文**。
2. **Seal 真实解密**：
   - `src/core/seal-client.ts`：集成 `@mysten/seal`（或 Seal SDK），对接 Move `access.move` 的 policy 函数。
   - 浏览器侧：用户点"解密"→ 取 AccessPass/MembershipPass → 调 Seal → 拿到明文 key → 解密 Walrus 密文。
   - 解密成功后**真实** `recordAccessReceipt`（链上 tx）。
3. **客户端加密**：
   - encrypted/private 报告在浏览器用对称密钥加密（如 AES-GCM），密钥交给 Seal 托管，明文 commitment 上链。
4. **Sui 浏览器签名**：
   - 接 `@mysten/sui` 的 `Transaction` + zkLogin signer（已有 zkLogin 登录态，需扩展到交易签名）。
   - 覆盖：`publish_public_report` / `publish_encrypted_report` / `buyPlatformMembership` / `subscribeAgent` / `createDelegationJob` / `recordAccessReceipt` 等。
5. **删除所有 `hash(id)` 拼字符串逻辑**。

#### 验收
- [ ] 发布一篇 encrypted 报告：真实上传 Walrus（拿到真实 blobId）→ 真实上链 → 在另一个会员账号能真实 Seal 解密看到明文。
- [ ] private delegation 结果：买家和 agent 可解密，第三方（含平台）失败。
- [ ] 会员过期后 Seal 解密被拒。
- [ ] `recordAccessReceipt` 真实上链，indexer 能索引到。
- [ ] 代码里 `grep "walrus:public:" / "seal:" + hash` 返回空。

---

### I-D：e2e UI 交互测试（多账户 × 多隐私模式）

> **依赖**：I-B + I-C 完成。

#### 缺口
- 全项目无 playwright/cypress/.spec/.e2e 文件，无 e2e 脚本/依赖。
- session 里"agent browser skill 控制浏览器"的请求全被 `turn_aborted` 打断。

#### 任务
1. **引入 Playwright**：`pnpm/npm i -D @playwright/test`，`playwright.config.ts`，`package.json` 加 `"e2e": "playwright test"`。
2. **测试矩阵**（对应用户 MSG #41"不同账户不同隐私模式"）：

   | 账户角色 | 操作 | 预期 |
   |---|---|---|
   | Agent A | 发布 public 报告 | 所有人可见，无需 Seal |
   | Agent A | 发布 encrypted 报告 | Walrus 只有密文，外人看摘要 |
   | 用户 U（有会员） | 解密 Agent A 的 encrypted | Seal 成功，生成 receipt |
   | 用户 U（会员过期） | 解密 | Seal 拒绝 |
   | 用户 U（订阅 Agent A） | 解密 | 归类 agent_subscription，不占会员池 |
   | 买家 B | createDelegationJob → Agent A 执行 → submitPrivateResult | 买家+agent 可解密，平台失败 |
   | 买家 B | openDispute → 仲裁者临时解密 | 仲裁者可解密，结束后关闭 |
   | 结算 | settleMembershipPeriod | 按唯一报告均分，平台抽成 |
3. **接用户浏览器**（MSG #45~48 要求）：Playwright `connect over CDP` 到用户已登录的 Chrome（`--remote-debugging-port`），复用 zkLogin + GitHub 登录态。

#### 验收
- [ ] `npm run e2e` 全绿，覆盖上表全部矩阵。
- [ ] 用真实浏览器（复用用户登录态）跑通至少一轮发布→订阅→解密→结算。
- [ ] e2e 产物（录像/traces）可回放。

---

### I-E：上生产部署

> **依赖**：I-B + I-C + I-D 全绿。

#### 任务
1. **testnet 部署新 Move package**：`sui client publish --network testnet`，记录 packageId 写入配置。
2. **真实 Seal service**：部署/对接 Seal testnet service，policy 函数指向新 packageId。
3. **生产数据库**：indexer/receipt/store 从本地 JSON 换成真实存储（Postgres/Vercel KV/Supabase）。
4. **Vercel 部署**：前端（II 阶段产物）+ API server 部署，env 配齐（GitHub App、Walrus endpoint、Seal endpoint、packageId、rpc）。
5. **生产验收清单**（参考 PRODUCT.md）：登录→连 GitHub→发报告→解密→结算 全链路在 `research-network-web.vercel.app` 跑通。

#### 验收
- [ ] testnet 上能查到 published report / membership / delegation 事件。
- [ ] 生产 URL 全链路 e2e 绿。
- [ ] HANDOFF.md"未完成项"清空。

---

## 三、主线 II：前端生产化重构（地基）

### II-1：前端工程脚手架

#### 任务
1. **新建 `web/` 前端工程**（独立于后端 TS）：
   ```
   web/
     src/
       main.tsx
       App.tsx
       routes/
       components/
       lib/        (walrus-client, seal-client, sui-signer)
       state/      (zustand/jotai store)
     index.html
     vite.config.ts
     tsconfig.json
   ```
2. **技术选型**（建议，需确认）：
   - 框架：**React 18 + TypeScript**（理由：`@mysten/sui`、`@mysten/seal` 官方生态对 React 支持最好，dApp Kit 现成）。
   - 构建：**Vite**（dev HMR + 生产 build）。
   - UI：**@mysten/dapp-kit** + Tailwind（或现有 styles.css 迁移）。
   - 路由：React Router。
   - 状态：Zustand（轻量，够用）。
3. **`package.json`** 拆分：`web/` 独立 package 或 monorepo workspace，前端依赖（react/vite/dapp-kit）与后端依赖（express/ajv/yaml）分离。
4. **dev 脚本**：`web:dev` → Vite dev server + API server proxy。

#### 验收
- [ ] `cd web && npm run dev` 启动 Vite，HMR 可用。
- [ ] 一个 hello-world 页面跑通 React + dapp-kit。
- [ ] 前端有独立 tsconfig，`tsc --noEmit` 通过。

---

### II-2：页面迁移（逐页搬，保持功能等价）

#### 任务
按页面把字符串拼出来的逻辑迁移成 React 组件，**一次一页，每页迁移完做等价回归**：

| 页面 | 来源（旧字符串） | 迁移目标 | 优先级 |
|---|---|---|---|
| `login.html` | `web-auth.ts` `LOGIN_JS` + `loginHtml()` | `routes/login.tsx` | 高 |
| `account.html` | `web-auth.ts` `renderAccountPage` | `routes/account.tsx` | 高（含 I-C 的组织选择） |
| `workbench.html` + `workbench.js` | `web-workbench.ts` `WORKBENCH_JS`(706行) | `routes/workbench.tsx` + 组件拆分 | 高（含 I-B 真实发布） |
| `dashboard.html` | `web.ts` | `routes/dashboard.tsx` | 中 |
| `index/search/membership/delegations.html` | `web.ts` | 对应 routes | 中 |
| 报告详情/abs/paper/graph | `web.ts` | `routes/report.tsx` 等 | 中 |

#### 验收
- [ ] 每页迁移后，与旧版本做**视觉+交互等价**对比（截图/diff）。
- [ ] 旧 `src/core/web*.ts` 里的 HTML 字符串逐个减少（用 grep 监控）。

---

### II-3：组件化 + 状态层

#### 任务
1. 抽公共组件：`<ReportCard>`、`<AccessBadge visibility>`、`<SubscribeButton>`、`<DelegateButton>`、`<DecryptButton>`、`<OrgRepoSelector>`。
2. 状态层：Zustand store 管 `{ identity, membership, subscriptions, delegations, reports }`，替代散落的 `localStorage`。
3. `lib/` 封装 I-B 的真实 client（walrus/seal/signer），组件直接调。

#### 验收
- [ ] 无直接 `localStorage` 散调用（统一走 store 持久化）。
- [ ] 发布/解密/订阅三件套各有独立可复用组件。

---

### II-4：移除后端字符串生成

#### 任务
- II-2/II-3 完成后，删除 `src/core/web.ts` / `web-auth.ts` / `web-workbench.ts` 里的 HTML/JS 字符串生成逻辑（保留 API server 部分）。
- `web:build` 改为 `cd web && vite build`，产物输出到 `web/dist/`。
- 后端只负责 API + 静态文件托管。

#### 验收
- [ ] `src/core/web*.ts` 删除或瘦身后总行数从 3606 → < 500（纯 API/类型）。
- [ ] `grep -r "WORKBENCH_JS\|LOGIN_JS\|CALLBACK_JS" src/` 返回空。
- [ ] 前端产物全部由 Vite 生成。

---

## 四、里程碑与优先级

| 里程碑 | 内容 | 解锁 | 预估体量 |
|---|---|---|---|
| **M1** | I-C（GitHub 组织枚举） | 用户最后抱怨的问题 | 小（1-2 天，纯后端） |
| **M2** | II-1（前端脚手架）+ II-2 登录/账户页迁移 | 前端可维护地基 | 中（2-3 天） |
| **M3** | I-B（真实 Walrus/Seal/签名）+ workbench 迁移 | 真实数据（故事 B） | 大（3-5 天） |
| **M4** | I-D（e2e 多账户多隐私） | 用户 MSG #41 验收 | 中（2 天） |
| **M5** | II-3/II-4 + I-E（上生产） | 可上生产（故事 E） | 中（2-3 天） |

**最小可交付路径**（若时间紧）：M1 → M2 → M3 → M4，先把"真实数据 + e2e"做出来，生产部署 M5 可后置。

---

## 五、风险与决策点

1. **前端框架选型**：本 plan 默认 React + Vite + dapp-kit。若你倾向 Vue/Svelte 需提前定，因为 `@mysten/dapp-kit` 是 React 专属，换框架要自己封装 Sui 连接层。**→ 需你确认。**
2. **是否拆 monorepo**：前端独立 package 还是放在同一个 package.json？建议 monorepo（pnpm workspace），后端 API 和前端清晰分离。**→ 需你确认。**
3. **Seal service 自建 vs 用官方 testnet**：自建可控但要运维；官方 testnet 快但有依赖。**→ 需你确认。**
4. **生产存储**：Vercel KV / Supabase / 自建 Postgres？影响 indexer 和 receipt store。**→ 需你确认。**
5. **现有假数据 workbench 是否保留**：迁移期间可作为 demo 模式保留（`?rn_demo=1`），但生产路径必须走真实 client。

---

## 六、与现有文档的关系

- 本文档 = **怎么做**（执行 plan）
- `19-session-019ebec9-review-and-misalignment.md` = **为什么 / 缺什么**（审查报告）
- `HANDOFF.md` = **当前状态**（顶部 ⚠️ 指针已纠偏）
- `DIAGNOSTICS.md` = **历史逐轮记录**（Round 1~6）
- `PRODUCT.md` = **产品视角**（登录场景、用户能做什么）
- `docs/18-research-commerce-access.md` = **协议 canonical**（Seal Access 设计）

每完成一个里程碑，更新 `HANDOFF.md` 的状态行 + `DIAGNOSTICS.md` 追加 Round 记录。
