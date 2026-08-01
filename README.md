# Variance Authority

> Percy shows you pixels. Variance Authority tells you `Button` broke the hero.

A deterministic verification layer for frontend surfaces, built for agent-driven
development. It answers *"what changed, why, where, and should anyone care?"* at
the cheapest representation capable of deciding — in your own infrastructure.

**Status: M0 spike.** The pipeline runs end to end under **both** profiles and is
measured against a corpus with pre-declared ground truth — 38/38 under `jsdom`,
39/39 under `chromium`, zero false verdicts either way, and the two profiles agree
on all 38 cases both can decide. There is no CLI, no manifest, no raster stage,
and nothing is published.

## What exists

```
packages/
  core/                 snapshot format, normalization, hashing, diff, banding, verdicts
  provenance-react/     React fiber traversal → owner chains, props digests, portals
  collector-dom/        RawCapture from a live DOM, incl. CSS applicability pruning
  harness-playwright/   one Chromium, one page, one navigation — a capture per subject
examples/
  kitchen-sink/         8 subjects, 40 declared cases — the measurement's ground truth
docs/context/           the paper trail: ADRs, journal, helix checkpoint
```

Dependencies point downward only. `core` depends on nothing in the repo and on no
host environment — no DOM, no Node, no globals — enforced by `lib: ["ES2022"]`
with `types: []`. Collectors extract; `core` normalizes. That split is what makes
one ruleset serve both profiles by construction, and what lets a capture cross a
network hop to a remote sub-renderer unchanged.

## The two rendering surfaces

| Surface | Driver | Profile | Can observe |
|---|---|---|---|
| **JSDOM** | jest, vitest | `jsdom` | structure, ARIA, declared CSS — **no layout** |
| **REAL-DOM** | playwright, agent-browser | `chromium` | the above **+ computed style + layout rects + raster** |

Both emit the same snapshot format and enter the same normalizer. They are never
compared: the profile is part of the environment key, and a band a profile cannot
observe reports `unobserved` rather than passing. JSDOM is not a cheap browser —
it is an earlier gate that settles the token band and structural geometry in
milliseconds, in the unit-test process.

See [ADR-0002](docs/context/adr/0002-observation-profiles.md).

## The tier ladder

```
reachability → structure+CSS digest → jsdom semantic → chromium semantic → raster
   free              ~ms                   ~ms              7.5 ms          ~s
```

Each rung decides what it can and passes the rest on. On a page carrying
Storybook chrome, a preview reset, dead utility classes, and 500 generations of
accreted CSS-in-JS against a single-button subject, **1007 CSS rules were parsed
and 1 reached the normalizer**.

The `chromium` rung costs 7.5 ms per subject only because the browser, the page
and the navigation are shared across a run; relaunching per subject costs 205 ms,
**27x more**. That measurement is the reason `harness-playwright` exists, and it
also undercuts the ~100 ms this table used to claim — see
[journal 0007](docs/context/journal/0007-persistent-harness-and-p4.md).

## Reading order

1. [`docs/context/README.md`](docs/context/README.md) — how the paper trail works
2. [`docs/context/checkpoint.md`](docs/context/checkpoint.md) — current state,
   what is proven, what is open
3. [`docs/context/adr/`](docs/context/adr/) — decisions that constrain the code;
   [0003](docs/context/adr/0003-cruft-removal-and-css-applicability.md) is the moat
4. [`docs/context/journal/`](docs/context/journal/) — what was attempted and what it cost

## Development

```bash
yarn install
```

```bash
yarn build && yarn test
```

The M0 measurement, which scores the pipeline against the corpus:

```bash
yarn vitest run examples/kitchen-sink/src/measure.test.tsx
```

The `chromium` half, plus the two-profile comparison (claim P4). Needs a browser;
skips itself with a reason if there is none:

```bash
npx playwright install chromium
yarn vitest run examples/kitchen-sink/src/measure.chromium.test.tsx
```

What the persistent harness is worth, cold versus warm:

```bash
yarn workspace @variance-authority/example-kitchen-sink bench
```
