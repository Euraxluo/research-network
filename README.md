# Research Network Protocol Kit

Research Network is an agent-native research asset protocol: papers, skills,
workflows, code, datasets, reports, and private delegation results are authored
in Git, packaged into immutable Walrus releases, registered on Sui, indexed into
a searchable graph, and rendered as a public research product.

This repository is not only a whitepaper. It contains the runnable protocol kit:
CLI, validators, packager, local indexer, Elysia API, Vercel/Web frontend, Sui
Move contracts, testnet deployment records, and tests.

Production app:

- https://research-network-web.vercel.app

Current network status:

- Public product and protocol demos run on Sui testnet / Walrus testnet.
- Mainnet is not approved yet.
- Unknown non-API web routes intentionally return a branded 404 instead of
  proxying stale content.

## What This Repo Is

The repo is split into four layers:

1. **Protocol Kit**
   TypeScript CLI and SDK for initializing, validating, packaging, publishing,
   replaying, searching, forking, and installing research assets.

2. **Web Product**
   Public arXiv-style research index plus Account and Protocol Workbench pages.
   Account handles zkLogin and GitHub binding. Workbench is the author/agent
   console for protocol actions.

3. **Indexer / API**
   Elysia routes and replay logic that turn Sui events plus Walrus release
   manifests into searchable product data.

4. **Sui Move Protocol**
   On-chain modules for ResearchAsset, Skill, ResearchReport, Seal Access,
   membership/subscription receipts, private delegation, settlement, badges,
   reputation, and payment events.

## User-Facing Surfaces

| Surface | URL / file | Purpose |
| --- | --- | --- |
| Public index | `/`, `/search.html`, `/asset.html` | Browse and search published research assets. |
| Account | `/account.html` | Sign in with Google zkLogin, connect GitHub, view account-linked assets and repo scopes. |
| Protocol Workbench | `/workbench.html` | Author/agent console for publishing, Walrus/Sui/Seal actions, receipts, delegation, and protocol testing. Not a normal reader homepage. |
| Dashboard | `/dashboard.html` | Public protocol/index status view. |
| Debug | `/debug.html` | Engineering-only session/export and backend debugging surface. |
| API | `/api/*` | Elysia/Vercel Functions for index, auth, GitHub binding, Walrus proxy, zkLogin salt/proof. |

## How The Pieces Fit

```text
Git research repo
  -> asset.yaml / paper / skill / workflow / code
  -> research validate
  -> research package
  -> Walrus release snapshot
  -> Sui object + events
  -> Indexer reads Sui events + Walrus manifest
  -> Web/API render public assets, papers, skills, graph, account matches
```

For encrypted and private work:

```text
Author/agent in Account + Workbench
  -> zkLogin signer
  -> Walrus encrypted blob
  -> Sui ResearchReport / AccessReceipt / DelegationJob
  -> Seal decides who can decrypt
  -> Indexer exposes public metadata, never private plaintext
```

## Quick Start

Requires Node.js 20+.

```bash
npm install
npm run build
npm test
npm run validate:template
```

Run a local demo publish/replay/build:

```bash
npm run demo
```

The demo writes local protocol state under:

```text
.research-network/localnet/
```

Useful generated artifacts include:

```text
.research-network/localnet/events.ndjson
.research-network/localnet/walrus/<blob>/manifest.json
.research-network/localnet/index.json
web/dist/index.html
web/dist/search.html
```

## Common Commands

Create and validate a research asset workspace:

```bash
npx tsx src/cli.ts init ./my-asset --title "My Research Asset" --author "Research Agent" --agent-id agent:local
npx tsx src/cli.ts validate ./my-asset
npx tsx src/cli.ts package ./my-asset
```

Publish into the local protocol simulation and rebuild the index:

```bash
npx tsx src/cli.ts publish ./my-asset
npx tsx src/cli.ts replay
npx tsx src/cli.ts search "routing" --type asset
npx tsx src/cli.ts graph <asset-id>
```

Run the local API:

```bash
npm run serve
```

Build and serve the static web output:

```bash
npx tsx src/cli.ts web:build
npx tsx src/cli.ts web:serve --dir web/dist --port 4173
```

The preview server is not a generic static server: it also mounts the live
`/api/index` routes used by the public pages. Do not use `python -m http.server`
or `npx http-server` for UI acceptance, because those servers return 404 for
`/api/index` and make the live index look empty.

Run the Vite product app:

```bash
npm run web:dev
```

Build the Vercel production shell locally:

```bash
npm run vercel:shell
npm run web:vite:build
npm run vercel:shell:serve
```

## Project Structure

| Path | What lives here |
| --- | --- |
| `src/cli.ts` | Main `research` CLI entrypoint. |
| `src/core/` | Protocol implementation: validators, packager, local store, adapters, indexer, web generator, Sui/Walrus/GitHub/auth helpers. |
| `src/api/` | Elysia API implementation used by local server and Vercel functions. |
| `api/` | Vercel Functions entrypoints: index API, GitHub OAuth/binding, Walrus proxy, zkLogin salt/proof, branded 404. |
| `web/` | React + Vite multi-page product app: Account, Workbench, Debug. |
| `move/` | Sui Move protocol modules and tests. |
| `indexer/` | Indexer design notes and SQL schema. Runnable logic is in `src/core/indexer.ts` and `src/core/live-index*.ts`. |
| `schemas/` | JSON Schemas for asset, skill, and workflow validation. |
| `templates/research-asset-template/` | Canonical starter repo for a Research Asset. |
| `fixtures/public-showcase/` | Demo/showcase workspaces and local/testnet replay materials used for tests and public rendering. Not a hand-edited product database. |
| `scripts/` | Production acceptance, mainnet readiness, showcase build, and testnet helper scripts. |
| `tests/` | Vitest coverage for CLI, web, indexer, GitHub, zkLogin, production guards, and protocol flows. |
| `docs/` | Architecture, product decisions, deployment history, readiness gates, and protocol design notes. |
| `infra/` | Environment variable examples and Docker compose support. |
| `workflows/` | Agent workflow definitions for publishing research assets. |
| `skills/` | Agent skills used by this protocol and demo assets. |

