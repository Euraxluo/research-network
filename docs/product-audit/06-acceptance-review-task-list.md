# 审查验收任务清单

维护日期：2026-06-18

本文件是验收目录的活任务板。所有验收路径只在这里汇总和打勾；完成一项时必须同时补上证据路径、命令输出摘要或 receipt 路径。敏感 session、JWT、ephemeral key、GitHub token、Seal 明文不得写入本文档。

用户已明确要求：**所有验收和审查路径全部重新做，不信任历史结果**。因此本文件里的所有任务默认未完成；此前 dry-run、demo、本地 mock、浏览器目测、旧 receipt、旧部署验证、旧 session 形状检查都只能作为历史线索，不能作为勾选依据。

## 使用规则

- `[x]` 只表示在本清单建立后，从当前 clean HEAD 重新执行并补充了可复查证据；`[ ]` 表示未重跑、未完成或缺少真实证据。
- `localMockOnly: true`、demo fallback、dry-run 只能勾本地/编排任务，不能勾真实 testnet/mainnet 任务。
- 真实资金或链上 execute 任务必须记录 spend cap、tx digest、object id、events、balance changes 和 clean git provenance。
- 来源列使用 `文件:行号` 指向审查/验收依据；多行用逗号列出。

## 重跑状态快照

| 状态 | 事项 | 证据 / 备注 | 来源 |
| --- | --- | --- | --- |
| [ ] | 产品审计文档包重新核对。 | 历史上 `docs/product-audit/01..05` 已存在，但需重新逐项核对与当前实现一致性。 | `docs/product-audit/README.md:21,25,26,27,28,29` |
| [x] | 合约本地源码/事件审查重新核对。 | 2026-06-18 重新核对 Move 源码和测试：`rtk npm run move:build` 通过；`rtk sui move test --path move --silence-warnings` 通过，23/23 Move tests；并从 Move 事件结构体做机械抽取。只证明本地合约基线，不证明 testnet execute。 | `docs/product-audit/01-contract-feature-audit.md:19,37,68,100,134,171,234,267,268,269`; `docs/product-audit/05-acceptance-run-report.md:226,234,235,237,239,248` |
| [x] | Indexer 本地投影/事件覆盖审查重新核对。 | 2026-06-18 重新核对 `src/core/indexer.ts` 和事件测试；`rtk npm run test -- tests/indexer-events.test.ts tests/protocol-kit.test.ts tests/production-acceptance.test.ts tests/ui-acceptance.test.ts` 通过，4 个 test file / 55 个测试；Move event -> Indexer case 机械比对确认唯一缺口是 `PlatformMembershipPaid`。 | `docs/product-audit/02-indexer-feature-audit.md:27,35,44,57,81,146,197,208`; `docs/product-audit/05-acceptance-run-report.md:226,236,238,239,243` |
| [x] | 账户页生产内容重新验收。 | 2026-06-18 重新跑 `rtk npm run test -- tests/web-account-ui.test.ts tests/web-debug-ui.test.ts tests/web-acceptance-session.test.ts tests/web-e2e.test.ts` 通过，4 个 test file / 19 个测试；生产 `https://research-network-web.vercel.app/account.html` 重新浏览器核验，无 `Production acceptance session`、`Export buyer session`、`Export agent session`、`Acceptance session`、debug/copy 文案或 `/debug.html` 链接。 | `/Users/echo/project/research-network/PRODUCT.md:36,44,45,46,49,50,52,53`; `docs/product-audit/03-ui-feature-audit.md:183,191,200,201,202,203,204`; `docs/product-audit/05-acceptance-run-report.md:178,190,204,207` |
| [x] | 工程 debug 路由隔离重新验收。 | 2026-06-18 生产 `https://research-network-web.vercel.app/debug.html` 重新浏览器核验，有 `Acceptance` tab、`Acceptance session`、buyer/agent session export/copy 按钮；正常账户页未链接该路由。 | `docs/product-audit/03-ui-feature-audit.md:61,191`; `web/README.md:55,56,59,60`; `docs/product-audit/05-acceptance-run-report.md:178,190,208` |
| [x] | Callback 敏感 payload 暴露修复重新验收。 | 2026-06-18 重新部署 `dpl_GPuEoWf4yAJ5QiPfGXzVGim1YUXQ`；线上 `/auth/callback.js` 包含 `history.replaceState`，不含 `callback-acceptance-session-payload`、`Hidden acceptance session JSON` 或 `rows="12"`；浏览器已离开带 `id_token` 的 callback URL 到 `/account.html`。 | `docs/product-audit/03-ui-feature-audit.md:50,54,60,61,206,210`; `docs/product-audit/05-acceptance-run-report.md:190,192,208,209` |
| [ ] | 两个真实 Google zkLogin session 重新收集或重新校验。 | 2026-06-18 已重新做脱敏校验：buyer 通过字段、地址绑定、epoch freshness、Google JWT 验签；agent 字段/地址/epoch 通过但 Google JWT 验签失败 `jwt_expired`，因此两个 session 未完成。 | `docs/product-audit/04-e2e-user-story-scenarios.md:22,26,27,28,34`; `docs/product-audit/05-acceptance-run-report.md:213,215,219,220,221,224` |
| [ ] | testnet preflight 尚未通过。 | 重新检查 production env 后 `ZKLOGIN_PROVER_URL` / `ZKLOGIN_SALT_SECRET` 值为空；agent JWT 已过期；仍需新 agent session、prover/salt 配置和测试 SUI。 | `docs/product-audit/01-contract-feature-audit.md:267,268,269`; `docs/product-audit/05-acceptance-run-report.md:121,162,220,222,224` |
| [ ] | testnet capped execute、真实 UI acceptance、mainnet readiness 尚未完成。 | 需要 preflight 通过后继续。 | `docs/product-audit/04-e2e-user-story-scenarios.md:17,18,540,545,546,547`; `docs/product-audit/05-acceptance-run-report.md:121,122,123,162,163` |

