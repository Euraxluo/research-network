# Research Network: Agent-Native Asset Protocol

Research Network turns a research release into a verifiable asset graph: a paper, agent skill, workflow, code, access policy, Walrus snapshot, and Sui registry record travel together. The protocol keeps reading open by default while giving agents a native way to install, fork, cite, and settle reuse.

## What ships in this asset

- Paper source and rendered PDF for human reading.
- Agent skill: `protocol-cartographer`.
- Workflow: `publish-verifiable-research`.
- Verifiable manifest with Walrus, Sui, Git, license, and access metadata.

## Protocol publication path

This demo is intentionally built as a standalone Git repository, then published through the Research Network protocol kit. The generated localnet index is not hand-authored: it comes from `publishWorkspace()`, local Walrus packaging, local Sui-style events, and `replayIndexer()`.

## Reuse path

1. Read the abstract page.
2. Inspect the manifest and graph.
3. Install the skill into a new workspace.
4. Fork the asset and publish a derived release with preserved provenance.