Generated or local-only directories:

| Path | Meaning |
| --- | --- |
| `.research-network/` | Local protocol state, secrets, acceptance receipts, generated demo workspaces. Do not commit secrets. |
| `.vercel-shell/` | Local Vercel static output generated by `npm run vercel:shell` and `npm run web:vite:build`. |
| `dist/` | TypeScript build output. Rebuild with `npm run build`. |
| `node_modules/` | Installed dependencies. |

## Core Concepts

### Research Asset

The unified unit of publication. A Research Asset can contain a paper, skill,
workflow, dataset, experiment, benchmark, code, review, or a combination of
them. Every real asset should be backed by `asset.yaml`, content files, hashes,
Git provenance, Walrus release data, and Sui/indexer metadata.

### Skill

A reusable agent capability package. It can be published with a paper or as its
own asset. Skills are parsed, indexed, rendered, forked, and installed as first
class protocol objects.

### Release Manifest

The immutable package emitted by `research package`. It describes the Git
commit, files, content hashes, paper/skill/workflow relationships, and manifest
hash that are later stored through Walrus and registered on Sui.

### Seal Access

The current access model. Public metadata can be indexed; encrypted/private
content is stored as ciphertext on Walrus, while Seal policies and Sui receipts
decide who can decrypt.

## Web Product Architecture

The Vercel production build has two steps:

```bash
npm run vercel:shell && npm run web:vite:build
```

- `vercel:shell` emits public static shell assets, auth callback assets, and
  `zklogin-browser.js`.
- `web:vite:build` emits the current React pages:
  `account.html`, `workbench.html`, and `debug.html`.
- `vercel.json` routes `/` to `index.html`, keeps `/api/*` as functions, and
  sends unknown non-API paths to the branded 404 function.

This means `/login.html` is not a product page. Sign-in is inside Account.

## Protocol Workbench

`/workbench.html` is the author/agent protocol console. It is for actions that
modify or test protocol state:

- publish public or encrypted reports;
- upload/read Walrus blobs;
- sign Sui transactions with the zkLogin browser signer;
- create membership/subscription receipts;
- create, fund, submit, complete, refund, or dispute private delegation jobs;
- inspect GitHub repo scope and selected publishing repo;
- debug the end-to-end Walrus + Sui + Seal path.

It should be linked as a creator/developer action surface, not presented as the
main reader experience.

## Sui Move Protocol

Move modules live in `move/sources/`:

```text
research_asset, skill, report, access, delegation, settlement,
revenue, agent, reputation, badge, payment
```

Current testnet Seal Access package:

```text
0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e
```

More deployment details are in `move/README.md` and
`docs/16-testnet-deployment.md`.

Build Move contracts:

```bash
npm run move:build
```

Run Move tests when Sui CLI is installed:

```bash
sui move test --path move --silence-warnings
```

## API And Indexer

Local API:

```bash
npm run serve
```

Important API files:

- `src/api/index-service.ts` - Elysia live index routes and Swagger support.
- `src/api/server.ts` - local server wrapper.
- `api/index.ts` and `api/index/[...path].ts` - Vercel catch-all entrypoints.
- `api/openapi.yaml` - protocol API reference.

Indexer implementation:

- `src/core/indexer.ts` replays protocol events into local projections.
- `src/core/sui-events.ts` polls Sui RPC events.
- `src/core/live-index.ts` and `src/core/live-index-db.ts` build live web/API
  projections backed by Vercel Postgres when configured.

## Recommended Reading

Read these first if you are implementing or reviewing changes:

1. `docs/17-implementation-status-and-decisions.md` - current truth, status,
   and rules when older docs conflict.
2. `docs/00-glossary.md` - protocol terms.
3. `docs/01-system-architecture.md` - system architecture.
4. `docs/02-research-asset-repo-standard.md` - Git repo standard.
5. `docs/03-publish-pipeline.md` - GitHub -> Walrus -> Sui -> Indexer -> Web.
6. `web/README.md` - frontend architecture and production acceptance notes.
7. `move/README.md` - Move modules and testnet deployment details.

## Trust Boundaries

- Git is the authoring workspace.
- Walrus is the immutable release snapshot layer.
- Sui is the asset registry, receipt, settlement, and event source.
- Indexer/API is the product projection from chain events plus Walrus manifests.
- The web app must not invent fake chain data.
- Mainnet is blocked until the documented readiness gates pass.
- Do not commit private keys, zkLogin session files, `.env`, or acceptance
  secrets.

## Verification Checklist

Before pushing meaningful protocol changes:

```bash
npm run build
npm test
```

For web/Vercel changes:

```bash
npm run vercel:shell
npm run web:vite:build
```

For Move changes:

```bash
npm run move:build
sui move test --path move --silence-warnings
```

For mainnet readiness work, start from:

```bash
npm run readiness:mainnet -- --stage mainnet-config --skip-chain
```

In this Codex environment, shell commands are normally run with the `rtk` prefix
because the workspace AGENTS instructions require it.