## P0 总门禁

| 任务 | 证据要求 | 来源 |
| --- | --- | --- |
| [x] 重新跑当前工作树全量质量门禁。 | 2026-06-18 从 clean commit `fdc153a90b80c00b640fdd567d6682ac31b50a52` 重跑：`rtk npm run build` 通过；`rtk env -u NODE_ENV npm test` 通过，22 个 test file / 187 个测试；`rtk env -u NODE_ENV npm run web:vite:build` 通过；`rtk npm run web:build` 通过；`rtk npm run move:build` 通过；`rtk sui move test --path move --silence-warnings` 通过，23/23 Move tests。 | `docs/21-agent-交接清单.md:112,117,118,119,121,122,123,124,125,128`; `docs/product-audit/05-acceptance-run-report.md:27,31,32,33,34,35,36` |
| [x] 修复用户账户页污染，只保留生产账户内容。 | 2026-06-18 重新跑 Account/Debug/Callback UI 单测通过；生产 `/account.html` 只保留账户身份、GitHub 连接和我的发布等产品内容，未暴露验收/debug/copy 按钮。 | `/Users/echo/project/research-network/PRODUCT.md:36,40,41,43,44,45,46,49,50,52,53`; `docs/product-audit/03-ui-feature-audit.md:183,185,187,191,200,201,202,203,204`; `docs/product-audit/05-acceptance-run-report.md:190,204,207` |
| [x] 把验收/调试工具隔离到独立路由。 | 2026-06-18 生产 `/debug.html` 重新核验：工程页含 Acceptance tab 和导出/复制工具；正常 `/account.html` 没有 debug 链接。 | `docs/product-audit/03-ui-feature-audit.md:11,61,191,206,210,217,226`; `docs/product-audit/05-acceptance-run-report.md:190,206,208` |
| [x] 修复 callback 页暴露验收 payload / URL token。 | callback 页不再生成可见或隐藏 payload textarea；OAuth fragment 读取后立即 `history.replaceState` 清理；验收导出只从 `/debug.html` 走。 | `docs/product-audit/03-ui-feature-audit.md:50,54,60,61,206,210`; `docs/product-audit/05-acceptance-run-report.md:190,192,208,209` |
| [x] 更新验收报告到当前基线。 | `docs/product-audit/05-acceptance-run-report.md` 已追加“重新验收基线：UI 隔离”和“真实 session 校验尝试”章节，记录当前 git 起点、部署、测试命令、生产 URL 核验、callback 修复、agent JWT 过期和 prover/salt 空值。 | `docs/product-audit/05-acceptance-run-report.md:178,180,184,190,192,204,205,206,207,208,209,211,213,219,220,222,224` |
| [x] 更新合约与 Indexer 重新审查结果。 | `docs/product-audit/05-acceptance-run-report.md` 已追加“重新验收基线：合约与 Indexer 审查”章节，记录 Move build/test、Indexer/acceptance Vitest、源码核对、机械事件覆盖比对、仍保留缺口和真实 testnet 边界。 | `docs/product-audit/05-acceptance-run-report.md:226,234,235,236,237,238,239,243,244,245,246,248` |

