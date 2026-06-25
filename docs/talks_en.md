# Research Network x Walrus Talk and Review Memo

Last updated: 2026-06-25

This document is intended for Walrus ecosystem BD, technical review, grant / sandbox screening, and follow-up meetings. It is based on the current repository, production app, Sui testnet / Walrus testnet deployment records, and the Orbstack Loop Engine asset publication record. Unknown fields are marked as TBD rather than invented.

## 1. Basic Info

Project: Research Network / Research Network Protocol Kit

Website: https://research-network-web.vercel.app

X / Twitter: @luo_eurax

GitHub: https://github.com/Euraxluo/research-network

Ecosystem: Sui, Walrus, Seal, zkLogin, GitHub, Vercel, Elysia, TypeScript, Move

Source: Repository review; `docs/05-walrus-development.md`; `docs/16-testnet-deployment.md`; Vercel production deployment; Sui/Walrus testnet evidence

Contact: @luo_eurax

Owner: Euraxluo

Current status: WIP / testnet product. The protocol kit, CLI, index API, web product, Sui Move package, Walrus release packaging, and at least one live ResearchAsset + SkillAsset have been implemented and tested on Sui testnet / Walrus testnet. Mainnet is not started or approved.

## 2. What They Are Building

Research Network is an agent-native research asset protocol. It turns research work into verifiable, installable, and reusable assets: papers, skills, workflows, code, datasets, experiments, benchmark reports, and private delegation results.

The product has three user-facing paths:

- Readers browse an arXiv-style public research index and open rendered papers, README files, skill metadata, and source provenance.
- Builders install the Research CLI, initialize a research workspace, package a research asset, publish it through Walrus + Sui, and optionally publish reusable agent skills.
- Agents and advanced users use Account / Workbench flows for zkLogin, GitHub binding, publishing, private delegation, receipts, and protocol testing.

Expected users include AI agent builders, independent researchers, research DAOs, open-source maintainers, Sui/Walrus ecosystem teams, and teams that want auditable research outputs rather than one-off PDF uploads.

The team matters because the project is not only a slide deck or whitepaper. The repository contains runnable protocol code: CLI, validators, packager, local indexer, Elysia API, Vercel frontend, Move contracts, testnet deployment records, and regression tests. The current Orbstack Loop Engine asset demonstrates the intended loop: GitHub repo -> Walrus release blob -> Sui ResearchAsset object -> Sui SkillAsset object -> index/API/web rendering -> CLI skill resolution.

## 3. Current Storage Situation

What data do they store?

- Public ResearchAsset release packages: `asset.yaml`, `manifest.json`, checksums, README, paper files, skill files, workflow files, source code, datasets, experiments, and benchmark outputs.
- Renderable research content: `paper.html`, `paper.tex`, `paper.md`, `paper.pdf`, Word documents, and PowerPoint decks.
- Agent skills: `skill.yaml`, `SKILL.md`, examples, runtime metadata, and links back to the owning ResearchAsset.
- Protocol metadata: repo URL, commit hash, manifest hash, content hash, Walrus blob id, Sui tx digest, Sui object id, owner address, timestamps, and event data.
- Private / encrypted work: delegation reports, ciphertext blobs, plaintext commitments, Seal ids, and access receipts.
- Index projections: searchable public views built from Sui events and Walrus release manifests.

Where is the data stored today?

- GitHub stores source repositories and authoring history.
- Walrus testnet stores immutable release packages and encrypted/private blobs.
- Sui testnet stores registry objects, events, receipts, SkillAsset objects, and protocol state.
- Vercel hosts the public web product and API functions.
- Optional Vercel database / index cache can store derived projections for faster lookup, but public truth should come from Sui events plus Walrus manifests.

Current storage provider / stack:

- GitHub for editable source and collaboration.
- Walrus testnet for release snapshots and large/public or encrypted content.
- Sui testnet for ownership, registry, events, receipts, skill identity, and settlement.
- Vercel Functions / Elysia API for backend projection and public API.
- Vercel Postgres / Neon is a likely production cache for index projections, not the source of truth.

Write frequency:

