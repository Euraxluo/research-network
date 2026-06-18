# Acceptance Run Report

运行日期：2026-06-18

本报告记录在产品审计文档完成后，按 `docs/17-implementation-status-and-decisions.md`、`docs/21-agent-交接清单.md` 和本目录 E2E 场景文档执行的本地质量门禁、生产验收 dry-run、浏览器 UI E2E 和 readiness gate 结果。

## 1. Git 基线

当前验收基线：

```text
cac6ac4 test: update readiness ui funding fixture
c506d96 test: strengthen ui acceptance evidence
0b35863 docs: add product audit scenarios
```

`git status --short` 在验收结束时为空，说明代码工作树干净。

## 2. 已提交变更

| Commit | 内容 |
| --- | --- |
| `0b35863` | 新增产品审计文档包：合约功能审计、Indexer 功能审计、UI 功能审计、E2E 用户故事场景。 |
| `c506d96` | 加强 UI acceptance 对 delegation funding 交易的链上成功、扣款和事件证据要求。 |
| `cac6ac4` | 更新 mainnet readiness 测试 fixture，使模拟 UI receipt 满足新的 delegation funding evidence 规则。 |

## 3. 自动化质量门禁

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `rtk npm run build` | 通过 | TypeScript 项目构建通过。 |
| `rtk env -u NODE_ENV npm test` | 通过 | `21` 个 test file，`185` 个 Vitest 测试全部通过。 |
| `rtk env -u NODE_ENV npm run web:vite:build` | 通过 | Vite/React Workbench 生产构建通过。 |
| `rtk npm run web:build` | 通过 | CLI 静态站点生成通过，输出到 `web/dist`。 |
| `rtk npm run move:build` | 通过 | Sui Move build 通过。 |
| `rtk sui move test --path move --silence-warnings` | 通过 | Move 单测 `23/23` 通过。 |

## 4. Production Acceptance Dry-run

执行命令：

```bash
rtk npm run acceptance:production -- --network testnet --receipt .research-network/acceptance/dry-run.json
```

结果：

| 字段 | 值 |
| --- | --- |
| `conclusion` | `not_run` |
| `network` | `testnet` |
| `gitCommit` | `cac6ac464045be6c61805c98a6a5b6378aa1e126` |
| `gitTreeState` | `clean` |
| `packageId` | `0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e` |
| `steps` | `16` 个步骤全部完成 dry-run 编排，真实交易步骤按 dry-run 跳过。 |

说明：dry-run 只证明配置、预算和步骤编排，不读取 zkLogin session，不发交易，不花费 SUI。

## 5. 浏览器 UI E2E

由于本机没有 `.research-network/secrets/acceptance-buyer.json` 和 `.research-network/secrets/acceptance-agent.json`，无法执行真实 `normal-user-ui-acceptance/v1`。本轮已执行可在本机完成的浏览器交互：打开本地 Vite Workbench，并通过页面自带 demo identity 完成一条无 signer 的本地 UI E2E。

执行结果保存在 gitignored 目录：

```text
.research-network/acceptance/local-workbench-e2e.json
.research-network/acceptance/local-workbench-e2e.png
```

结果摘要：

| 项 | 值 |
| --- | --- |
| `kind` | `local-workbench-browser-e2e/v1` |
| `conclusion` | `passed` |
| `mode` | `demo-fallback-no-signer` |
| `reports` | `2` |
| `encryptedReports` | `1` |
| `privateDelegationReports` | `1` |
| `platformMemberships` | `1` |
| `agentSubscriptions` | `1` |
| `accessReceipts` | `2` |
| `settledReceipts` | `1` |
| `delegations` | `1` |
| `completedDelegations` | `1` |

浏览器实际操作覆盖：