## P0 真实 Testnet Acceptance

| 任务 | 证据要求 | 来源 |
| --- | --- | --- |
| [ ] 收集两个不同真实 zkLogin session。 | buyer/agent session 均在 `.research-network/secrets/`，字段完整，`localMockOnly !== true`，地址不同；不在文档中写 token。 | `docs/product-audit/04-e2e-user-story-scenarios.md:22,26,27,28,34`; `docs/product-audit/05-acceptance-run-report.md:153,155,156,157,158` |
| [ ] 给 buyer/agent testnet 地址注入测试 SUI。 | 两个地址余额分别满足 acceptance minimum；记录公开地址和余额，不记录敏感 session。 | `docs/product-audit/01-contract-feature-audit.md:268,269`; `docs/product-audit/05-acceptance-run-report.md:153,162` |
| [ ] 跑 `acceptance:production --preflight`。 | 生成 `.research-network/acceptance/testnet-preflight.json`；receipt 证明 prover、账号、余额、zk proof/address binding、epoch freshness；所有交易步骤为 `preflight_no_transactions`。 | `docs/product-audit/01-contract-feature-audit.md:267,268,269`; `docs/product-audit/04-e2e-user-story-scenarios.md:17,480,482,525,526,527`; `docs/product-audit/05-acceptance-run-report.md:109,110,121,162` |
| [ ] 跑 capped testnet execute。 | 生成 `.research-network/acceptance/testnet-execute.json`；包含 tx digest、object ids、events、balance changes、Walrus blob id、Seal id、hash evidence、spend cap。 | `docs/product-audit/01-contract-feature-audit.md:268,269`; `docs/product-audit/04-e2e-user-story-scenarios.md:17,480,482,500,503,504,505,506,507,508,509,521,522,523`; `docs/product-audit/05-acceptance-run-report.md:111,122,162` |
| [ ] 验证 receipt provenance 绑定当前 clean HEAD。 | receipt 的 `gitCommit`、`gitTreeState` 与当前提交一致；dirty tree receipt 不能进入 mainnet readiness。 | `docs/product-audit/04-e2e-user-story-scenarios.md:525,526,527`; `docs/product-audit/05-acceptance-run-report.md:52,53,117,121,122,123` |

## P0 真实 UI Acceptance

| 任务 | 证据要求 | 来源 |
| --- | --- | --- |
| [ ] 准备真实 Workbench URL。 | URL 指向部署后的真实页面，使用当前 testnet package/shared objects。 | `docs/product-audit/05-acceptance-run-report.md:153,159`; `docs/product-audit/04-e2e-user-story-scenarios.md:24,33` |
| [ ] 准备可执行 indexer/Walrus Site sync command。 | `--sync-command` 输出 JSON，包含 `events_ingested` 或 `eventsIngested`，供 UI acceptance 在用户刷新前同步。 | `docs/product-audit/05-acceptance-run-report.md:159,160`; `docs/product-audit/02-indexer-feature-audit.md:222,224,225` |
| [ ] 准备 Walrus Site object id。 | `--walrus-site-object-id ...` 可用于 receipt。 | `docs/product-audit/05-acceptance-run-report.md:161` |
| [ ] 跑 `npm run acceptance:ui` 生成普通用户浏览器 receipt。 | `.research-network/acceptance/testnet-ui.json`，kind 为 `normal-user-ui-acceptance/v1`；包含截图/trace、普通用户步骤、关键 UI 文案、indexer/buyer reload evidence。 | `docs/product-audit/03-ui-feature-audit.md:217,219,221,222,223,224,225,226`; `docs/product-audit/04-e2e-user-story-scenarios.md:18,480,482,510,511,512`; `docs/product-audit/05-acceptance-run-report.md:61,102,112,123,159,162` |
| [ ] 区分 demo fallback 和真实 UI receipt。 | demo fallback 只能保留为本地回归；真实 UI receipt 必须来自真实 signer、Walrus、Seal、Sui、Indexer。 | `docs/product-audit/05-acceptance-run-report.md:61,74,75,76,87,88,89,90,91,92,93,94,95,96,97,98,99,100,102`; `docs/product-audit/README.md:45,46,53` |

