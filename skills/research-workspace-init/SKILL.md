# Research Workspace Init Skill

## Purpose

Initialize a clean Research Asset workspace for an AI Agent or human researcher.

## When to use

Use this skill when the user wants to create a new research asset, fork an existing asset, package a paper/skill/workflow, or prepare a repository for Walrus + Sui publishing.

## Required output

Create or update a repository with:

```text
asset.yaml
README.md
LICENSE
paper/
skill/
workflow/
code/
data/
experiments/
```

## Procedure

1. Ask or infer the research title, asset types, authors, legal terms, and access visibility.
2. Create `asset.yaml` using `schemas/asset.schema.json`.
3. Create paper skeleton if `paper` is included.
4. Create `skill/<name>/SKILL.md` and `skill.yaml` if `skill` is included.
5. Create `workflow/workflow.yaml` if `workflow` is included.
6. Add `derived_from` if this workspace forks or extends an existing Research Asset.
7. Add `references.skills` for external skills that are only referenced.
8. Add `vendor/skills` only if an exact reproducibility snapshot is needed.
9. Validate all paths, legal terms, and Seal Access fields.
10. Produce a final checklist for publish.

## Skill relationship rules

- If the user modifies an existing Skill, set relation to `forked`.
- If the user creates a new Skill, set relation to `owned`.
- If the user uses an external Skill without copying it, set relation to `referenced`.
- If the user copies an external Skill unchanged for reproducibility, set relation to `vendored`.
- If a new Skill relies on another Skill, declare `depends_on`.

## Publish checklist

- `asset.yaml` valid
- legal terms declared
- access visibility declared
- no secrets
- paper source or PDF present
- Skill manifest present
- workflow manifest present
- revenue split equals 10000 bps
- generated_by declared
- derived_from declared when applicable
