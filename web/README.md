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

Export the two session files from `/account.html` after completing Google zkLogin in the same
browser tab. Use **Export buyer session** for the funded buyer account, then sign out/sign in with
the agent account and use **Export agent session**. Move the downloaded files to
`.research-network/secrets/acceptance-buyer.json` and
`.research-network/secrets/acceptance-agent.json`; they contain ephemeral zkLogin material and must
never be committed.

```bash
npm run acceptance:production -- --network testnet
ZKLOGIN_PROVER_URL=https://<prover> npm run acceptance:production -- --network testnet --preflight \
  --buyer-session .research-network/secrets/acceptance-buyer.json \
  --agent-session .research-network/secrets/acceptance-agent.json
ZKLOGIN_PROVER_URL=https://<prover> npm run acceptance:production -- --network testnet --execute \
  --buyer-session .research-network/secrets/acceptance-buyer.json \
  --agent-session .research-network/secrets/acceptance-agent.json \
  --max-spend-mist 110000000
```

Without `--receipt`, acceptance writes mode-specific receipts:
`.research-network/acceptance/testnet-dry-run.json`,
`.research-network/acceptance/testnet-preflight.json`, and
`.research-network/acceptance/testnet-execute.json`.

Only after that receipt passes should production config be switched to mainnet object ids/RPC/Walrus/Seal endpoints and re-run with a small mainnet cap. The acceptance guard rejects known testnet ids/endpoints when `--network mainnet`.

Use the readiness gate before approving mainnet config:

```bash
npm run readiness:mainnet -- --stage mainnet-config \
  --testnet-preflight-receipt .research-network/acceptance/testnet-preflight.json \
  --testnet-execute-receipt .research-network/acceptance/testnet-execute.json \
  --skip-chain
```

Before injecting mainnet funds, run final readiness with mainnet preflight/execute receipts and live chain checks:

```bash
npm run readiness:mainnet -- --stage mainnet-final \
  --testnet-preflight-receipt .research-network/acceptance/testnet-preflight.json \
  --testnet-execute-receipt .research-network/acceptance/testnet-execute.json \
  --mainnet-preflight-receipt .research-network/acceptance/mainnet-preflight.json \
  --mainnet-execute-receipt .research-network/acceptance/mainnet-execute.json \
  --mainnet-receipt-max-age-ms 86400000
```

`ready: true` means the required receipts and production config evidence are present for the requested stage. A missing receipt, dry-run receipt, missing or inverted receipt timestamps, mismatched preflight/execute receipt config, stale or future-dated final mainnet receipt, known testnet id/endpoint in mainnet evidence, missing prover/mainnet env, mismatch between acceptance/Web/Vercel/Auth mainnet values, stale mainnet receipt config, or over-large mainnet acceptance spend cap keeps the report red. Without `--skip-chain`, the gate also checks configured mainnet package/shared objects via RPC and validates that protocol shared objects are typed under the configured `RN_PACKAGE_ID`; Seal key server objects are checked by key-server type. `mainnet-final` always requires live chain checks and fresh mainnet preflight/execute receipts. It verifies testnet execute receipt transactions with `RN_TESTNET_SUI_RPC_URL` (or the receipt RPC) and verifies mainnet execute receipt transactions with `RN_SUI_RPC_URL`; each receipt transaction must exist on chain, have successful effects, emit the expected events, create the object ids claimed by the receipt, and have a chain timestamp inside the execute receipt window. `--skip-chain` is only accepted for earlier config/preflight review. The default final receipt freshness window is 24 hours and can be changed with `RN_MAINNET_RECEIPT_MAX_AGE_MS` or `--mainnet-receipt-max-age-ms`.
Preflight receipts also record non-sensitive prover evidence (`configured: true` and a SHA-256 URL fingerprint) and buyer/agent balance evidence so readiness can verify a real prover was configured and both zkLogin accounts covered their required minimums without storing the prover endpoint or proof material.

Production config guards:

- Vite/Web: set `VITE_RN_NETWORK`, `VITE_RN_SUI_RPC_URL`, `VITE_RN_PACKAGE_ID`, `VITE_RN_SETTLEMENT_CONFIG_ID`, `VITE_RN_AGENT_EARNINGS_ID`, `VITE_RN_MEMBERSHIP_RECEIPT_REGISTRY_ID`, `VITE_RN_WALRUS_PUBLISHER_URL`, `VITE_RN_WALRUS_AGGREGATOR_URL`, `VITE_RN_SEAL_KEY_SERVER_OBJECT_ID`, and `VITE_RN_SEAL_KEY_SERVER_AGGREGATOR_URL` for production builds, or inject the same values through `window.__RN_M3_CONFIG__`.
- Vercel Walrus proxy: set `RN_WEB_NETWORK=mainnet` or `WALRUS_NETWORK=mainnet` together with `WALRUS_SITE_OBJECT_ID`, `WALRUS_SUI_RPC_URL`/`SUI_RPC_URL`, and `WALRUS_AGGREGATOR_URL`.
- Auth shell: set `AUTH_SUI_RPC_URL` when `RN_WEB_NETWORK=mainnet` or `AUTH_NETWORK=mainnet` so zkLogin uses the mainnet epoch source.
- All three paths reject known testnet defaults when the declared network is `mainnet`.
- `infra/env.example` lists the full `RN_*`, `VITE_RN_*`, Walrus proxy, auth, prover, and receipt-path variable set for production acceptance.