## P1 合约功能审计任务

| 任务 | 证据要求 | 来源 |
| --- | --- | --- |
| [x] 合约本地源码/测试审查。 | 2026-06-18 重新跑 Move build 和 Move 单测；本地确认核心合约入口、事件和 negative tests 存在；机械抽取 Move event catalog。真实 testnet execute 仍未完成。 | `docs/product-audit/05-acceptance-run-report.md:226,234,235,237,239,248`; `move/sources/access.move:86,111,152,161,178,199,215,232,246`; `move/sources/delegation.move:137,175,191,213,231,253,276,297`; `move/sources/settlement.move:160,186,220,246,281` |
| [ ] Research Asset 完整发布验收。 | 发布含 paper + skill + workflow 的 repo；链上 `ResearchAssetPublished`、`SkillPublished`；UI 显示 object id、blob id、commit、manifest hash。 | `docs/product-audit/01-contract-feature-audit.md:37,41,42,43,52,53,54,58,59,61,63,64,65,66`; `docs/product-audit/04-e2e-user-story-scenarios.md:406,410,414,415,416,417,418,419,420,421,422,423,424,426,428,429,434,438,442,444,445,446` |
| [ ] ResearchReport + Seal Access 验收。 | public/encrypted/private 三类报告均真实发布；Walrus readback hash 匹配；作者/会员/订阅者/买家/agent/outsider/arbitrator 权限符合预期。 | `docs/product-audit/01-contract-feature-audit.md:68,72,73,74,78,79,80,84,85,86,90,91,92,94,96,97,98`; `docs/product-audit/04-e2e-user-story-scenarios.md:111,148,187,241,279,309,364` |
| [ ] 平台会员、agent 订阅、receipt、结算、claim 验收。 | 购买 pass、解密、记录唯一 receipt、settle、claim；重复 receipt/重复结算失败；余额变化写入 acceptance receipt。 | `docs/product-audit/01-contract-feature-audit.md:100,104,105,106,107,117,118,119,123,124,125,127,129,130,131,132`; `docs/product-audit/04-e2e-user-story-scenarios.md:187,191,195,196,197,198,199,200,201,202,203,205,207,208,209,210,211,220,222,223,224,225,226,228,230,231,232,233,234,236,238,239` |
| [ ] 私有委托 happy path / negative / dispute path 验收。 | create -> accept -> fund -> publish_private_result -> buyer decrypt -> complete；非授权操作失败；dispute 前/中/后仲裁权限变化正确。 | `docs/product-audit/01-contract-feature-audit.md:134,138,139,140,141,142,154,155,156,157,161,162,163,165,167,168,169`; `docs/product-audit/04-e2e-user-story-scenarios.md:309,313,317,318,319,320,321,322,323,324,325,326,327,329,331,332,333,334,335,336,345,347,348,349,350,352,354,355,356,358,360,361,362,364,368,372,373,374,375,376,377,379,381,382,383,388,390,391,393,395,396,397,398,400,402,403,404` |
| [ ] 收益/分账/Claim dashboard 验收。 | Agent 看到 `total_earned`、`total_claimed`、`unclaimed`；claim 到真实 SUI；tx 可追溯。 | `docs/product-audit/01-contract-feature-audit.md:171,175,176,177,181,182,183,187,188,189,193,194`; `/Users/echo/project/research-network/PRODUCT.md:23,49,50,51,66,76` |
| [ ] 跨链支付保持不进入 V1 资金验收。 | 文档和 UI 不把跨链支付作为已上线能力；只保留事件骨架/后续任务。 | `docs/product-audit/01-contract-feature-audit.md:196,200,204,205,209,210,212,214,215`; `docs/product-audit/02-indexer-feature-audit.md:79,144` |
| [ ] Reputation/Badge/Governance 不作为已实现卖点。 | 页面和审计口径只把真实阅读、订阅、委托、引用/fork、badge 事件当质量信号。 | `docs/product-audit/01-contract-feature-audit.md:217,221,222,226,227,231,232`; `docs/product-audit/README.md:39` |
| [ ] 锁定合约事件契约 fixture。 | 建立机器可读 event fixture，并用于 Move event shape、Sui normalizer、Indexer、API response、UI snapshot。 | `docs/product-audit/01-contract-feature-audit.md:234,236,238,240,241,242,243,244,245,246,247,248,250,251,252,253,254,255,256,259`; `docs/product-audit/02-indexer-feature-audit.md:35,42,57` |

