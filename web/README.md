# Web App Plan

前端建议使用 Next.js 或 Vite。若使用 Next.js，需要支持 static export，以便通过 Walrus Sites 发布。

## Routes

- `/`
- `/search`
- `/abs/[assetId]`
- `/skill/[skillId]`
- `/workflow/[workflowId]`
- `/agent/[agentId]`
- `/graph/[assetId]`
- `/publish`
- `/dashboard`
- `/licenses`
- `/token`
- `/governance`

## Components

- AssetHeader
- VerificationPanel
- WalrusSnapshotCard
- SuiObjectCard
- SkillInstallCard
- ForkResearchButton
- CitationBox
- ResearchGraph
- LicensePurchaseModal
- zkLoginButton
- GitHubRepoSelector
- PublishStepper

## Local static site implementation

The current static site generator is `src/core/web.ts`.

```bash
npx tsx src/cli.ts publish ./workspace
npx tsx src/cli.ts web:build
```

Output:

```text
web/dist/
├── index.html
├── search.html
├── dashboard.html
├── licenses.html
├── abs/<asset-id>.html
├── skill/<skill-id>.html
└── graph/<asset-id>.html
```

Pages render the verifiable fields required by the protocol plan: content hash, Walrus blob id, Sui object id, repo commit, manifest hash, and license data.

If this is later migrated to Next.js or Vite, `web:build` should continue producing static output for Walrus Sites.

## Testnet Site

The generated static site has been published to Walrus Sites testnet:

- Site object: `0x2cd9764af24dde6e202bf8454ca11f312e0b21312867422fd685955f39a7f12a`
- Portal base36 host: `148p7vy4nrikdcc8rgk5fqot9lvy9m7y37ut3hp1ksp94zsvfu`
- Browse URL (with portal on port **3010**): `http://148p7vy4nrikdcc8rgk5fqot9lvy9m7y37ut3hp1ksp94zsvfu.localhost:3010/`

Start the official testnet portal locally:

```bash
npm run web:portal
```

> **Note:** Port 3000 on this machine may be used by another app (not Walrus Portal). Use **3010** or stop the conflicting process before using `:3000`.

Walrus testnet sites require a self-hosted portal; `wal.app` only serves mainnet sites.
