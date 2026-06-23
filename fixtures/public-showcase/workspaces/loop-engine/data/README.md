# Loop trace data

The expected data shape is a JSONL trace with one accepted public row per loop transition.

Private chain-of-thought does not belong in this data layer. Public trace rows should contain
state summaries, evidence handles, artifact hashes, tool receipts, and review outcomes.