## P1 Indexer 验收任务

| 任务 | 证据要求 | 来源 |
| --- | --- | --- |
| [x] Indexer 本地事件投影/搜索边界审查。 | 2026-06-18 重新跑 indexer/acceptance 相关 Vitest，55 tests passed；确认事件幂等、Sui normalization/poll cursor、private delegation report 不进入 public search、agent earnings/receipt projection 可用；机械比对 Move event -> Indexer case。真实 testnet poll 仍未完成。 | `docs/product-audit/05-acceptance-run-report.md:226,236,238,239,243`; `src/core/indexer.ts:285,308,360,385,417,446,485,508,529,658,688,721`; `tests/indexer-events.test.ts:85,102,112,178,236,251,278` |
| [ ] `research index:poll` 从当前 testnet package 读到真实事件。 | 记录 package id、RPC、checkpoint/cursor、raw events。 | `docs/product-audit/02-indexer-feature-audit.md:27,31,32,208,210,214,222,224` |
| [ ] 同一事件重复 poll/replay 不重复投影。 | `processed_event_keys` 证明幂等；重复 replay 后 reports/receipts/earnings 不增长。 | `docs/product-audit/02-indexer-feature-audit.md:29,210,216,222,225,228` |
| [ ] 补或明确 `PlatformMembershipPaid` 投影策略。 | 2026-06-18 机械比对确认缺口成立：`settlement.move` 发 `PlatformMembershipPaid`，但 `src/core/indexer.ts` switch 未单独处理；若 UI 展示支付金额/fee/duration，则补 handler；否则明确只展示 pass/payment split 口径。 | `docs/product-audit/01-contract-feature-audit.md:123,238,240,241`; `docs/product-audit/02-indexer-feature-audit.md:57`; `docs/product-audit/05-acceptance-run-report.md:239,243` |
| [ ] Walrus manifest fetcher 验证 hash。 | 拉取 blob、校验 manifest hash、校验 schema、失败标记 `invalid` 或 `pending_manifest`，不能当真。 | `docs/product-audit/02-indexer-feature-audit.md:35,39,137,179,181,188,190,191,192,193,194,195,222,226` |
| [ ] Public/encrypted/private 搜索边界验收。 | public 可搜；encrypted 仅 preview 可搜；private result 不进游客搜索/API；demo plaintext 不进入公共 index。 | `docs/product-audit/02-indexer-feature-audit.md:81,83,87,88,92,97,99,103,104,108,109,113,115,119,120,124,129,130,218,227` |
| [ ] API 授权过滤验收。 | `/api/search`、`/api/reports`、`/api/delegations`、`/api/assets/:id/economics` 对 caller address 做正确过滤。 | `docs/product-audit/02-indexer-feature-audit.md:197,199,201,202,203,204,206,220` |
| [ ] 生产常驻调度和监控方案落地。 | worker、checkpoint、retry/dead-letter、lag 指标、多 RPC fallback、replay/reindex 审计。 | `docs/product-audit/02-indexer-feature-audit.md:35,37,41,146,148,150,152,153,154,155,156,157,159,161,162,163,164,165,166,167,168`; `docs/product-audit/README.md:44,55` |
| [ ] 生产存储策略拍板并实现。 | PostgreSQL/pgvector 或等价存储，替换本地 `index.json` 产品依赖。 | `docs/product-audit/02-indexer-feature-audit.md:35,38,170,172,174,175,176,177`; `docs/20-修复-plan-功能缺口与前端生产化.md:153,156` |

