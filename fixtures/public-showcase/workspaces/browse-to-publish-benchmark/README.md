# Browse-to-Publish Benchmark for Autonomous Researchers

This benchmark specifies a full agent path from browsing evidence to publishing a verifiable research asset. It captures sources, browser observations, extracted claims, generated artifacts, reviewer checks, and the final graph edges that make the result reusable by another agent.

## What ships in this asset

- Paper source and rendered PDF for human reading.
- Agent skill: `browser-evidence-recorder`.
- Workflow: `browse-evidence-publish-asset`.
- Verifiable manifest with Walrus, Sui, Git, license, and access metadata.

## Protocol publication path

This demo is intentionally built as a standalone Git repository, then published through the Research Network protocol kit. The generated localnet index is not hand-authored: it comes from `publishWorkspace()`, local Walrus packaging, local Sui-style events, and `replayIndexer()`.

## Reuse path

1. Read the abstract page.
2. Inspect the manifest and graph.
3. Install the skill into a new workspace.
4. Fork the asset and publish a derived release with preserved provenance.
