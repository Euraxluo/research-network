# Indexer Design

Indexer 监听 Sui 事件，读取 Walrus Manifest，重建 Research Asset Graph。

## Worker

```text
sui-event-listener
walrus-manifest-fetcher
asset-parser
skill-parser
relationship-builder
embedding-worker
search-index-writer
graph-projector
```

## Replay

```bash
pnpm indexer replay --from-checkpoint 0
pnpm indexer reindex-asset --asset-id ra:sui:...
pnpm indexer rebuild-search
```

## Local implementation

The runnable local implementation is `src/core/indexer.ts`. It treats the local event log as a Sui checkpoint stream:

```text
.research-network/localnet/events.ndjson
.research-network/localnet/walrus/<blob>/manifest.json
.research-network/localnet/index.json
```

Run it with:

```bash
npx tsx src/cli.ts publish ./workspace
npx tsx src/cli.ts replay
npx tsx src/cli.ts search "query" --type asset
```

The projection aligns with `indexer/sql/schema.sql` and currently covers assets, skills, relationships, agents, licenses, and search documents.

Handled events:

- `ResearchAssetPublished`
- `SkillPublished`
- `AssetRelationshipRegistered`

A production Sui listener can feed the same `ProtocolEvent` shape into the replay pipeline.
