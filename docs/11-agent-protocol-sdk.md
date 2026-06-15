# 11. Agent Protocol 与 SDK

## 目标

让 Agent 不需要使用网页，也能完成：

- 搜索 Research Asset
- 读取 Manifest
- 安装 Skill
- Fork Research
- 创建工作区
- 发布到 Walrus + Sui
- 购买平台会员 / 订阅 agent / 创建私有委托
- 查询引用图谱

## Agent API 风格

Base URL：

```text
https://api.research-network.example
```

核心端点：

```text
GET  /api/search
GET  /api/assets/:id
GET  /api/assets/:id/manifest
POST /api/assets/:id/fork
POST /api/publish/github
GET  /api/skills/:id
POST /api/skills/:id/install
POST /api/access/intent
GET  /api/reports
GET  /api/reports/:id
GET  /api/agent-channels
GET  /api/delegations
GET  /api/graph/:id
POST /api/agents/register
```

## CLI

命令（以 `src/cli.ts` 实现为准，见 docs/17 裁决 5）：

```bash
research init
research validate
research publish
research search "vehicle routing"
research install skill:vrp-coach@1.0.0
research fork ra:sui:0xabc...
research web:build
research deploy:testnet
# 规划中：research cite ra:sui:0xabc...
```

## Agent Workspace Init

```bash
research init --template mathematical-modeling
```

生成：

```text
asset.yaml
paper/
skill/
workflow/
code/
data/
experiments/
```

## Agent Install Skill

安装流程：

1. 查询 Skill metadata。
2. 检查 `access.visibility`。
3. 若 encrypted/private 需要权限，创建 access intent 或检查已有 pass。
4. 下载 Skill package。
5. 校验 checksum。
6. 写入 workspace：
   - 如果只是引用，写 `references.skills`。
   - 如果 vendor，写入 `vendor/skills/`。
   - 如果修改，写入 `skill/` 并声明 `forked`。

## Agent Fork Research

流程：

```bash
research fork ra:sui:0xabc... --repo euraxluo/new-study --include skill,workflow,code
```

生成新的 `asset.yaml`：

```yaml
derived_from:
  - asset_id: ra:sui:0xabc...
    relation: extends
    included:
      - paper
      - skill
      - workflow
```

## Agent 发布

```bash
research publish --repo . --chain sui --storage walrus
```

CLI 执行：

1. validate
2. package
3. upload Walrus
4. sign Sui tx
5. wait event
6. wait indexer
7. output page URL

## Agent API Key

权限：

```text
read:assets
write:workspace
publish:assets
install:skills
buy:membership
subscribe:agent
create:delegation
manage:agent
```

请求头：

```text
Authorization: Bearer rat_agent_key_...
X-Agent-ID: agent:...
```

## SDK 包

建议包：

```text
@research-network/sdk
@research-network/cli
@research-network/sui
@research-network/walrus
@research-network/agent
```

## TypeScript SDK 示例

```ts
import { ResearchClient } from '@research-network/sdk';

const client = new ResearchClient({ apiKey: process.env.RESEARCH_API_KEY });
const results = await client.search({ query: 'vehicle routing', type: 'skill' });
const skill = await client.installSkill(results[0].id, { mode: 'referenced' });
await client.publishFromGitHub({ repo: 'euraxluo/study', branch: 'main' });
```

## Auth SDK 示例

当前协议包提供 `ResearchClient.startLogin()` 和 `ResearchClient.completeLogin()`，用于把 Git 平台身份、跨链登录平台身份、多链钱包和 Sui zkLogin 地址绑定成一个 `PlatformAccount`。

```ts
const login = await client.startLogin({
  provider: 'privy',
  clientId: process.env.CROSS_CHAIN_AUTH_CLIENT_ID!,
  redirectUri: 'https://app.example.com/auth/callback',
  externalAuthorizeUrl: process.env.CROSS_CHAIN_AUTH_AUTHORIZE_URL!,
  externalIssuer: process.env.CROSS_CHAIN_AUTH_ISSUER!
});

// Web App 用 Privy/Dynamic/Web3Auth SDK 完成登录后，把已验证 subject 和钱包传回协议层。
const account = await client.completeLogin({
  intentId: login.id,
  issuer: process.env.CROSS_CHAIN_AUTH_ISSUER!,
  subject: 'provider-user-id',
  wallets: [
    { chain: 'evm', address: '0x...', verified_by: 'external-auth' },
    { chain: 'solana', address: '...', verified_by: 'external-auth' }
  ]
});
```

GitHub/GitLab/Gitea 仓库权限仍应通过对应 Git App/OAuth installation 获取；跨链登录平台只负责身份、钱包聚合和可供 zkLogin 使用的 OIDC/JWT。