## P1 UI 验收任务

| 任务 | 证据要求 | 来源 |
| --- | --- | --- |
| [ ] 游客浏览和搜索。 | 未登录游客能搜索并进入 public asset；encrypted 只显示 preview/解锁入口；private delegation 不公开。 | `docs/product-audit/03-ui-feature-audit.md:25,29,30,38,40,41,42,44,46,47,48`; `docs/product-audit/04-e2e-user-story-scenarios.md:36,40,44,45,46,47,58,60,61,62,64,66,67` |
| [ ] L1/L2 zkLogin 状态清晰。 | account/workbench 显示 L1 only 或 L2 signer ready；缺 signer 时不悄悄生成 demo id；至少一笔 testnet tx 可签。 | `docs/product-audit/03-ui-feature-audit.md:50,54,55,56,60,61,62,64,66,67,68,70,72,73,74`; `/Users/echo/project/research-network/PRODUCT.md:31,32,33,34` |
| [ ] GitHub 组织多选 -> repo 下拉。 | 已授权个人/组织可选；未授权组织 disabled；选择组织后 repo 下拉刷新；真实账号浏览器走通。 | `docs/product-audit/03-ui-feature-audit.md:76,80,81,82,86,87,88,89,91,93,94,95,97,99,100,101,102`; `docs/20-修复-plan-功能缺口与前端生产化.md:55,57,64,65,66,67,68,69,70,71,72,73,76,77,78,79,80` |
| [ ] 发布 UI 产品化。 | repo -> validate -> package -> Walrus -> Sui -> Indexer -> Web；显示真实 blob/tx/object/hash/freshness；支持 pending retry。 | `docs/product-audit/03-ui-feature-audit.md:104,108,109,113,114,115,117,119,120,121,123,125,126,127`; `docs/product-audit/04-e2e-user-story-scenarios.md:406,410,414,415,416,417,418,419,420,421,422,423,424,442,444,445,446` |
| [ ] 访问/会员/订阅/解密 UI。 | 外人拒绝、会员解密+receipt、订阅解密但不占平台池、重复 receipt 说明、错误原因用户友好。 | `docs/product-audit/03-ui-feature-audit.md:129,133,134,135,136,140,141,142,144,146,147,148,150,152,153,154,155`; `docs/product-audit/04-e2e-user-story-scenarios.md:187,241,279` |
| [ ] 私有委托 UI。 | buyer/agent/arbitrator/outsider 分权视图；deadline/budget/status/result/dispute 清楚分区；资金变化可见。 | `docs/product-audit/03-ui-feature-audit.md:157,161,162,163,167,168,170,172,173,174,176,178,179,180,181`; `docs/product-audit/04-e2e-user-story-scenarios.md:309,364` |
| [ ] Account/Dashboard 完整化。 | 同一 Sui address 看到自己的 pass/subscription/receipt/delegation/earnings；切换账户隔离；sign out 清敏感 sessionStorage。 | `docs/product-audit/03-ui-feature-audit.md:183,187,191,194,196,197,198,200,202,203,204`; `/Users/echo/project/research-network/PRODUCT.md:36,40,41,42,43,44,45,46,49,50,51,52,53,57` |
| [x] Debug/验收工具不污染用户界面。 | 2026-06-18 重新执行 UI 单测和生产浏览器核验：`/account.html` 无验收工具或 debug 链接，`/debug.html` 独立承载工程 Acceptance tab、导出和复制按钮；callback 页不暴露 payload。 | `docs/product-audit/03-ui-feature-audit.md:11,61,191,206,210`; `web/README.md:55,56,59,60`; `docs/product-audit/05-acceptance-run-report.md:190,204,207,208,209` |

## E2E 场景任务板

