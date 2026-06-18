# UI 功能审计

## 1. 审计边界

UI 审计面向用户可感知的产品闭环：

- 游客是否能无需登录浏览和搜索。
- 用户何时登录，登录后看到什么。
- GitHub repo scope 是否符合“先组织多选，再 repo 下拉”的产品要求。
- 发布、访问、订阅、委托、结算是否能在页面上解释清楚。
- demo/local/testnet/mainnet 状态是否不会误导用户。

## 2. 当前 UI 形态

当前项目同时存在两类前端：

| 前端形态 | 位置 | 作用 | 审计结论 |
| --- | --- | --- | --- |
| React/Vite app | `web/src/` | 登录壳、账户页、Workbench 等生产化页面 | 是后续主线。真实 Walrus/Seal/Sui 路径在此接入。 |
| legacy 静态生成 | `src/core/web.ts`、`web-auth.ts`、`web-workbench.ts` | Walrus Site 静态内容和兼容页面 | 仍需保留但不应继续承载复杂交易逻辑。 |
| Vercel shell + Walrus proxy | `.vercel-shell`、`api/walrus.ts` | 公网入口、auth/account 静态服务、内容页代理 Walrus | 可用，但要继续防止 testnet 配置误入 mainnet。 |

## 3. 页面和用户旅程审计

### 3.1 游客浏览和搜索

产品要求：

- 阅读永远不需要登录。
- 游客可搜索、看 abstract/PDF/README、看引用图谱、看链上和 Walrus provenance。

当前状态：

- 静态站点和 Walrus proxy 支持公开内容页。
- Search/API 本地能力存在。
- React workbench 更偏操作台，不是完整 arXiv 式首页。

缺口：

- 生产公网动态搜索仍依赖生产 Indexer/API。
- 资产页需要更强的“真实数据 provenance”：Sui object、tx digest、Walrus blob、manifest hash、Git commit、Indexer freshness。
- public/encrypted/private 的内容边界需要在 UI 上清楚展示，尤其 encrypted 只展示 free preview。

验收标准：

- 未登录游客打开首页可以搜索并进入 public asset。
- encrypted report 仅显示 preview 和解锁入口。
- private delegation result 不在公开搜索和公开列表出现。

### 3.2 zkLogin 登录

产品要求：

- L0 游客可读。
- L1 zkLogin 确定 Sui 地址，展示“我的”只读数据。
- L2 zkLogin 可签会话支持真实交易。

当前状态：

- Google zkLogin 地址派生、deterministic salt service、session attestation、CLI login 和 Web signer 已实现。
- `/debug.html` 独立承载 buyer/agent production acceptance session 导出，正常 `AccountPage` 不暴露验收工具。
- `web/src/lib/signer.ts` 从同 tab sessionStorage 重建 ephemeral keypair，调用 prover 并组装 composite zkLogin signature。

缺口/风险：

- 真交易依赖当前 tab 中 `rn_zk_eph` 和 `rn_zk_session`，跨 tab、过期或刷新后可能只有 L1 地址而没有 L2 signer。
- 缺失 signer 时 Workbench 会 fallback 到 demo path。生产 UI 必须显式提示“当前不是链上签名路径”。
- `ZKLOGIN_PROVER_URL` 和 prover response shape 必须由 preflight 证明。

验收标准：

- 登录后 account 显示 zkLogin address、email/provider、session 状态。
- L1 only 时 claim/publish/purchase 按钮要提示升级到可签会话，不应悄悄生成 demo id。
- L2 signer 可构造并执行至少一笔 testnet tx。

### 3.3 GitHub 连接和组织 scope

产品要求：

- 必须先 zkLogin，再连接 GitHub。
- GitHub App OAuth 回跳后，绑定挂在 Sui 地址下。
- 用户先多选 account/org scope，再从 repo 下拉选择发布仓库。

当前状态：

- `api/github-oauth.ts` 使用 GitHub OAuth code 换 user token，收集 installations/repos/org scopes。
- `src/api/server.ts` 提供 `/api/github/installations` 和 `/api/github/orgs` 调试端点。
- `web/src/lib/github-scope.ts` 和 Account/Workbench 读取 `organization_scopes`，未授权组织禁用 checkbox。
- UI 已提示组织 repo 需要在 GitHub App install/approval 流程中授权。

缺口/风险：

- GitHub 组织是否出现取决于组织是否安装/批准 Research Network App，以及 GitHub SAML/sudo/passkey 状态。产品不能承诺自动列出用户所有组织私有 repo。
- 浏览器不应长期保存 GitHub user token；当前设计用 OAuth callback 一次性取快照，这是正确方向。
- server-side account store V1 还不是生产数据库或链上 attest。

验收标准：

- 已授权个人账号显示为可选 scope。
- 已授权组织显示为可选 scope。
- 用户所属但未授权组织显示为 disabled 和 “Not authorized yet”。
- 选择某个组织后，repo 下拉只出现该组织授权 repo。

### 3.4 发布 UI

产品要求：

- GitHub repo -> validate -> package -> Walrus -> Sui -> Indexer -> Web。
- 发布者能选择 public/encrypted/private 访问策略、费用和 revenue split。

当前状态：

- CLI/API 支持 workspace publish 和 report publish。
- React Workbench 支持 report publish，若 signer 存在走真实 Walrus + Seal + Sui 路径；无 signer 走 demo fallback。
- `web/src/lib/clients.ts` 对 public 报告上传明文到 Walrus，对 encrypted 报告 Seal 加密后上传 ciphertext，再发链上 tx。

