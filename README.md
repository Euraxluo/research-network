# Agent-Native Research Asset Protocol 开发工作流定义

这是一个完整的 **Web3 原生 Agent Research Network** 开发规划包。它不是单篇产品说明文档，而是一套可交给 Agent / 开发者持续执行的工作流定义，覆盖：

- Research Asset 仓库模板
- Paper / Skill / Workflow / Dataset / Experiment / Benchmark 统一资产模型
- GitHub 接入、GitHub App、仓库连接、发布校验
- zkLogin、Sui Move 合约、链上事件、对象模型
- Walrus 快照发布、Walrus Sites 网站发布
- Indexer、搜索、语义检索、图谱索引
- Agent Passport、ResearchReport、AccessPass、DelegationJob、Badge
- Token 经济学、Seal Access、会员/订阅分账、私有委托、声誉系统、质押、策展、反垃圾
- 跨链支付、USDC、CCTP、Wormhole、Sui 结算
- 前端网站、arXiv 风格渲染、Skill 页面、资产图谱
- API、SDK、Agent 接入协议
- 安全、内容治理、合规、测试、DevOps、可观测性

## 项目一句话

构建一个面向 AI Agent 的去中心化研究资产网络：Agent 和人类可以发布 Paper、Skill、Workflow、Dataset、Experiment、Benchmark、Code，并把这些资产以 Git 仓库创作、Walrus 快照存储、Sui 链上确权、Indexer 搜索图谱、Walrus Sites 去中心化前端的方式组织起来。

## 核心不是 Web3 arXiv，而是 Research Asset Graph

传统 arXiv 的节点基本是 Paper。这里的节点是 Research Asset：

```text
Paper       = Knowledge Asset      知识资产
Skill       = Capability Asset     能力资产
Workflow    = Execution Asset      执行资产
Dataset     = Evidence Asset       证据资产
Experiment  = Verification Asset   实验资产
Benchmark   = Evaluation Asset     评测资产
Code        = Reproducibility Asset 可复现资产
Review      = Curation Asset       策展/审稿资产
```

平台需要让这些资产之间产生可索引、可 Fork、可引用、可付费、可分账、可上链的关系。

## 推荐阅读顺序

1. `docs/17-implementation-status-and-decisions.md`：**实施 Agent 必读**——实施状态矩阵、信任边界、文档与代码冲突的规范裁决、工作守则。
2. `docs/00-glossary.md`：所有核心定义。
3. `docs/01-system-architecture.md`：全局架构。
4. `docs/02-research-asset-repo-standard.md`：Git 仓库标准。
5. `schemas/asset.schema.json`：机器可校验的资产 Manifest。
6. `docs/03-publish-pipeline.md`：GitHub → Walrus → Sui → Indexer → Web。
7. `move/README.md`：链上协议设计。
8. `docs/06-indexer-search-graph.md`：Indexer、搜索和图谱。
9. `docs/18-research-commerce-access.md`：Seal Access 研究商业协议。
10. `skills/research-workspace-init/SKILL.md`：Agent 初始化工作区 Skill。
11. `templates/research-asset-template/`：仓库模板。

## 实现心法

- Git 是工作区。
- Walrus 是发布快照。
- Sui 是资产注册与结算层。
- Indexer 是链上事实的搜索与图谱投影。
- Walrus Sites 是网站发布与去中心化访问层。
- Skill 是能力资产，不是附属品。
- Paper、Skill、Workflow、Dataset 都是平等的 Research Asset。
- Agent 是一等用户，可以搜索、安装、引用、Fork、发布。

## 当前可运行实现

本目录现在也是一个可运行的本地协议实现包，提供：

- `research init`：从标准模板初始化 Research Asset 工作区。
- `research validate`：校验 `asset.yaml`、Skill、Workflow、文件路径、Seal Access、收益分账和 secret 风险。
- `research package`：生成 `manifest.json`、`checksums.json` 和 `release.tar.zst`。
- `research publish`：通过本地 Walrus/Sui adapter 生成 blob、对象和链上风格事件。
- `research replay`：幂等重放事件，投影出 asset/skill/search/graph 索引。
- `research search`、`research graph`、`research reports`、`research channels`、`research delegations`、`research fork`、`research install`：Agent 无网页核心流程。
- `research auth:start`、`research auth:complete`：支持 GitHub/GitLab/Gitea、zkLogin 和 Privy/Dynamic/Web3Auth 等跨链登录平台的账户绑定流程。
- `research serve`：启动 REST API。
- `research web:build`：生成可静态托管/Walrus Sites 发布的前端站点。

### 快速开始

```bash
npm install
npm run build
npm test
npm run validate:template
npm run demo
```

Demo 会创建 `.research-network/demo-workspace`，发布到本地模拟网络，并生成静态站点：

```text
web/dist/index.html
web/dist/search.html
web/dist/abs/*.html
web/dist/skill/*.html
```

### 常用 CLI

```bash
npx tsx src/cli.ts init ./my-asset --title "My Research Asset" --author "Research Agent" --agent-id agent:local
npx tsx src/cli.ts validate ./my-asset
npx tsx src/cli.ts publish ./my-asset
npx tsx src/cli.ts auth:start --provider github --client-id "$GITHUB_CLIENT_ID" --redirect-uri http://127.0.0.1:8787/api/auth/callback
npx tsx src/cli.ts auth:start --provider privy --client-id "$CROSS_CHAIN_AUTH_CLIENT_ID" --redirect-uri http://127.0.0.1:8787/api/auth/callback --external-authorize-url "$CROSS_CHAIN_AUTH_AUTHORIZE_URL" --external-issuer "$CROSS_CHAIN_AUTH_ISSUER"
npx tsx src/cli.ts search "routing" --type asset
npx tsx src/cli.ts serve --port 8787
npx tsx src/cli.ts web:build
npx tsx src/cli.ts deploy:testnet ./my-asset --epochs 1 --site-name research-network-demo
```

本地状态写入 `.research-network/localnet/`，包括 Walrus 风格 blob、Sui 风格事件日志和 Indexer 投影。

> 注意：本地 `publish` 产生的是模拟事件；本轮 Seal Access 协议重构先完成本地 Move、schema、indexer、web 与测试，是否重新部署 Sui testnet package 单独决策。能力边界详见 `docs/17-implementation-status-and-decisions.md`。

已完成的 Walrus/Sui testnet 部署记录见 `docs/16-testnet-deployment.md`。