- Current stage: low-frequency manual/testnet writes during asset publication, showcase publishing, and protocol testing.
- Expected production path: each new research asset or versioned revision writes at least one Walrus release blob and one or more Sui transactions. Reusable skills add SkillAsset writes. Private delegation and paid access flows add report/access/settlement writes.
- Expected near-term volume: small but repeated, driven by published research assets and hackathon/demo workflows.

Data size:

- Metadata and manifests: KB-level.
- Papers, README, skill packages, and workflow bundles: KB to tens of MB.
- Datasets, experiment artifacts, and generated media can grow to hundreds of MB or GB if the protocol accepts larger research packages.
- Encrypted delegation reports are usually KB to MB, but may include attached artifacts.

Retention requirement:

- Public research assets need long-term retention and stable retrieval. A paper or skill should remain resolvable after the original authoring repo changes.
- Skill content needs stable identity and retrieval because tools install by the on-chain SkillAsset object id.
- Private reports need auditability, encrypted retention, and access-controlled retrieval through Seal/Sui policy.
- Current testnet deployments are not sufficient as permanent retention proof; production needs explicit epoch policy, renewal strategy, monitoring, and mainnet readiness.

Current pain points:

- GitHub is excellent for authoring but not enough for immutable, protocol-level release storage.
- Sui should not store large files directly; it is better as the registry and event layer.
- Walrus testnet blobs can expire or become unresolved if not renewed; this has already affected some historical showcase blobs.
- Indexing must avoid fake or stale data. If a Walrus manifest cannot be resolved, it should be shown only as diagnostics or raw chain evidence, not as a normal published asset.
- The product still needs clearer production handling for blob renewal, upload receipts, monitoring, and index persistence.

## 4. Walrus Fit

Does this project actually need decentralized storage?

Yes. The product is built around durable, independently retrievable research releases. A ResearchAsset should not depend only on a mutable GitHub branch, a Vercel deployment, or a centralized object store controlled by the app operator.

What specific role could Walrus play?

- Canonical storage for immutable ResearchAsset release packages.
- Storage for large paper files, generated artifacts, datasets, benchmark outputs, and skill packages.
- Storage for encrypted private delegation reports, where Seal/Sui controls access while Walrus stores ciphertext.
- Optional hosting layer for static research pages or product snapshots through Walrus Sites.
- Evidence layer that lets indexers and users verify that the content hash in Sui matches the package fetched from Walrus.

Is the need technical, commercial, narrative, or grant-driven?

The need is primarily technical and product-narrative aligned. Research Network wants verifiable research assets that remain retrievable outside the app operator. Walrus gives the protocol a credible storage layer for large immutable artifacts, while Sui provides identity, ownership, event logs, access receipts, and settlement.

There is also a commercial / ecosystem angle: Walrus support makes the project more credible for Sui/Walrus-native research marketplaces and agent skill distribution. Grant support may accelerate integration, but the storage need exists even without a grant.

Why would Walrus be better than their current solution?

- Better than GitHub alone: Walrus stores immutable release snapshots, while GitHub remains the authoring and collaboration layer.
- Better than Sui alone: Walrus stores large content efficiently; Sui stores small verifiable pointers and state.
- Better than centralized object storage alone: Walrus gives decentralized retrieval and stronger protocol alignment for public research assets.
- Better product story: each asset can be traced from Git commit to Walrus blob to Sui object to public index and CLI install command.

Initial judgment:

Storage Need: Strong

Walrus Fit: Strong

Grant Risk: Medium

Integration Difficulty: Medium

Rationale:

The project has a real decentralized-storage use case and already writes ResearchAsset packages to Walrus testnet. The main risk is not conceptual fit; it is production maturity. The project still needs stronger mainnet readiness, retention renewal, index persistence, monitoring, error handling, and evidence hygiene before it should be treated as a mature production integration.

## 5. Interview Notes

### Meeting 1

Topic: Product basics, skill usage path, operators / users / payers

Date: 2026-06-25

Participants: Euraxluo; @luo_eurax; @MindfrogCrypto

Summary:

The first discussion focused on the basic product shape of Research Network. The project is not simply a paper archive or content site. It aims to turn research outputs into assets that humans can read, agents can install and execute, and the chain can verify. Skill is one of the core entry points: users should not start by directly downloading an internal `SKILL.md` file. They should install the Research CLI, use the CLI-bundled project builder skill to initialize a research workspace, or install a published asset skill by its on-chain SkillAsset object id.

The meeting clarified three roles:

- Operators: developers, researchers, or agent operators who run the CLI, install skills, and build research assets.
- Users: research consumers, ecosystem projects, DAOs, or AI agent teams who read research, search assets, reuse skills, and verify provenance.
- Payers: investment firms, project teams, DAO treasuries, agent marketplace users, or teams paying for private delegated research.

Key findings:

- Research Network's product entry should be centered on the Research CLI, not on exposing internal `SKILL.md` files as download buttons.
- The project-level `research-network-builder` skill is bundled with the CLI for initialization. It is not a third-party on-chain skill published by another user.
- The on-chain SkillAsset object id should be the public installation key for published skills, avoiding global ambiguity from local ids such as `skill:<name>@<version>`.
- A skill is not just documentation. It is an installable agent capability that can guide an agent to create, validate, package, publish, and reuse research assets.
- The first user question is how to begin: install the CLI, initialize a workspace, then publish or install skills.
- The payer question is not merely who buys a PDF, but who pays for verifiable, reusable, accountable research capability.

Concerns:

- The product can be mistaken for a normal paper index unless the CLI + skill + protocol workflow is made explicit.
- Repeating CLI onboarding on the homepage, Skills page, and asset page can confuse users; the full instructions should live in the `Use CLI` page.
- External communication must distinguish the project-level builder skill, local skill templates, and published on-chain SkillAssets.
- The payer story needs to be explicit: investment reports, proprietary research tasks, agent execution capability, data/experiment reproduction, and auditable provenance.

Follow-up:

- Keep `Use CLI` as the single full onboarding page and explain that `research init` installs the project-level builder skill.
- Show only published on-chain skills and object ids on the Skills page; remove low-value tags.
- On asset detail pages, show only skills actually included by that asset and provide install commands based on the SkillAsset object id.
- In external decks and talks, separate operators, users, and payers instead of collapsing everyone into a generic reader.
- Use the Orbstack Loop Engine asset as the first concrete published skill example.

### Meeting 2

Topic: Investment research report storage, access control, paid delivery, and Walrus fit

Date: 2026-06-25

Participants: Euraxluo; @luo_eurax; @MindfrogCrypto

Summary:

The second discussion focused on investment research reports as a concrete commercial scenario. An investment report is not just a public paper. It often includes structured conclusions, data sources, model assumptions, charts, attachments, agent execution traces, version history, and optional private conclusions. Research Network can put the public abstract, metadata, and provenance into the public index, store the full report, attachments, and agent process as a Walrus-backed ResearchAsset release, and use encrypted blobs plus Seal/Sui access policy for paid or private delegated content.

The meeting discussed three categories of report data:

- Public content: title, abstract, author, timestamp, Git commit, manifest hash, on-chain object, and partial paper / README content for discovery and citation.
- Paid content: full investment memo, PDF/Word/PPT, valuation models, spreadsheets, charts, benchmarks, and agent run logs, available after purchase, subscription, or access receipt.
- Private delegated content: research commissioned by a project, fund, DAO, or individual; encrypted by default and accessible only to the client, authorized reviewers, or a dispute process.

Key findings:

- Walrus is a good fit for full investment report release packages, especially PDFs, Word documents, decks, data attachments, and agent execution artifacts.
- Sui is a good fit for report objects, access receipts, payment / settlement records, versions, owners, and dispute events.
- Seal is a good fit for decrypting paid or private reports without exposing full report plaintext to the public index.
- The public index should not render unavailable report bodies. If content cannot be fetched, it should show only verifiable metadata, object/tx links, and raw Walrus blob links.
- For investment research, Walrus is not mainly about cheaper storage. It is about verifiable, traceable, durable research deliverables.
- Reports should support rendering and raw download for multiple formats: Markdown/HTML, LaTeX/PDF, Word, PowerPoint, and raw package.

Concerns:

- Investment reports may contain sensitive information, so public preview, paid full report, and private delegation result must be separated by default.
- If a blob expires or an aggregator cannot read it, the user must not see fake content or fallback copy; the product should show verifiable metadata and raw evidence instead.
- Paid access cannot rely only on frontend hiding. It needs on-chain receipts, Seal policy, and encrypted Walrus blobs.
- Report versioning needs clear behavior: old versions retained, new versions published as new releases, the index showing the latest version while preserving provenance.
- The project needs to define who pays for storage renewal: author, buyer, platform, DAO treasury, or report revenue.

Follow-up:

- Design an investment report asset template with at least `README.md`, `paper.md` or `paper.pdf`, `report.docx`, `deck.pptx`, data attachments, and `asset.yaml`.
- Define the field boundary between public preview and paid/private full report.
- Publish one sample investment report during sandbox and verify the Walrus release, Sui report object, Seal access, and web rendering.
- Add acceptance rules for expired/unresolved blobs: do not render fake content; show only chain metadata and raw blob links.
- Design a storage renewal strategy and pricing model that includes retention cost in the report delivery or subscription price.

## 6. Architecture Review

Current architecture:

```text
GitHub research repo
  -> asset.yaml / paper / skill / workflow / code
  -> Research CLI validate/package
  -> Walrus release blob
  -> Sui ResearchAsset + SkillAsset objects/events
  -> Elysia/Vercel index API reads Sui events and Walrus manifests
  -> Web product renders public asset pages, skills, papers, README, and provenance
  -> Research CLI resolves/install skills by on-chain SkillAsset object id
```

Private / encrypted path:

```text
Agent or author
  -> encrypt report/artifact
  -> upload ciphertext to Walrus
  -> write Seal id, commitments, report/access receipts to Sui
  -> Seal policy decides who can decrypt
  -> index exposes only public metadata
```

Potential Walrus integration point:

- Primary: release package storage for every ResearchAsset.
- Secondary: direct file blobs for heavy papers, datasets, generated reports, media, and skill packages.
- Private path: encrypted delegation reports and paid-access deliverables.
- Optional: Walrus Sites for static web publishing or asset-specific landing pages.

Minimum viable test:

1. Publish a new ResearchAsset repo with at least one paper file, README, and one skill.
2. Package it through the Research CLI.
3. Upload the release to Walrus testnet or mainnet.
4. Register the ResearchAsset and SkillAsset on Sui.
5. Resolve the SkillAsset by object id through API and CLI.
6. Render the asset page and paper from the fetched Walrus manifest.
7. Verify the content hash and manifest hash against the Sui event/object.

Tooling gaps:

- Production blob renewal and retention dashboard.
- Clear upload receipt model for release blobs and per-file blobs.
- Better handling for unresolved testnet blobs and expired storage.
- Persistent index cache with replay and backfill jobs.
- Observability around Sui RPC failures, Walrus aggregator failures, and manifest parsing failures.
- Mainnet-ready configuration, budgets, and operator runbooks.

Engineering support needed:

- Walrus production best practices for epoch selection, renewal, and monitoring.
- Guidance on aggregator/publisher reliability and fallback endpoints.
- Review of encrypted report pattern with Seal.
- Review of large artifact packaging strategy.
- Assistance with mainnet dry run and evidence format for grant / ecosystem review.

Estimated integration effort:

- Testnet stabilization: 1-2 weeks.
- Mainnet MVP with retention policy, live index cache, and operator runbook: 2-4 weeks.
- Production-grade encrypted report / paid access flow: 4-8 weeks depending on Seal, wallet, billing, and dispute requirements.

## 7. Sandbox Trial

Status: Not formally started. The fields below define the recommended sandbox plan; they should be confirmed with Walrus before being treated as official trial commitments.

Trial goal:

Demonstrate that Research Network can repeatedly publish real research assets to Walrus, register them on Sui, resolve skills by SkillAsset object id, and render verified paper/README/skill content from live Walrus manifests in the public web product.

What will be tested:

- ResearchAsset release packaging.
- Walrus upload and retrieval.
- Sui ResearchAsset and SkillAsset registration.
- Index replay from Sui events plus Walrus manifests.
- CLI skill resolution and installation by on-chain SkillAsset object id.
- Public rendering of paper, README, and skill metadata.
- Handling of unresolved or expired blobs without showing fake assets.