| 场景 | 状态 | 最低证据 | 来源 |
| --- | --- | --- | --- |
| S0 游客浏览公开内容 | [ ] | 未登录搜索/阅读 public；private 不公开。 | `docs/product-audit/04-e2e-user-story-scenarios.md:36,40,44,45,46,47,51,53,55,56,58,60,61,62,64,66,67` |
| S1 zkLogin + GitHub 组织/repo | [ ] | Google 登录、GitHub OAuth、组织多选、repo 下拉、server attestation。 | `docs/product-audit/04-e2e-user-story-scenarios.md:69,73,77,78,79,80,81,82,83,84,85,87,89,90,91,93,95,96,98,100,101,102,103,104,106,108,109` |
| S2 Agent 发布 public report | [ ] | 真实 Walrus plaintext blob、Sui tx、report object、Indexer 可搜、游客可读。 | `docs/product-audit/04-e2e-user-story-scenarios.md:111,115,119,120,121,122,123,124,126,128,129,130,132,134,135,136,138,140,141,142,144,146` |
| S3 Agent 发布 encrypted report 并自解密 | [ ] | ciphertext 上传、Seal id、publish tx、作者解密、plaintext 不进游客 DOM/API。 | `docs/product-audit/04-e2e-user-story-scenarios.md:148,152,156,157,158,159,160,161,162,164,166,167,168,170,172,173,174,175,177,179,180,181,183,185` |
| S4 平台会员购买、解密、receipt、结算、claim | [ ] | 买会员、解密、record receipt、settle、agent claim；重复 receipt/过期失败。 | `docs/product-audit/04-e2e-user-story-scenarios.md:187,191,195,196,197,198,199,200,201,202,203,205,207,208,209,210,211,220,222,223,224,225,226,228,230,231,232,233,234,236,238,239` |
| S5 直接订阅 agent 并解密 | [ ] | subscription payment/pass、解密成功、access type 为 agent_subscription，不占平台会员池。 | `docs/product-audit/04-e2e-user-story-scenarios.md:241,245,249,250,251,253,255,256,257,259,260,262,264,265,266,268,270,271,272,274,276,277` |
| S6 未授权用户拒绝访问 encrypted report | [ ] | Outsider 只能看 preview；不新增 receipt/earnings；刷新/URL/actor 切换不能绕过。 | `docs/product-audit/04-e2e-user-story-scenarios.md:279,283,287,288,290,292,294,296,297,299,301,302,303,305,307` |
| S7 私有委托 happy path | [ ] | create/accept/fund/submit/decrypt/complete；private result 不公开；非授权失败。 | `docs/product-audit/04-e2e-user-story-scenarios.md:309,313,317,318,319,320,321,322,323,324,325,326,327,329,331,332,333,334,335,336,337,338,339,340,341,342,343,345,347,348,349,350,352,354,355,356,358,360,361,362` |
| S8 私有委托争议和仲裁临时解密 | [ ] | dispute 前拒绝、dispute 中可解密、resolved 后关闭、bps 校验。 | `docs/product-audit/04-e2e-user-story-scenarios.md:364,368,372,373,374,375,376,377,379,381,382,383,385,386,388,390,391,393,395,396,397,398,400,402,403,404` |
| S9 GitHub repo 发布完整 Research Asset | [ ] | validate/package/Walrus/Sui/Indexer/asset page；错误阻断和 pending retry。 | `docs/product-audit/04-e2e-user-story-scenarios.md:406,410,414,415,416,417,418,419,420,421,422,423,424,426,428,429,430,431,432,434,436,437,438,439,440,442,444,445,446,448,450,451,452` |
| S10 Mainnet readiness 防误用 | [ ] | mainnet 下拒绝 testnet ids/endpoints、缺 receipt、dirty provenance、无 signer demo action。 | `docs/product-audit/04-e2e-user-story-scenarios.md:454,458,462,463,464,465,466,468,470,471,472,473,475,477,478` |

## Mainnet Readiness 任务

