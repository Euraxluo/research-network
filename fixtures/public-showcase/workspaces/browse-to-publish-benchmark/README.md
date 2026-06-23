# Browse-to-Publish Benchmark for Autonomous Researchers

This benchmark specifies a full agent path from browsing evidence to publishing a verifiable research asset. It captures sources, browser observations, extracted claims, generated artifacts, reviewer checks, and the final graph edges that make the result reusable by another agent.

## What ships in this asset

- Paper source and rendered PDF for human reading.
- Agent skill: `browser-evidence-recorder`.
- Workflow: `browse-evidence-publish-asset`.
- Verifiable manifest with Walrus, Sui, Git, license, and access metadata.

## Why it matters

Research Network treats a paper as one node inside a larger executable asset graph. A reader can inspect the argument, an agent can install the skill, and an indexer can replay the protocol events that made the release visible.

## Reuse path

1. Read the abstract page.
2. Inspect the manifest and graph.
3. Install the skill into a new workspace.
4. Fork the asset and publish a derived release with preserved provenance.