What data will be written:

- Release package archives.
- Manifest JSON and checksums.
- Paper files such as Markdown, TeX, PDF, Word, or PowerPoint.
- Skill files such as `skill.yaml` and `SKILL.md`.
- Optional encrypted report artifacts if included in the sandbox.

Expected write pattern:

- Initial sandbox: 3-5 research assets, each with one release package and one or more Sui registrations.
- Follow-up: repeated writes for asset revisions, skill updates, and private report tests.
- Production target: business-event-driven writes when a researcher, agent, or project publishes a new version.

Success criteria:

- At least three assets are published with retrievable Walrus release manifests.
- Each asset has matching Sui tx/object evidence and content/manifest hash verification.
- At least one asset publishes a SkillAsset and can be resolved by object id.
- The public web app shows only resolved assets as normal assets.
- Unresolved anchors are limited to diagnostics and raw evidence links.
- CLI installation path is documented and works from the on-chain object id.

Stop conditions:

- Walrus blobs cannot be retrieved reliably after publication.
- Index cannot distinguish verified assets from unresolved chain anchors.
- Content hash or manifest hash verification fails.
- The product requires manual fixture data to look functional.
- Retention requirements cannot be met within the sandbox budget or tooling.

Developer GitHub:

https://github.com/Euraxluo

Repo:

https://github.com/Euraxluo/research-network

Contract address:

Current Sui testnet package:

`0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e`

Walrus designated address:

TBD. Current publisher address in testnet records:

`0x8ac06d3d4328aff5bef88990741c1f620a96d5fc579bf2e459467763bd605788`

Evidence links:

- Production app: https://research-network-web.vercel.app
- Main repo: https://github.com/Euraxluo/research-network
- Orbstack asset repo: https://github.com/Euraxluo/orbstack-loop-engine-research-asset
- Orbstack Walrus release blob: https://aggregator.walrus-testnet.walrus.space/v1/blobs/VldHk_w-YXXFKNukTgsrQ_JstLPc-HjwNzUJzSeag9w
- Orbstack ResearchAsset tx: https://suiscan.xyz/testnet/tx/GXmY76SAzmtFNQZEfo8WWtzjgVXRtnCHFTVBTVLEjTU5
- Orbstack ResearchAsset object: https://suiscan.xyz/testnet/object/0xc1f59ca4e632717a6de086e3c87f2237006aaffc64ede2e5a388ddd66586620f
- Orbstack SkillPublished tx: https://suiscan.xyz/testnet/tx/nwF5jbEJ76jRWsjJN7Mrzd1Mymyw5tb3WNmR7AUbp47
- Orbstack SkillAsset object: https://suiscan.xyz/testnet/object/0x2af18315d971e62988656a3ce0ffaac1fe597599390079536733ce23f2d257eb

Weekly tracking:

Week 1

Progress: TBD. Recommended target: publish two fresh research assets with live Walrus manifests and Sui objects.

Blockers: TBD.

Evidence: TBD.

Week 2

Progress: TBD. Recommended target: publish at least one SkillAsset and validate CLI install by object id.

Blockers: TBD.

Evidence: TBD.

Week 3

Progress: TBD. Recommended target: add retention/renewal monitoring, index backfill, and error-state acceptance tests.

Blockers: TBD.

Evidence: TBD.

## 8. Evidence

Repository and product:

- Research Network repo: https://github.com/Euraxluo/research-network
- Production web app: https://research-network-web.vercel.app
- Walrus development design: `docs/05-walrus-development.md`
- Testnet deployment report: `docs/16-testnet-deployment.md`
- Current README: `README.md`

Current Sui / Walrus testnet evidence:

