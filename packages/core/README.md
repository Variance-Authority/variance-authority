<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/core

> The Variance Authority format, rules, comparison, attribution and verdicts. Pure data in, pure data out, no DOM and no I/O.

A **subject** is whatever is under test — a component, a page, or a plain
value. A **capture** is the raw material a collector records from it once,
before anything is compared. Collectors extract captures; this package
normalizes and adjudicates them, and never captures anything itself.

```bash
npm install --save-dev @variance-authority/core
```
## Use this package when

Install `@variance-authority/core` when the input is already produced: a
capture, a semantic snapshot, a render document (serialized subject markup,
ready to be rasterized elsewhere), a raster mask (`ChangeMask`: a per-pixel
changed/unchanged bitmap, not an image), or a plain value. The package does
not collect a DOM, read PNG bytes, launch a renderer, or select a test
runner — for that, install `@variance-authority/dom` for a live DOM,
`@variance-authority/react` for React provenance (the chain of component
ownership attached to each node), and `@variance-authority/png` when the
input is a PNG.

## Entrypoints

Seven groups. Five of them are the order an answer travels through; `core/plan`
and `core/relate` sit outside that line, because both are asked *before* anything
is captured — one decides which baselines the run can reach at all, the other
decides which subjects are worth reaching for. The default entrypoint is all
seven and is what most callers want.

| entrypoint | holds |
|---|---|
| `core/format` | what a subject *is*: capture, snapshot, document, identity, hashing |
| `core/rules` | the versioned opinions: allowlist, applicability, cascade, canonicalization |
| `core/compare` | two snapshots become deltas — and **no verdict** |
| `core/attribute` | a position becomes a component becomes a file |
| `core/judge` | policy: verdicts, intent claims, ignores, the docket a reader is handed |
| `core/plan` | the whole configuration of a run — profile, ruleset version, viewport, policy, interventions — as one value, plus the identity digest derived from it |
| `core/relate` | what rests on what: a file graph in adjacency form, the components a change reaches, and a closure digest over each one |

Three terms recur across those groups. A **profile** records what a collector
was capable of observing — jsdom sees structure and declared style, chromium
adds layout and pixels. An **identity** is the content hash that addresses a
result; two runs are comparable only when their identities match. A
**verdict** is one of six words this package will commit to: `unchanged`,
`inherited`, `authorized`, `needs-review`, `violation`, `unexplained`.

The groups exist for callers who genuinely want one. Somebody implementing the
capture format for a renderer this project has never met needs `core/format` and
would be misled by everything else. Somebody deciding where a baseline is stored,
or whether two runs may be compared at all, needs `core/plan` and nothing else:
the digest it derives is the address, so changing any part of the plan changes
which baselines the run can see.

## Comparison and policy

`compare` says **what changed**. `judge` says **whether anyone should mind**.

Between them sits `partingOf`, which says **which input moved**. Given two
snapshots carrying holdings it walks the component boundaries for the shallowest
one whose inputs agreed and whose output did not, and reports that as the origin
— a moved prop, a context, an external store, or a hook cell by call position.
It leads with a slice (`variation`, `flake`, `refactor`, `absorbed`, `settled`,
`unread`) so a reader knows whether to open the rest, and `explainParting` turns
the whole thing into lines a person reads.

## Smallest working path: compare a value

Value comparison needs no host setup and returns paths and fingerprints, not a
pass/fail verdict:

```ts
import { compareValues, shapeValue } from '@variance-authority/core';

const before = shapeValue({ rows: [{ id: 'a', total: 10 }] }, {
  arrayKey: { '/rows': 'id' },
});
const after = shapeValue({ rows: [{ id: 'a', total: 12 }] }, {
  arrayKey: { '/rows': 'id' },
});

const deltas = compareValues(before, after);
console.log(deltas[0]?.pointer);                     // /rows/a/total
```

For a rendered subject, the same package receives captures from a collector:

```ts
import { attributeRegions, diffSnapshots, isolateRegions, normalize } from '@variance-authority/core';

const before = normalize(capture);                   // supplied by a collector
const after = normalize(recapture);
const diff = diffSnapshots(before, after);           // deltas, roots, no verdict

// `mask` is a ChangeMask from the raster tier. Core never opens an image.
const places = isolateRegions(mask, { cell: 8 });    // pixels → regions
const named = attributeRegions(places.regions, after, { scale: 2 });
```

The value example prints a JSON Pointer for the changed field. The rendered path
returns semantic roots and, when a raster mask is supplied, regions attributed to
the candidate snapshot. A caller still chooses policy and a verdict in
`core/judge` or in its own runner.

`scale` is device pixels per CSS pixel. It is **required**, and it has no default
on purpose: a 2x screenshot attributed at 1x lands every region in the top-left
quadrant and names the wrong component for each — a full, plausible, entirely
wrong report. That last step is where regions become components and files.

The options that change scope are explicit at the call site:

| call | useful controls |
|---|---|
| `normalize` | `collapseWrappers` removes layout-only wrapper boundaries, `digestText` includes text content, and `sourceRoot` relativizes source locations |
| `isolateRegions` / `attributeRegions` | `cell` and `limit` bound mask work; `origin` and `containment` describe the coordinate origin and how much a node must contain a region |
| `fingerprintOfMask` | `grid` controls the shape sample and `coverage` controls the minimum occupied share |
| `compareLocales` / ignore validation | `slack` permits a declared locale distance; `sites` supplies resolved ignore locations and `now` evaluates expiry |
| `buildDocket` / dependency reach | `sampleSize` limits review examples and `through` selects graph edge kinds |
| report summaries | `source` maps component names to files when `summarizeAdjudication` or `summarizeFindings` needs an actionable path |
| screenshot stabilization | `animations` and `caret` are explicit intervention settings; omitted means the caller did not assert either intervention |

### A subject that was never rendered

`shapeValue(value, options)` is the same treatment for a value — an API
response, a generated schema, a route table. It canonicalizes (keys sorted,
numbers written portably, `undefined` omitted), addresses the text by content,
and returns a `CapturedValue`; `compareValues` turns two of them into deltas
carrying a JSON Pointer and a fingerprint, and — like everything else here — no
verdict.

```ts
import { shapeValue, compareValues } from '@variance-authority/core';

const baseline = shapeValue(before, { arrayKey: { '/rows': 'id' } });
const deltas = compareValues(baseline, shapeValue(after, { arrayKey: { '/rows': 'id' } }));
```

`drop` records a pointer's value as present without comparing it, `replace` puts
a token you choose in its place, and `arrayKey` says which member identifies a
row — the difference between *one row was added* and *two thousand rows moved*.
Two more options describe the value rather than shape it: `dialect` is how a
reader will interpret the text later (`'json'` by default, `'openapi'` and
`'graphql'` being the ones with detectors), and `generator` names what emitted
it. Neither reaches the digest, so declaring a dialect does not orphan a
baseline.

Non-data throws, naming the pointer. A function, a `Date`, a `bigint` or a
non-finite number cannot be canonical text, and dropping one silently puts a key
in the record that the next run reads as removed.

Rendered comparisons also throw when the subjects or observation profiles differ.

## What it refuses

**Absent is not empty.** Not measured, measured as zero, and unobservable are
three states, and collapsing any two produces a pass nobody earned. A **band**
(the frequency category a change falls into — `a11y`, `geometry`, `token`,
`content`, `texture`, rarest to noisiest) that a profile cannot see reports
`UNOBSERVED`, which the type system will not let you spell the same way as a
pass.

**Two results whose identities differ are `incomparable`, never `different`.**
A difference in conditions reported as a difference in the product is a
confident wrong answer, and the confidence is what makes it expensive.

