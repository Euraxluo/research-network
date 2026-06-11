# Design System

Implemented by the static site generator in `src/core/web.ts` (`STYLES_CSS` + `SITE_JS`). Pure static, zero-dependency vanilla CSS/JS — every page must remain deployable to Walrus Sites as-is.

## Positioning

Design keywords: `academic, technical, verifiable, dense, clean, agent-readable`.

- arXiv's information density (abs pages, serif titles, citation blocks)
- GitHub's repository structure (metadata panels, mono file paths)
- npm's install experience (copyable `research install` snippets, terminal)
- DeFi's verification aesthetic (on-chain object IDs, hashes, pulsing verified dots)

## Design Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0a0e16` | page background (dark technical) |
| `--bg-2` | `#0d1422` | raised surfaces |
| `--panel` / `--panel-2` | `rgba(148,163,184,.055/.09)` | cards, panels |
| `--line` | `rgba(148,163,184,.16)` | hairline borders |
| `--ink` | `#e7edf7` | primary text |
| `--muted` | `#8e99ad` | secondary text |
| `--accent` | `#4d9fff` | protocol blue: links, primary buttons |
| `--accent-2` | `#7c6bff` | violet: gradients, generic asset nodes |
| `--ok` | `#2dd4a7` | verified green: brand dot, v-dots, pulses |
| `--warn` | `#f0b429` | amber |
| `--danger` | `#ff7a7a` | red: arXiv-style `[RA:...]` id |

Type stacks:

- Sans (`Inter`, system): UI chrome, body.
- Serif (`--serif`, Georgia): arXiv-style `abs-title`, section headings, abstract prose, rendered paper body.
- Mono (`--mono`): verification data, terminal, tags, kickers, stat numbers, graph labels.

## Components

- **topbar** — sticky, blurred glass (`backdrop-filter`), pulsing green brand dot, nav links with gradient underline grow on hover.
- **hero** — kicker + gradient-sheen headline + terminal; right column holds the network canvas panel and protocol state.
- **terminal** — macOS-style head dots, `$` prompt, typewriter cycling real CLI commands, blinking block cursor.
- **stats / counters** — mono numerals animated from 0 on first view (`data-count`).
- **card** — hover: lift, accent border, gradient top edge fades in.
- **tag** — mono pill, protocol-blue tint, brightens on hover.
- **verification rows** — uppercase label + pulsing green `v-dot` + mono value; used for Sui object / Walrus blob / hashes / commit.
- **copy-row** — npm-style install snippet with `copy` button (`data-copy`), flips to green `copied`.
- **search filter** — client-side instant filtering of `.result` rows (`#filter` input), focus ring glow.
- **abs page** — arXiv layout: red mono `[RA:...]` kicker, serif title, meta grid, sticky accent-bordered sidebar with actions + verification.
- **paper body** — LaTeX source rendered to serif HTML sections (abstract + `\section` split) when TeX is available in the snapshot.
- **graph viewer** — full-width canvas projection of the relationship graph with type-colored nodes, labeled edges, legend strip; node/edge cards below as fallback.

## Motion System

All motion respects `prefers-reduced-motion: reduce` (animations collapse to static frames, reveals render visible).

| Effect | Trigger | Mechanism |
| --- | --- | --- |
| Scroll reveal | enter viewport | `IntersectionObserver` adds `.in` to `[data-reveal]`, staggered `transition-delay` |
| Stat counters | enter viewport | rAF count-up with cubic ease-out |
| Typewriter | page load | char-by-char type/delete cycle over `data-lines` |
| Hero network | page load | canvas: drifting type-colored nodes, distance-faded edges, green pulses traveling along links |
| Graph viewer | page load | canvas: breathing node positions, animated dashed edges, hover highlights node + its edges |
| Hover lift/glow | hover | cards/buttons translateY + accent shadow |
| Gradient sheen | ambient | headline background-position sweep |
| Glow drift | ambient | fixed radial glow slowly translating behind the grid |
| Pulse dots | ambient | brand dot + verification `v-dot` box-shadow pulse |

## Node Type Colors

```text
paper     #4d9fff
skill     #2dd4a7
workflow  #f0b429
dataset   #ff8fab
asset     #7c6bff
```

## Asset badges

```text
Paper
Skill
Workflow
Dataset
Experiment
Benchmark
Agent-generated
Human-reviewed
On-chain
Walrus snapshot
Paid license
Open source
Commercial
```