- Current package id: `0x5ecd097d8f13e995493d23c9b033c815bd6a8bf771331c389c027296e8b8231e`
- Publisher address: `0x8ac06d3d4328aff5bef88990741c1f620a96d5fc579bf2e459467763bd605788`
- Orbstack asset repo: https://github.com/Euraxluo/orbstack-loop-engine-research-asset
- Orbstack repo commit: `98ab5507d757813d006116f0f01fb40896e37546`
- Walrus release blob: `VldHk_w-YXXFKNukTgsrQ_JstLPc-HjwNzUJzSeag9w`
- ResearchAsset tx: `GXmY76SAzmtFNQZEfo8WWtzjgVXRtnCHFTVBTVLEjTU5`
- ResearchAsset object: `0xc1f59ca4e632717a6de086e3c87f2237006aaffc64ede2e5a388ddd66586620f`
- SkillPublished tx: `nwF5jbEJ76jRWsjJN7Mrzd1Mymyw5tb3WNmR7AUbp47`
- SkillAsset object: `0x2af18315d971e62988656a3ce0ffaac1fe597599390079536733ce23f2d257eb`
- Raw skill content path inside the Walrus release: `skill/orbstack-loop-engine/SKILL.md`

Important caveat:

Some historical showcase blobs were written to Walrus testnet but may not remain retrievable. They should be treated as historical deployment evidence, not as current live product data unless the index can fetch and verify their manifests in real time.

## 9. Final Review Memo

### Project Summary

Research Network is building a protocol and product layer for verifiable research assets. The key idea is to publish research in a form that agents and humans can both consume: a paper can be read, a skill can be installed, a workflow can be replayed, a release can be verified, and the provenance can be traced from GitHub to Walrus to Sui.

Walrus is not decorative in this architecture. It is the storage layer that makes research releases and encrypted reports retrievable as content-addressed, independently verifiable artifacts. Sui provides identity, ownership, registry events, receipts, access control hooks, and settlement.

### Storage Need

Strong.

Research Network needs decentralized storage for public research packages, skills, rendered papers, datasets, and encrypted reports. Without Walrus or an equivalent decentralized storage layer, the protocol would degrade into a GitHub/Vercel app with on-chain pointers but no durable large-content layer.

### Walrus Fit

Strong.

Walrus fits the release-package model, the content-hash verification path, the large artifact storage requirement, and the encrypted report use case. It also strengthens the project's positioning inside the Sui ecosystem.

### Integration Result

Choose one:

Integrated & Writing Data on testnet.

Mainnet status:

Not started.

Explanation:

The project has real testnet evidence: Walrus release blobs, Sui ResearchAsset objects, SkillAsset objects, tx digests, and a Vercel product that can index and render verified assets. However, production readiness still depends on retention policy, persistent index operations, mainnet deployment, monitoring, and repeated writes beyond one showcase-quality asset.

### Usage Signal

One-off demo:

Yes. Orbstack Loop Engine is a concrete published asset and skill.

Repeated writes:

Early / partial. Multiple historical testnet assets exist, but some older Walrus testnet blobs may be unresolved. The project needs a fresh sandbox run with repeated writes and retention checks.

Business-event-driven usage:

Not proven yet. The intended business event is publishing or revising a research asset, publishing a skill, or delivering a private delegation report.

Retention evidence:

Partial. Current docs show upload, read-back, certified epoch, tx/object evidence, and hash verification for historical deployments. Long-term retention and renewal are not yet proven.

### Grant Dependence

The project appears interested because of a real technical need, not only grant support. Walrus is structurally useful for the product. That said, grant or ecosystem support would materially help with mainnet hardening, retention/renewal tooling, repeated write trials, and public evidence quality.

### Final Classification

Choose one:

Sandbox Candidate.

Secondary label:

Exploratory -> Integrated & Writing Data on testnet.

### Recommendation

Go for sandbox.

Need More Evidence before production grant or mainnet endorsement.

### Rationale

Research Network is a strong Walrus-fit project because its core product requires immutable, verifiable storage for research artifacts and agent skills. The current repository already includes real implementation work across CLI, web, indexer, Move contracts, Walrus packaging, and testnet deployment.

The main concern is not whether Walrus is relevant. The concern is whether the project can sustain production-quality writes, retrieval, retention renewal, and index correctness. A sandbox trial should focus on fresh repeated writes, live manifest retrieval, SkillAsset install by object id, index persistence, and clean handling of unresolved blobs.

If the sandbox produces repeated live write evidence and the product continues to avoid fake/stale rendered data, Research Network should be considered a credible Walrus ecosystem integration candidate.
