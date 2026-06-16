# Agent 交接清单（Handoff Package Index）

> 本文档是交给**下一个接手 agent / 开发者**的导航清单。
> 按"先读什么、各文档作用、必须遵守的约束、当前危险信号"组织。
>
> 一句话现状：**协议骨架单元测试全绿，但前端是 TS 内联字符串拼接（非生产架构），且用户要求"可上生产 + 真实数据 + e2e"尚未兑现。HANDOFF.md 顶部声明被纠偏过，勿轻信"修复完成"。**

---

## 0. 接手前必读顺序（按这个顺序读，30 分钟建立全局）

1. **本文档**（`docs/21-agent-交接清单.md`）—— 导航
2. **`docs/20-修复-plan-功能缺口与前端生产化.md`** —— 知道**要做什么**（5 个里程碑）
3. **`docs/19-session-019ebec9-review-and-misalignment.md`** —— 知道**为什么**（用户故事链 + 错位根因，含原始 plan 全文）
4. **`HANDOFF.md`**（⚠️ 读顶部纠偏段，别被第1行"修复完成"误导）
5. **`PRODUCT.md`** —— 产品视角（用户能做什么）
6. **`docs/18-research-commerce-access.md`** —— Seal Access 协议 canonical
7. **`docs/17-implementation-status-and-decisions.md`** —— 实现状态与决策记录

---

## 1. 必交文档清单（按用途分组）

### A. 本次审查产出（核心交接物，新 agent 必读）

| 文档 | 作用 | 一句话 |
|---|---|---|
| `docs/19-session-019ebec9-review-and-misalignment.md` | **审查报告** | 50 条消息还原的用户故事链 + 原始 plan 全文 + 错位分析。回答"为什么跑不通" |
| `docs/20-修复-plan-功能缺口与前端生产化.md` | **执行 plan** | 主线 I（功能 B/C/D/E）+ 主线 II（前端重构），5 个里程碑 M1~M5，每个有任务+验收清单。回答"怎么做" |
| `docs/21-agent-交接清单.md` | **本清单** | 导航索引 |

### B. 项目顶层状态文档（项目根目录）

| 文档 | 位置 | 作用 / 阅读注意 |
|---|---|---|
| `HANDOFF.md` | 项目根 | 当前状态。**⚠️ 第1行"修复完成/生产化/真实数据验证"与实际代码不符，已在第2行加纠偏段，以纠偏段为准** |
| `DIAGNOSTICS.md` | 项目根 | Round 1~6 逐轮技术诊断记录。看 Round 6（Seal Access）了解协议重构细节 |
| `PRODUCT.md` | 项目根 | 产品/用户视角设计：登录触发场景、登录后能看什么/做什么、生产就绪清单 |

### C. 协议与设计文档（`agent_research_asset_protocol_workflow/docs/`）

> 这些是协议设计 canonical 文档，编号 `00`~`18`。新 agent 不必全读，按需查阅。

**接手必读**：
| 文档 | 作用 |
|---|---|
| `docs/18-research-commerce-access.md` | Seal Access 商业协议 canonical（public/encrypted/private_delegation 三类内容） |
| `docs/17-implementation-status-and-decisions.md` | 实现状态矩阵 + 关键决策 |
| `docs/07-web-product-design.md` | 前端产品设计（**注意：现状偏离此设计，前端是非生产架构，见 19 号文档诊断**） |

**按需查阅**：
| 文档 | 作用 |
|---|---|
| `docs/00-glossary.md` | 术语表 |
| `docs/01-system-architecture.md` | 系统架构 |
| `docs/04-github-zklogin-auth.md` | GitHub + zkLogin 认证设计（**故事 C 修复必读**） |
| `docs/05-walrus-development.md` | Walrus 开发（**故事 B 修复必读**） |
| `docs/06-indexer-search-graph.md` | Indexer/搜索/图谱 |
| `docs/08-tokenomics-nft.md` | Token 经济学 |
| `docs/10-sui-move-protocol.md` | Sui Move 协议 |
| `docs/11-agent-protocol-sdk.md` | Agent 协议 SDK |
| `docs/16-testnet-deployment.md` | testnet 部署（**故事 E 修复必读**） |

---

## 2. Agent 工作约束（必须遵守）

| 约束 | 来源 | 说明 |
|---|---|---|
| **所有 shell 命令前缀 `rtk`** | `~/.codex/RTK.md` | `rtk npm run build` 而非 `npm run build`。RTK 是 token 优化代理。`rtk gain` 看节省统计 |
| **shell 是 zsh，cwd 是 `/Users/echo/project/research-network`** | session env | 实际工作目录是子目录 `agent_research_asset_protocol_workflow/`（HANDOFF line 23 指明） |
| **⚠️ 当前 shell 残留 `NODE_ENV=production`** | 实测 | 跑 `npm test` 会误判 4 个 zklogin 测试失败。**用 `env -u NODE_ENV npm test` 跑才全绿**。这不是代码缺陷 |
| **项目不是 git 仓库** | 实测 | `git log` 无历史。工作区变更无法用 git 追踪，改动前自行备份。**用户 MSG #42 要求"先 commit"，但当前无 git，需先 `git init` 或确认用户的版本管理方式** |

