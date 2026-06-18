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

真实 testnet/mainnet 验收仍需以下非代码材料：

1. 两个不同真实 Google zkLogin session：
   - `.research-network/secrets/acceptance-buyer.json`
   - `.research-network/secrets/acceptance-agent.json`
2. 可用 `ZKLOGIN_PROVER_URL`。
3. 真实 Workbench URL，传给 `npm run acceptance:ui -- --url ...`。
4. 可执行的 indexer/Walrus Site 同步命令，传给 `--sync-command ...`，且命令必须输出包含 `events_ingested` 或 `eventsIngested` 的 JSON。
5. Walrus Site object id，传给 `--walrus-site-object-id ...`。
6. testnet preflight receipt、testnet execute receipt、testnet UI receipt 全部来自当前 clean HEAD。
7. mainnet 配置和小额 mainnet preflight/execute receipt。只有 readiness report `ready: true` 后，才可声称支持 mainnet 资金运行。

## 8. 结论

本轮已经完成：

- 审计文档已提交。
- 本地 TS/Web/Move 测试和构建门禁已通过。
- production acceptance dry-run 已通过并绑定 clean HEAD。
- 本地浏览器 UI E2E 已通过，覆盖 encrypted report、membership、subscription、private delegation、settlement 和 claim 的 demo fallback 路径。
- readiness gate 已结构化证明正式 testnet/mainnet 验收仍缺真实 session、真实 UI acceptance receipt 和 mainnet 配置。

因此，当前状态可以作为本地开发和产品审计回归基线，但不能作为 testnet production acceptance 或 mainnet readiness 通过证据。
