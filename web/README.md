# Research Network — Web (M2 + M3)

React 18 + Vite 8 + TypeScript frontend, an npm workspace of the root package.

## Scripts (run from repo root)

- `npm run web:dev` — Vite dev server (HMR) on :5173, proxies `/api` + `/auth` + `/zklogin-browser.js` to the production host.
- `npm run web:vite:build` — build to `../.vercel-shell/` (co-exists with `vercel:shell` auth assets).
- `npm run web:build` — the legacy full static site generator (content pages), unrelated to this app.

## Architecture

Multi-page Vite build (not SPA): `login.html`, `account.html`, `workbench.html` are three
entry points. Vite output lands in `.vercel-shell/` which Vercel serves as static
root; `auth/*` + `zklogin-browser.js` are emitted separately by `buildVercelAuthShell`.

`vercel.json` buildCommand = `npm run vercel:shell && npm run web:vite:build`.

## M3 client layer (`src/lib/`)

- `config.ts` — on-chain + storage config (packageId, shared object ids, Walrus/Seal endpoints).
  Override at build time with `VITE_RN_*` or at runtime via `window.__RN_M3_CONFIG__`.
- `sui-client.ts` — `SuiJsonRpcClient` singleton + PTB builders (`buildPublishPublicReport`,
  `buildPublishEncryptedReport`, `buildSealApprove`).
- `walrus.ts` — `uploadBlob` / `readBlob` via `@mysten/walrus`.
- `seal-client.ts` — `sealEncrypt` / `sealDecrypt` via `@mysten/seal` (SessionKey + PTB).
- `clients.ts` — orchestrates publish (Walrus upload → Seal encrypt → Sui publish) and decrypt
  (Walrus read → Seal decrypt → optional Sui access receipt). Falls back to demo hash-ids when no signer is wired.
- `store.ts` — Zustand store. `setSigner()` switches publish/decrypt to the real M3 path.

## M3 e2e status

All three pieces are wired:

1. **Seal key server**: real testnet decentralized key-server object id
   `0xb0123...1e1e98` (committee mode, threshold 1) in `config.ts`.
2. **Signer**: `WorkbenchPage` calls `buildZkLoginSigner()` on mount; if the tab
   has the ephemeral key (`sessionStorage.rn_zk_eph`) + ZK session (from the
   same-tab Google flow), `publish()` uses the real Walrus+Seal+Sui path.
   Otherwise it shows "demo mode" and falls back to synthetic hash ids.
3. **id = publisher-chosen seal_id**: M4-2 decision. The client chooses stable 32 bytes before publish, Seal encrypts under that id, and `report.move` stores the same `seal_id`. `access.move` asserts `id == report::seal_id(report)`.

## Production acceptance status

The Web client now has real wrappers for encrypted publish/decrypt, platform membership,
agent subscription, private delegation, receipt settlement, and agent earnings claim. The
zkLogin signer builds composite signatures for both transaction bytes and Seal personal
messages.

Mainnet is not approved yet. The current default testnet config points at the latest Seal Access
package `0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e`, which includes
`settled_receipts` replay protection and has passed a real Walrus + Seal + Sui author decrypt
round-trip. The next gate is two-account zkLogin preflight, then capped acceptance:

```bash
npm run acceptance:production -- --network testnet --receipt .research-network/acceptance/dry-run.json
ZKLOGIN_PROVER_URL=https://<prover> npm run acceptance:production -- --network testnet --preflight \
  --buyer-session .research-network/secrets/acceptance-buyer.json \
  --agent-session .research-network/secrets/acceptance-agent.json \
  --receipt .research-network/acceptance/testnet-preflight.json
ZKLOGIN_PROVER_URL=https://<prover> npm run acceptance:production -- --network testnet --execute \
  --buyer-session .research-network/secrets/acceptance-buyer.json \
  --agent-session .research-network/secrets/acceptance-agent.json \
  --max-spend-mist 110000000 \
  --receipt .research-network/acceptance/testnet-production.json
```

Only after that receipt passes should production config be switched to mainnet object ids/RPC/Walrus/Seal endpoints and re-run with a smaller mainnet cap. The acceptance guard rejects known testnet ids/endpoints when `--network mainnet`.

Use the readiness gate before approving real funds:

```bash
npm run readiness:mainnet -- --stage mainnet-config \
  --testnet-preflight-receipt .research-network/acceptance/testnet-preflight.json \
  --testnet-execute-receipt .research-network/acceptance/testnet-production.json \
  --skip-chain
```

`ready: true` means the required receipts and production config evidence are present for the requested stage. A missing receipt, dry-run receipt, testnet-looking mainnet endpoint, or missing prover/mainnet env keeps the report red.

Production config guards:

- Vite/Web: set `VITE_RN_NETWORK`, `VITE_RN_SUI_RPC_URL`, `VITE_RN_PACKAGE_ID`, `VITE_RN_SETTLEMENT_CONFIG_ID`, `VITE_RN_AGENT_EARNINGS_ID`, `VITE_RN_MEMBERSHIP_RECEIPT_REGISTRY_ID`, `VITE_RN_WALRUS_PUBLISHER_URL`, `VITE_RN_WALRUS_AGGREGATOR_URL`, `VITE_RN_SEAL_KEY_SERVER_OBJECT_ID`, and `VITE_RN_SEAL_KEY_SERVER_AGGREGATOR_URL` for production builds, or inject the same values through `window.__RN_M3_CONFIG__`.
- Vercel Walrus proxy: set `RN_WEB_NETWORK=mainnet` or `WALRUS_NETWORK=mainnet` together with `WALRUS_SITE_OBJECT_ID`, `WALRUS_SUI_RPC_URL`/`SUI_RPC_URL`, and `WALRUS_AGGREGATOR_URL`.
- Auth shell: set `AUTH_SUI_RPC_URL` when `RN_WEB_NETWORK=mainnet` or `AUTH_NETWORK=mainnet` so zkLogin uses the mainnet epoch source.
- All three paths reject known testnet defaults when the declared network is `mainnet`.