---

## 3. 代码拓扑（接手需要知道的关键路径）

```
/Users/echo/project/research-network/              ← 项目根 (HANDOFF/DIAGNOSTICS/PRODUCT 在这)
└── agent_research_asset_protocol_workflow/        ← 实际工作目录
    ├── package.json                               scripts: build/test/web:build/move:build
    ├── move/                                      Sui Move 合约
    │   ├── Move.toml
    │   ├── sources/
    │   │   ├── report.move       ◀ 新增 (Seal Access)
    │   │   ├── access.move       ◀ 新增
    │   │   ├── delegation.move   ◀ 新增
    │   │   ├── settlement.move   ◀ 新增
    │   │   ├── agent.move / research_asset.move / revenue.move / badge.move ...
    │   └── tests/                                 20 tests 全绿
    ├── src/
    │   ├── cli.ts                                 CLI 入口
    │   ├── api/server.ts                          Express API (含 /api/github/*)
    │   └── core/
    │       ├── github.ts                          ◀ 故事C要补 listUserInstallations
    │       ├── web.ts (1733行)                    ◀ 前端字符串拼 HTML,主线II要重构
    │       ├── web-auth.ts (1028行)               ◀ 同上
    │       ├── web-workbench.ts (751行)           ◀ 同上,含假数据 hash(id)
    │       ├── indexer.ts                         已切到 report/membership 投影
    │       ├── zklogin.ts                         zkLogin (仅登录态,无交易签名)
    │       └── walrus-sites.ts
    ├── schemas/asset.schema.json                  access 字段 (seal_id/walrus_blob_id/visibility)
    ├── web/
    │   ├── dist/                                  构建产物 (当前由后端 TS 拼出来,非 Vite)
    │   ├── README.md / design-system.md
    └── docs/                                      编号文档 00~21
```

---

## 4. 验证命令速查（接手第一件事：复现"全绿"基线）

```bash
cd /Users/echo/project/research-network/agent_research_asset_protocol_workflow

# Move 层 (应全绿: 20 tests)
rtk npm run move:build
rtk sui move test --path move --silence-warnings

# TS 层 (⚠️ 必须去掉 NODE_ENV 才全绿: 55 tests)
rtk npm run build
env -u NODE_ENV rtk npm test          # ← 注意 env -u
rtk npm run web:build
```

**基线预期**：move 20/20、ts 55/55、build/web:build 通过。这只能证明"协议骨架单元测试绿"，**不能**证明"能上生产/真实数据/e2e"。

---

## 5. 当前危险信号（接手 agent 务必警惕）

| 信号 | 说明 | 出处 |
|---|---|---|
| 🔴 HANDOFF.md 第1行声明失实 | 声称"生产化/真实数据验证/多身份 Seal 访问验证"，实际 workbench 用 `hash(id)` 拼字符串、GitHub 无组织枚举、无 e2e | 已在第2行加纠偏段，以纠偏段为准 |
| 🔴 前端非生产架构 | 3606 行 TS 里大量内联 HTML/JS 字符串，零框架零构建工具，承载不了真实链上交互 | 19/20 号文档 |
| 🟡 项目非 git 仓库 | 改动无版本追踪，用户却要求 commit（MSG #42） | 实测 |
| 🟡 NODE_ENV 污染 | 当前 shell 有 `NODE_ENV=production`，直接跑 test 会假红 | 实测 |
| 🟢 协议层稳固 | Move 合约 + indexer + schema 切换已验证，是可靠地基 | move test 20/20 |

---

## 6. 接手第一步建议

按 `docs/20` 的里程碑顺序，**从 M1 开始**（风险最低、用户最痛、不依赖前端重构）：

> **M1 = 故事 C：GitHub 组织枚举**
> - 在 `src/core/github.ts` 补 `listUserInstallations` / `listInstallationRepos` / `listUserOrgs`
> - 在 `src/api/server.ts` 加 `GET /api/github/installations` 和 `/api/github/orgs`
> - 前端 `account.html` 接入，实现"组织多选 → repo 下拉"两段式 UI
> - 这是用户 session 最后一条未解决消息（MSG #50："怎么没拿到我其他组织"）

开工前需用户拍板的 5 个决策点见 `docs/20` 第五节（前端框架选型 / monorepo / Seal service / 生产存储 / 假数据 workbench 去留）。

---

## 附录：本清单引用的所有文档完整路径

**项目根** (`/Users/echo/project/research-network/`)：
- `HANDOFF.md`、`DIAGNOSTICS.md`、`PRODUCT.md`

**workflow docs** (`/Users/echo/project/research-network/agent_research_asset_protocol_workflow/docs/`)：
- `18-research-commerce-access.md`（协议 canonical）
- `19-session-019ebec9-review-and-misalignment.md`（审查报告，本次产出）
- `20-修复-plan-功能缺口与前端生产化.md`（执行 plan，本次产出）
- `21-agent-交接清单.md`（本清单，本次产出）
- `00`~`17`（历史设计文档，按需查阅）

**agent 约束** (`~/.codex/`)：
- `RTK.md`（rtk 命令约束）、`AGENTS.md`