1. 加载 Workbench。
2. Seed local test identity。
3. Agent 发布 encrypted report。
4. Outsider 尝试访问 encrypted report，被 `needs_membership_or_subscription` 拒绝。
5. Platform member 购买会员并解密 encrypted report。
6. Agent subscriber 订阅 agent 并解密同一 report。
7. Delegation buyer 创建并 fund 私有委托。
8. Agent 提交 private delegation result。
9. Buyer 解密 private result。
10. Buyer complete delegation。
11. Member settle membership receipt。
12. Agent claim earnings。

边界说明：该浏览器 E2E 验证的是 UI 状态机、访问控制文案、demo fallback 和页面交互路径。它不能替代真实 testnet `acceptance:ui`，因为没有真实 zkLogin signer、Walrus、Seal、Sui 交易和 indexer/Walrus Site sync command。

## 6. Readiness Gate 结果

执行命令：

```bash
rtk npx tsx scripts/mainnet-readiness.ts --stage mainnet-config \
  --testnet-preflight-receipt .research-network/acceptance/testnet-preflight.json \
  --testnet-execute-receipt .research-network/acceptance/testnet-execute.json \
  --testnet-ui-receipt .research-network/acceptance/testnet-ui.json \
  --skip-chain --json \
  > .research-network/acceptance/mainnet-readiness-missing.json
```

结果：`ready: false`。关键失败项：

| 检查 | 失败原因 |
| --- | --- |
| `receipt.testnet-preflight` | 缺少 testnet preflight acceptance receipt。 |
| `receipt.testnet-execute` | 缺少 testnet execute acceptance receipt。 |
| `receipt.testnet-ui` | 缺少 testnet UI acceptance receipt。 |
| `config.acceptance.mainnet` | 缺少显式 mainnet acceptance 配置。 |
| `config.web.mainnet` | 缺少显式 `VITE_RN_*` mainnet Web 配置。 |
| `config.vercel.walrus.mainnet` | 缺少 mainnet Walrus proxy 配置。 |
| `config.auth.mainnet` | 缺少 `AUTH_SUI_RPC_URL`。 |
| `config.prover` | 缺少 `ZKLOGIN_PROVER_URL`。 |

## 7. 未完成项

## 7. 自动补齐的本地材料

已新增脚本：

```bash
rtk npm run acceptance:local-materials
```

该脚本会自动生成：

```text
.research-network/secrets/acceptance-buyer.json
.research-network/secrets/acceptance-agent.json
.research-network/acceptance/local-preflight.json
.research-network/acceptance/local-materials.json
```

并启动本地 mock zkLogin prover + mock Sui JSON-RPC，执行 `acceptance:production --preflight`。生成的 session 文件包含 `localMockOnly: true` 和 warning 字段，只能证明本地 session/prover/balance/preflight 编排可自举，不能作为真实 testnet/mainnet readiness 证据。

## 8. 未完成项

真实 testnet/mainnet 验收仍需以下外部真实材料：

1. 两个不同真实 Google zkLogin session：
   - `.research-network/secrets/acceptance-buyer.json`
   - `.research-network/secrets/acceptance-agent.json`
2. 可用 `ZKLOGIN_PROVER_URL`。
3. 真实 Workbench URL，传给 `npm run acceptance:ui -- --url ...`。
4. 可执行的 indexer/Walrus Site 同步命令，传给 `--sync-command ...`，且命令必须输出包含 `events_ingested` 或 `eventsIngested` 的 JSON。
5. Walrus Site object id，传给 `--walrus-site-object-id ...`。
6. testnet preflight receipt、testnet execute receipt、testnet UI receipt 全部来自当前 clean HEAD。
7. mainnet 配置和小额 mainnet preflight/execute receipt。只有 readiness report `ready: true` 后，才可声称支持 mainnet 资金运行。

## 9. 结论

本轮已经完成：

- 审计文档已提交。
- 本地 TS/Web/Move 测试和构建门禁已通过。
- production acceptance dry-run 已通过并绑定 clean HEAD。
- 本地浏览器 UI E2E 已通过，覆盖 encrypted report、membership、subscription、private delegation、settlement 和 claim 的 demo fallback 路径。
- local acceptance materials 可由 `acceptance:local-materials` 自动生成，并可跑通本地 mock preflight。
- readiness gate 已结构化证明正式 testnet/mainnet 验收仍缺真实 session、真实 UI acceptance receipt 和 mainnet 配置。

