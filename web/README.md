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

## Before M3 publish/decrypt works end-to-end

1. **Seal key servers**: fill real object ids + `aggregatorUrl` in `config.ts`
   `sealKeyServers` (currently placeholders). Get them from the Seal testnet config.
2. **Signer wiring**: `LoginPage` must call `useWorkbench.getState().setSigner(...)` with a
   real `M3Signer` (zkLogin ephemeral keypair + `signAndExecuteTransaction` + `signPersonalMessage`).
   Currently `signer` is null → publish uses demo ids.
3. **id = report object id**: the M3-0 decision. `seal_approve_*` asserts
   `id == object::id_to_bytes(&report)`. This is implemented in `seal-client.ts`.
