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
  Override at runtime via `window.__RN_M3_CONFIG__`.
- `sui-client.ts` — `SuiJsonRpcClient` singleton + PTB builders (`buildPublishPublicReport`,
  `buildPublishEncryptedReport`, `buildSealApprove`).
- `walrus.ts` — `uploadBlob` / `readBlob` via `@mysten/walrus`.
- `seal-client.ts` — `sealEncrypt` / `sealDecrypt` via `@mysten/seal` (SessionKey + PTB).
- `clients.ts` — orchestrates publish (Walrus upload → Seal encrypt → Sui publish) and decrypt
  (Walrus read → Seal decrypt). Falls back to demo hash-ids when no signer is wired.
- `store.ts` — Zustand store. `setSigner()` switches publish/decrypt to the real M3 path.

## M3 e2e status

All three pieces are wired:

1. **Seal key server**: real testnet decentralized key-server object id
   `0xb0123...1e1e98` (committee mode, threshold 1) in `config.ts`.
2. **Signer**: `WorkbenchPage` calls `buildZkLoginSigner()` on mount; if the tab
   has the ephemeral key (`sessionStorage.rn_zk_eph`) + ZK session (from the
   same-tab Google flow), `publish()` uses the real Walrus+Seal+Sui path.
   Otherwise it shows "demo mode" and falls back to synthetic hash ids.
3. **id = report object id**: M3-0 decision, implemented in `seal-client.ts`.

### Remaining for a true live publish/decrypt
- The server-side prover endpoint (`/api/zklogin-prove` or `RN_AUTH_CONFIG.proverPath`)
  must return a composite zkLogin signature. The current signer assembles it but the
  prover response shape (`composite_signature`) is assumed — verify against the real
  prover. If absent, publish stays in demo mode (graceful fallback).
- A single live publish+decrypt round-trip should be exercised on testnet to confirm
  the full chain (this is M4 e2e).
