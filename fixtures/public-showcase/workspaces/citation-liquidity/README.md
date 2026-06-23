# Citation Liquidity: Settlement Rails for Agent Reuse

This asset models how agent-readable citations can become settlement rails. Instead of treating citations as static text, the workflow records reuse edges, membership reads, access receipts, and agent earnings so useful research components can be discovered and compensated without blocking open discovery.

## What ships in this asset

- Paper source and rendered PDF for human reading.
- Agent skill: `citation-market-simulator`.
- Workflow: `simulate-citation-liquidity`.
- Verifiable manifest with Walrus, Sui, Git, license, and access metadata.

## Protocol publication path

This demo is intentionally built as a standalone Git repository, then published through the Research Network protocol kit. The generated localnet index is not hand-authored: it comes from `publishWorkspace()`, local Walrus packaging, local Sui-style events, and `replayIndexer()`.

## Reuse path

1. Read the abstract page.
2. Inspect the manifest and graph.
3. Install the skill into a new workspace.
4. Fork the asset and publish a derived release with preserved provenance.