因此，当前状态可以作为本地开发和产品审计回归基线，但不能作为 testnet production acceptance 或 mainnet readiness 通过证据。

## 10. 重新验收基线：UI 隔离

用户已要求所有验收和审查路径全部重新做，不信任历史结果。本节只记录在清单建立后重新执行的证据；旧 dry-run、旧浏览器目测和旧 mock receipt 不用于打勾。

当前重新验收起点：

```text
3d66255 docs: mark rerun quality gate complete
fdc153a chore: reset acceptance checklist and isolate debug tools
397990f fix: load login auth scripts sequentially
```

工作树在执行本轮 UI 隔离验收前为 clean。

本轮更新后已重新部署到生产：

```text
deployment: dpl_GPuEoWf4yAJ5QiPfGXzVGim1YUXQ
url: https://research-network-7dqhlpyzf-euraxluos-projects.vercel.app
alias: https://research-network-web.vercel.app
```

已重新执行：

| 项 | 结果 | 证据摘要 |
| --- | --- | --- |
| Account/Debug/Callback UI 单测 | 通过 | `rtk npm run test -- tests/web-account-ui.test.ts tests/web-debug-ui.test.ts tests/web-acceptance-session.test.ts tests/web-e2e.test.ts` 通过，4 个 test file / 19 个测试。 |
| TypeScript build | 通过 | `rtk npm run build` 通过。 |
| Debug copy 工具构建 | 通过 | `rtk npm run web:vite:build` 通过，`debug-*.js` 已包含 copy session 工具。 |
| 生产 `/account.html` | 通过 | 浏览器打开 `https://research-network-web.vercel.app/account.html`，页面没有 `Production acceptance session`、`Export buyer session`、`Export agent session`、`Acceptance session`、debug 文案或 `/debug.html` 链接。 |
| 生产 `/debug.html` | 通过 | 浏览器打开 `https://research-network-web.vercel.app/debug.html`，工程页有 `Acceptance` tab、`Acceptance session`、buyer/agent session export/copy 按钮，并标注工程用途；正常产品账户页未链接到该路由。 |
| 生产 `/auth/callback.js` | 通过 | 线上脚本包含 `history.replaceState` 清理 OAuth fragment；包含 `/debug.html` 工程入口；不再包含 `callback-acceptance-session-payload`、`Hidden acceptance session JSON` 或 `rows="12"`。浏览器当前地址已从带 `id_token` 的 callback URL 切到 `/account.html`，地址栏不再含 `id_token`。 |

边界说明：本节只证明“正常用户账户页不再被验收/调试工具污染、调试工具已隔离到工程路由、callback 页不再暴露验收 payload 或 URL token”。它不证明两个真实 zkLogin session 已全部有效，也不证明 testnet preflight、capped execute、真实 UI acceptance 或 mainnet readiness 已通过。

## 11. 重新验收基线：真实 session 校验尝试

本轮没有把旧 session 直接当作证据。已重新执行脱敏校验：字段完整性、`localMockOnly`、地址绑定、testnet epoch freshness、Google JWT 验签。结果如下：

| 项 | 结果 | 证据摘要 |
| --- | --- | --- |
| `acceptance-buyer.json` | 通过 | `localMockOnly: false`、字段完整、地址绑定通过、current epoch `1134`、maxEpoch `1148`、剩余 `14` epochs、Google JWT 验签通过；公开地址 `0xb178126020d69bb24ecd6a39ac5db18a8badae973dae0e9b20a889a68b609d7f`。 |
| `acceptance-agent.json` | 未通过 | `localMockOnly: false`、字段完整、地址绑定通过、current epoch `1134`、maxEpoch `1148`、剩余 `14` epochs，但 Google JWT 验签失败：`jwt_expired`；公开地址 `0x5c282a83fcfc9b6479a50dce817c6ed72da53259f76d5bd33a0c822721fba4ea`。 |
| 两角色地址 | 通过 | buyer/agent 地址不同。 |
| Vercel production env | 阻塞 | 读取 `.research-network/secrets/vercel-production.env` 后确认 `ZKLOGIN_PROVER_URL` 和 `ZKLOGIN_SALT_SECRET` 键存在但值长度为 `0`，因此不能执行 prover proof 校验或真实 preflight。 |