| 任务 | 证据要求 | 来源 |
| --- | --- | --- |
| [ ] 补齐 mainnet acceptance 配置。 | 显式 mainnet package/shared objects/RPC/Walrus/Seal/auth/prover，不允许 testnet 值混入。 | `docs/product-audit/04-e2e-user-story-scenarios.md:454,458,462,463,470,471,472,473`; `docs/product-audit/05-acceptance-run-report.md:124,125,126,127,128,163` |
| [ ] `readiness:mainnet --stage mainnet-config` 通过。 | 必须提供 testnet preflight、testnet execute、testnet UI receipt；provenance clean 且配置匹配。 | `docs/product-audit/05-acceptance-run-report.md:104,109,110,111,112,113,114,117,121,122,123`; `docs/product-audit/04-e2e-user-story-scenarios.md:546` |
| [ ] mainnet preflight 通过。 | 不花真实资金；证明 mainnet config、prover、账户、余额、epoch freshness。 | `docs/product-audit/01-contract-feature-audit.md:270`; `docs/product-audit/04-e2e-user-story-scenarios.md:546`; `docs/product-audit/05-acceptance-run-report.md:163` |
| [ ] mainnet 小额 capped execute。 | 只跑 S2/S3/S4/S7 小额 capped execute；确认 spend cap、rollback/暂停开关。 | `docs/product-audit/01-contract-feature-audit.md:270`; `docs/product-audit/04-e2e-user-story-scenarios.md:547` |

## 证据目录

| 路径 | 用途 | 状态 |
| --- | --- | --- |
| `.research-network/secrets/acceptance-buyer.json` | buyer zkLogin session，敏感，不提交。 | [x] 2026-06-18 脱敏校验通过，`localMockOnly: false` |
| `.research-network/secrets/acceptance-agent.json` | agent zkLogin session，敏感，不提交。 | [ ] 2026-06-18 脱敏校验失败：Google JWT `jwt_expired`，待重新生成 |
| `.research-network/acceptance/testnet-preflight.json` | testnet no-spend preflight receipt。 | [ ] 待生成 |
| `.research-network/acceptance/testnet-execute.json` | testnet capped execute receipt。 | [ ] 待生成 |
| `.research-network/acceptance/testnet-ui.json` | normal-user-ui-acceptance receipt。 | [ ] 待生成 |
| `.research-network/acceptance/mainnet-preflight.json` | mainnet no-spend preflight receipt。 | [ ] 待生成 |
| `.research-network/acceptance/mainnet-execute.json` | mainnet 小额 capped execute receipt。 | [ ] 待生成 |
| `.research-network/acceptance/mainnet-readiness-*.json` | readiness gate 输出。 | [ ] 待生成 ready=true 版本 |

## 来源索引

| 文件 | 行号 | 说明 |
| --- | --- | --- |
| `docs/product-audit/README.md` | 5,21,25,26,27,28,29,43,44,45,46,52,53,54,55,56 | 产品审计目录目标、文档包、最高风险。 |
| `docs/product-audit/01-contract-feature-audit.md` | 19-33,61-66,94-98,127-132,165-169,234-270 | 合约能力、事件风险、合约生产门禁。 |
| `docs/product-audit/02-indexer-feature-audit.md` | 27-42,44-79,81-130,146-206,208-228 | Indexer 当前能力、缺口、搜索边界、生产门禁。 |
| `docs/product-audit/03-ui-feature-audit.md` | 3-12,25-49,50-75,76-103,104-128,129-156,157-181,183-204,206-226 | UI 审计、用户旅程、风险、UI 门禁。 |
| `docs/product-audit/04-e2e-user-story-scenarios.md` | 3-18,20-34,36-478,480-538,540-547 | E2E 三层、公共前置、S0-S10、证据包格式、发布门禁。 |
| `docs/product-audit/05-acceptance-run-report.md` | 27-57,59-102,104-128,132-149,151-176,178-224,226-248 | 已执行门禁、dry-run、本地 UI E2E、readiness 失败项、未完成项、本轮重新验收基线、真实 session 校验尝试、合约与 Indexer 重新审查。 |
| `docs/19-session-019ebec9-review-and-misalignment.md` | 130-144,176-181,199-220,226-247 | 为什么不能把原始 plan 的本地测试当作生产验收。 |
| `docs/20-修复-plan-功能缺口与前端生产化.md` | 55-80,84-115,118-145,149-163 | GitHub、真实 Walrus/Seal/Sui、E2E、上生产执行计划。 |
| `docs/21-agent-交接清单.md` | 112-128,132-140 | 接手验证命令、危险信号、mainnet 未验收提醒。 |
| `/Users/echo/project/research-network/PRODUCT.md` | 18-34,36-57,59-76 | 产品角色、身份层级、账户页信息架构、生产就绪清单。 |