缺口：

- Web 完整 Research Asset repo 发布向导仍未完全产品化。当前 Workbench 更像 report/commerce 操作台。
- Validate/package/GitHub commit/Walrus manifest/Sui registration/Indexer wait 的九步发布流需要单独 UI。
- revenue split 编辑器、cost estimate、pending release retry、indexer wait 状态需要补。

验收标准：

- public report：真实 Walrus blob id、真实 Sui tx digest、报告 object id。
- encrypted report：真实 Seal id、ciphertext hash、plaintext commitment、Walrus readback evidence。
- 发布后 Indexer 可搜，页面显示 indexed freshness。

### 3.5 访问、会员、订阅和解密 UI

产品要求：

- encrypted 报告向游客展示 preview 和访问条件。
- 平台会员可以解密并生成 platform_member receipt。
- agent subscriber 可以解密但不占平台会员分账池。
- 会员过期后拒绝。

当前状态：

- Workbench 可模拟多 actor，并在有 signer 时调用真实链上 purchase/decrypt/receipt/settlement。
- `decryptReport` 通过 Walrus read + Seal decrypt + seal_approve PTB 工作。
- mainnet guard 会阻止没有 signer 的 mainnet commerce/delegation action。

缺口：

- 普通资产页的解锁 UI 尚需与 Workbench 的真实 client 统一。
- 访问失败的错误原因需要用户友好化：过期、tier 不足、不是订阅 agent、Seal committee denied、Walrus read fail、prover fail。
- 价格、有效期、tier 文案需要和合约配置一致。

验收标准：

- 外人看到 `needs_membership_or_subscription`，按钮 disabled 或引导购买。
- 购买会员后解密成功并显示 receipt id/tx digest。
- 订阅 agent 后解密成功，并显示 access type 为 `agent_subscription`。
- 同一报告重复 receipt 记录失败时 UI 给出去重说明。

### 3.6 私有委托 UI

产品要求：

- 买家创建委托，agent 接受和提交私有结果，买家完成或打开争议。
- 默认平台不可见。
- 仲裁者只在 dispute 中临时可见。

当前状态：

- Workbench 已覆盖 create/fund/submit/private decrypt/complete/dispute/settlement 的交互模型。
- 合约真实路径已接入 `createDelegationJobOnChain`、`publishPrivateResultOnChain`、`completeDelegationJobOnChain`、`openDisputeOnChain`。

缺口：

- 还缺专门的 delegation 页面，把 buyer、agent、deadline、budget、status、result、dispute 清楚分区。
- 真实 agent 侧工作台和买家侧工作台需要分开权限视图。
- 仲裁者身份管理和平台治理仍设计态。

验收标准：

- buyer/agent 能看到自己的 job。
- outsider 不能看到 private result 明文。
- dispute 前 arbitrator 不能解密，dispute 中能解密，resolved 后不能解密。
- complete/refund/resolve 后资金变化写入 receipt。

### 3.7 Account / Dashboard

产品要求：

- 登录后看到 Sui 地址、GitHub 绑定、我的发布、我的收益、我的访问、我的委托、我的 agents。

当前状态：

- `AccountPage` 展示 zkLogin identity、GitHub repo controls、我的发布；验收/调试工具隔离到 `/debug.html`。
- 静态/dashboard/membership/delegations 页面可展示 indexed commerce state。

缺口：

- “我的发布”当前主要按 GitHub author handle 匹配，还需要 address based projection。
- 我的收益和访问需要生产 API 根据 caller address 过滤。
- Claim UI 需要真实 signer 和 earnings object。

验收标准：

- 同一 Sui address 登录后能看到自己的 pass、subscription、receipt、delegation、earnings。
- 切换账户后数据隔离。
- sign out 清理敏感 sessionStorage，但不误删非敏感公开缓存。

## 4. UI 风险和改进建议

| 风险 | 影响 | 建议 |
| --- | --- | --- |
| Demo fallback 误导 | 用户以为合成 id 是链上数据 | UI 显示 `Demo mode` / `Unsigned local preview`，生产域 mainnet 禁止 fallback 写入。 |
| L1/L2 状态不清 | 用户登录了但不能签 tx | Account 和 Workbench 顶部显示 `L1 only` 或 `L2 signer ready`。 |
| GitHub org 权限不可控 | 用户以为站点漏取组织 | 增加 guided checklist：安装 App 到组织、管理员批准、完成 sudo、返回刷新。 |
| Search/asset 静态快照滞后 | 发布后页面不出现 | Publish 成功页显示 indexer pending，并提供 tx explorer link。 |
| Seal/Walrus 错误难懂 | 用户无法自助恢复 | 将错误归类为 access denied、network、config、session expired、hash mismatch。 |
| Mainnet 配置混用 | 真实资金风险 | 保持现有 mainnet guards，并在 UI 明示 network/package/object ids。 |

## 5. UI 验收门禁

进入 testnet 用户验收前：

1. `rtk npm run web:vite:build` 通过。
2. `rtk npm run web:build` 通过。
3. `rtk env -u NODE_ENV npm test` 通过。
4. Workbench 顶部显示当前 network、package id、signer 状态。
5. 无 signer 时所有链上动作在 mainnet 被阻止。
6. `npm run acceptance:ui` 生成 UI acceptance receipt，包含截图/trace、普通用户操作步骤和关键 UI 文案。