结论：两个真实 session 任务仍未完成。下一步必须重新获取 agent Google zkLogin session，并补齐生产 `ZKLOGIN_PROVER_URL` / `ZKLOGIN_SALT_SECRET` 后再跑 `acceptance:production --preflight`。

## 12. 重新验收基线：合约与 Indexer 审查

用户指出不能只做前端。本节记录本轮重新核对合约与 Indexer 的证据；它只证明本地源码、事件矩阵和测试基线，不替代真实 testnet transaction receipt 或生产 index poll。

已重新执行：

| 项 | 结果 | 证据摘要 |
| --- | --- | --- |
| Move build | 通过 | `rtk npm run move:build` 通过，Sui Move package `research_protocol` build 成功。 |
| Move 单测 | 通过 | `rtk sui move test --path move --silence-warnings` 通过，23/23 Move tests passed。覆盖 research asset、skill、revenue、payment、access/delegation、重复 receipt、重复 settlement、过期会员拒绝、private delegation 授权/拒绝等。 |
| Indexer/acceptance Vitest | 通过 | `rtk npm run test -- tests/indexer-events.test.ts tests/protocol-kit.test.ts tests/production-acceptance.test.ts tests/ui-acceptance.test.ts` 通过，4 个 test file / 55 个测试。覆盖事件投影、幂等 replay、private delegation 不进搜索、Sui event normalization/poll cursor、production acceptance guardrail、UI acceptance receipt guardrail。 |
| 合约源码核对 | 完成 | 重新核对 `access.move`、`delegation.move`、`settlement.move`：Seal policy、会员/订阅 pass、receipt、委托状态机、争议仲裁临时解密、重复结算保护、claim earnings 均有链上入口和事件。 |
| Indexer 源码核对 | 完成 | 重新核对 `src/core/indexer.ts`：`private_delegation` report 删除 public search doc；`processed_event_keys` 做幂等；`ResearchReportPublished`、`AccessReceiptRecorded`、delegation、settlement、earnings、payment 等事件有投影。 |
| Move event -> Indexer case 机械比对 | 发现缺口 | 从 `move/sources/*.move` 抽取 `public struct ... has copy, drop` 事件，共 `31` 个；从 `src/core/indexer.ts` 抽取 switch case，共 `31` 个。缺失 handler：`PlatformMembershipPaid`。额外本地兼容 case：`AssetRelationshipRegistered`。 |

仍保留的审查缺口：

1. `PlatformMembershipPaid` 在 `settlement.move` 中发事件，但 `src/core/indexer.ts` 目前没有单独投影 handler；机械比对已确认这是唯一 Move event -> Indexer case 缺口。如果产品要展示平台会员支付金额、platform fee、duration，必须补投影或明确只以 `PlatformMembershipPurchased` pass 作为 UI 事实。
2. `DelegationCreated` 当前会创建 delegation search doc，body 包含 buyer/agent。private result 不进公共搜索已成立，但“委托存在本身是否公开”仍需产品裁决和 API 授权过滤。
3. Walrus manifest fetcher、生产常驻 index worker、生产数据库、retry/dead-letter、权限过滤 API 仍未落地。
4. 本轮未执行真实 `research index:poll --package-id ...` 从 testnet 读取事件；也未生成真实 testnet preflight/execute/UI receipt。

结论：合约与 Indexer 的本地审查基线已重新完成，但只能勾“本地源码/测试审查”。真实 testnet 合约功能验收、生产 Indexer 验收和 mainnet readiness 仍保持未完成。
