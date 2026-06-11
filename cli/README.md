# research-cli

CLI 用于 Agent 和开发者操作 Research Asset。

## Commands

```bash
research init
research validate
research package
research publish
research search
research install
research fork
research cite
research site publish
research login github
research login zklogin
research auth:start
research auth:complete
research wallet bind
```

## publish command

```bash
research publish --repo . --storage walrus --chain sui
```

执行：

1. validate
2. package
3. upload to Walrus
4. register on Sui
5. wait indexer
6. print URL

## Current implementation

The runnable local CLI entrypoint is `src/cli.ts`.

```bash
npx tsx src/cli.ts init ./workspace --title "Routing Study" --author "Agent" --agent-id agent:routing
npx tsx src/cli.ts validate ./workspace
npx tsx src/cli.ts package ./workspace
npx tsx src/cli.ts publish ./workspace
npx tsx src/cli.ts replay
npx tsx src/cli.ts search "routing" --type asset
npx tsx src/cli.ts graph ra:local:...
npx tsx src/cli.ts fork ra:local:... ./forked-workspace
npx tsx src/cli.ts install skill:example-skill@0.1.0 ./forked-workspace --mode referenced
npx tsx src/cli.ts auth:start --provider github --client-id "$GITHUB_CLIENT_ID" --redirect-uri http://127.0.0.1:8787/api/auth/callback
npx tsx src/cli.ts auth:start --provider privy --client-id "$CROSS_CHAIN_AUTH_CLIENT_ID" --redirect-uri http://127.0.0.1:8787/api/auth/callback --external-authorize-url "$CROSS_CHAIN_AUTH_AUTHORIZE_URL" --external-issuer "$CROSS_CHAIN_AUTH_ISSUER"
npx tsx src/cli.ts auth:complete --intent auth:... --issuer https://github.com --subject 12345 --git-provider github --git-user-id 12345 --git-username octo
npx tsx src/cli.ts agent:register --name "Codex Research Agent"
npx tsx src/cli.ts license:intent skill:example-skill@0.1.0 --buyer 0xabc
npx tsx src/cli.ts web:build
npx tsx src/cli.ts serve --port 8787
npx tsx src/cli.ts deploy:testnet ./workspace --epochs 1
```

- `validate` uses `schemas/*.schema.json` plus protocol quality gates.
- `package` emits release manifest, checksums, and `release.tar.zst`.
- `publish` writes local Walrus/Sui adapter events.
- `auth:start/auth:complete` bind Git platform identity, cross-chain auth provider identity, wallets, and a Sui zkLogin address.
- `replay/search/graph` read the Indexer projection.
- `fork/install` update the target workspace manifest.
- `deploy:testnet` stores the release archive on Walrus testnet, publishes the Move package on Sui testnet, calls `research_asset::publish_research_asset`, and writes `.research-network/deployments/testnet.json`.
