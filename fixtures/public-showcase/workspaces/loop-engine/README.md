# Loop Engine

Loop Engine is a Research Network asset about making autonomous research loops verifiable.

The release frames an agent loop as a sequence of typed state transitions:

- observe: collect external evidence and current graph state
- plan: commit to the next research move
- execute: run tools or produce artifacts
- critique: attach checks, objections, and reviewer signals
- publish: write the accepted delta into an asset graph

The goal is not to make another chat agent UI. The goal is to make the loop itself a durable
research object that can be replayed, forked, cited, and settled.

This workspace contains:

- `paper/main.tex`: the paper source
- `skill/loop-engine-cartographer`: a skill for mapping loop traces into graph-ready records
- `workflow/workflow.yaml`: the publishable workflow contract
- `code/README.md`: implementation notes for runtime adapters
- `data/README.md`: expected trace schema
- `experiments/README.md`: evaluation plan
