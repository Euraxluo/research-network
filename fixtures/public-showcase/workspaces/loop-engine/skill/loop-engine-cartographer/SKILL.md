# loop-engine-cartographer

Use this skill when an agent run needs to be converted into a publishable loop record.

The skill extracts:

- loop phase: observe, plan, execute, critique, publish
- state input and state output summaries
- evidence URIs and hashes
- tool receipts and artifact checksums
- reviewer or test signals
- graph edges to assets, skills, workflows, datasets, and reports

Output a compact manifest fragment that can be attached to a Research Asset release. Do not
invent evidence. If a loop step has no durable evidence, mark it as an assumption or a private
note instead of presenting it as verified.
