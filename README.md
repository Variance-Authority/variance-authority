# Variance Authority

> Percy shows you pixels. Variance Authority tells you `Button` broke the hero.

A deterministic verification layer for frontend surfaces, built for agent-driven
development. It answers *"what changed, why, where, and should anyone care?"* at
the cheapest representation capable of deciding — in your own infrastructure.

**Status:** pre-M0. Nothing here is stable. Not published, not pushed.

## Repository layout

```
packages/
  core/                 # snapshot format, normalization, hashing, diff, banding, verdicts
  provenance-react/     # React fiber traversal -> owner chains + props digests
  collector-jsdom/      # jest / vitest subject collector      (observation profile: jsdom)
  collector-playwright/ # playwright / agent-browser collector (observation profile: chromium)
  cli/                  # `va` command line
examples/
  kitchen-sink/         # component library used as our own test corpus
docs/
  context/              # the paper trail: journal + ADRs (read this first)
```

## The two rendering surfaces

| Surface | Driver | Observation profile | What it can see |
|---|---|---|---|
| **JSDOM** | jest, vitest | `jsdom` | DOM structure, ARIA, declared CSS, **no layout** |
| **REAL-DOM** | playwright, agent-browser | `chromium` | everything above **+ resolved computed style + layout rects + raster** |

Both collectors emit the *same* snapshot format. They are never compared against
each other — the observation profile is part of the environment key. See
[ADR-0002](docs/context/adr/0002-observation-profiles.md).

The JSDOM collector is designed as a **detachable sub-renderer**: it speaks a
serializable request/response protocol, so it can run in-process, in a worker, or
on another machine (device farm) without the core knowing the difference.

## Reading order

1. [`docs/context/README.md`](docs/context/README.md) — how the paper trail works
2. [`docs/context/journal/`](docs/context/journal/) — what was done and why, in order
3. [`docs/context/adr/`](docs/context/adr/) — decisions that constrain the code

## Development

```bash
yarn install
```

```bash
yarn build && yarn test
```
