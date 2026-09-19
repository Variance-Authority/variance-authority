<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/core

> The Variance Authority format, rules, comparison, attribution and verdicts. Pure data in, pure data out, no DOM and no I/O.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

You already have a reading of something — a DOM recorded by a collector, a
rendered document, a per-pixel diff mask, or a plain JSON value — and you need
to know what changed in it, which component and file the change lands on, and
whether anyone should mind. This package does that part and only that part. It
opens no DOM, reads no files, makes no network calls, and has no runtime
dependencies: what you hand it is everything it sees.

A **subject** is one named UI state you asked for and can ask for again — a
component in a given state, a page at a given route, or a plain value. A
**capture** is the raw material a collector records from a subject once, before
anything is compared. Collectors produce captures; this package normalizes and
adjudicates them, and captures nothing itself.

## Requirements

Node 22 or newer, and ESM. There is no CommonJS build, so `require()` will not
load it. No runtime dependencies — every input arrives from a package you
install separately, named at each example below.

## Install, and compare a value

The shortest complete path needs no browser and nothing else installed.

```bash
npm install --save-dev @variance-authority/core
```

```ts
import { shapeValue } from '@variance-authority/core/format';
import { compareValues } from '@variance-authority/core/compare';

const shaping = { arrayKey: { '/rows': 'id' } };

const baseline = shapeValue(
  { rows: [{ id: 'checkout', total: 10 }, { id: 'cart', total: 4 }] },
  shaping,
);
const candidate = shapeValue(
  { rows: [{ id: 'checkout', total: 12 }, { id: 'cart', total: 4 }, { id: 'search', total: 1 }] },
  shaping,
);

console.log(baseline);
console.log(compareValues(baseline, candidate));
```

### What you get

```
{
  dialect: 'json',
  text: '{"rows":{"cart":{"id":"cart","total":4},"checkout":{"id":"checkout","total":10}}}',
  digest: 'v1:e19dcb366e2321d0c7890dd69629ac39',
  recipe: 'value/1',
  keyed: [ '/rows' ]
}
[
  {
    change: 'value-changed',
    pointer: '/rows/checkout/total',
    fingerprint: 'v1:444e8245747e15412c5142a5a44fe321'
  },
  {
    change: 'added',
    pointer: '/rows/search',
    fingerprint: 'v1:a9bd40864996d0b80d37c034f3f62109'
  }
]
```

Three things in that output do work you will want later.

`text` is the canonical serialization, byte for byte what `digest` was taken
over — keys sorted, numbers written portably, `undefined` omitted. It is what a
baseline stores and what a person reads in a pull request.

`arrayKey` turned the `rows` array into an object keyed by `id` before
canonicalization, which is why inserting `search` at the end reports one
`added` delta. Compared by index instead, an insertion at the top of a
two-thousand-row list reports two thousand rows as changed.

`fingerprint` is the shape of the difference with the row identity and the
values removed. Change `cart.total` instead of `checkout.total` and you get the
same `v1:444e8245747e15412c5142a5a44fe321`, so one decision can settle the same
edit wherever it occurred. Deltas carry no values at all: the two canonical
texts are the evidence, and a delta that quoted them would put payload into
every record that accumulates.

`compareValues` throws rather than guessing when the two sides disagree about
how they were made — different dialects, different shaping rules, or different
keyed arrays. `shapeValue` throws on anything that cannot be canonical text,
naming the JSON Pointer:

```
the value at /at is a Date, which is not a value. Its state is not in its own
enumerable keys, so it would serialize to `{}` and two different ones would
compare as unchanged.
```

Functions, `Date`, `bigint` and non-finite numbers all fail this way. The
alternative is `JSON.stringify`'s: drop the key silently, which the next run
reads as a key that was removed.

### Shaping options

| option | effect |
|---|---|
| `arrayKey` | `{ '/rows': 'id' }` — the member that identifies a row, so an array becomes an object and order stops being a fact about it |
| `drop` | records a pointer's value as the token `[dropped]` — present, never compared |
| `replace` | puts a stable token of your choosing at a pointer |
| `dialect` | a label carried with the text, `'json'` by default; two values with different dialects refuse to compare |
| `generator` | `{ name, version }` of whatever emitted the value |

Every key is a JSON Pointer (RFC 6901). A `-` token matches any array index, so
`/items/-/updatedAt` names that member of every item. Neither `dialect` nor
`generator` reaches the digest, so labelling a value later does not orphan its
baseline.

## Use this package when

Install `@variance-authority/core` when the input is already produced: a
capture, a **semantic snapshot** (a normalized tree of nodes, digests and
boxes), a **render document** (serialized subject markup, ready to be
rasterized elsewhere), a **change mask** (`ChangeMask`: a per-pixel
changed/unchanged bitmap, not an image), or a plain value.

To produce those inputs, install a collector beside it:

```bash
npm install --save-dev @variance-authority/dom    # collect() a live DOM into a capture
npm install --save-dev @variance-authority/react  # React component ownership per node
npm install --save-dev @variance-authority/png    # comparePngs() two PNGs into a ChangeMask
```

## Entrypoints

Every name lives in exactly one group, and the bare `@variance-authority/core`
specifier holds only the capture artifact.

| entrypoint | holds |
|---|---|
| `core/format` | what a subject *is*: capture, snapshot, document, identity, hashing |
| `core/rules` | the versioned opinions: allowlist, applicability, cascade, canonicalization |
| `core/compare` | two snapshots become deltas — and **no verdict** |
| `core/attribute` | a position becomes a component becomes a file |
| `core/judge` | policy: verdicts, intent claims, ignores, the docket a reader is handed |
| `core/plan` | the whole configuration of a run — profile, ruleset version, viewport, policy, interventions — as one value, plus the identity digest derived from it |
| `core/relate` | what rests on what: a file graph in adjacency form, the components a change reaches, and a closure digest over each one |
| `core/segment` | columnar bytes: named columns, interned strings, and the validation a decode performs before it believes a file |
| `core/share` | leaving those bytes where another machine finds them, under a key that is a commit |

Five of those are the order an answer travels through: `format`, `rules`,
`compare`, `attribute`, `judge`. `plan` and `relate` are asked before anything
is captured — one decides which baselines a run can reach, the other which
subjects are worth reaching for. `segment` and `share` are how a derived answer
is written down and handed to another machine.

## The four words the output uses

A **profile** records what a collector was capable of observing. `jsdom` sees
structure and declared style; `chromium` adds layout and pixels. A profile that
cannot measure a box cannot decide pixels either.

An **identity** is the content hash that addresses a result, derived from the
whole plan — ruleset version, viewport, policy, interventions. Two runs are
comparable only when their identities match, so changing any part of the plan
changes which baselines the run can see.

A **band** is the kind of change a delta is, and which band a delta lands in
decides how loudly it is reported. Change frequency and change importance run
opposite each other: an accessible name almost never moves and is a defect when
it does, while anti-aliasing moves constantly and never matters. There are five,
loudest first:

| band | what moved | example delta kinds |
|---|---|---|
| `a11y` | a role, accessible name, description or ARIA state | `role-changed`, `name-changed`, `state-changed` |
| `geometry` | boxes appeared, vanished, moved or resized | `node-added`, `node-moved`, `rect-changed`, `attribute-changed` |
| `token` | style values moved while structure held | `style-changed`, `token-changed` |
| `content` | text moved and nothing else did | `text-changed` |
| `texture` | sub-semantic rendering variance | `raster-residue` |

`bandOf(kind)` performs that assignment and is the default rather than the
answer — policy may promote or demote per project, subject, region or
component. `loudestBand(bands)` collapses a set to the loudest one present, and
returns `null` for an empty set so that *nothing changed* and *something changed
at the quietest band* stay apart.

A **verdict** is the one word a result carries, and the whole pipeline exists to
produce one with a reason attached. There are six, by severity:

| verdict | means |
|---|---|
| `unchanged` | hash hit, or never reachable from the change |
| `inherited` | fully explained by an adjudication that already happened upstream |
| `authorized` | matches declared intent, or policy auto-approves this band |
| `needs-review` | band and policy require a human to sign off |
| `violation` | policy forbids it |
| `unexplained` | raster residue with no semantic cause — the highest severity here, because a change the pipeline cannot explain means attribution failed |

Beside those sits `UNOBSERVED`, which is what a band reports when the acting
profile could not see it. It is not a verdict and the types will not let you
spell it as one.

## Compare a rendered subject

Excerpt. `capture` and `recapture` are what `collect(root, options)` from
`@variance-authority/dom` returns for the same subject at two revisions; `mask`
is the `mask` field of `comparePngs(before, after)` from
`@variance-authority/png`. Core never opens an image.

```ts
import { normalize } from '@variance-authority/core/rules';
import { diffSnapshots } from '@variance-authority/core/compare';
import { attributeRegions, isolateRegions } from '@variance-authority/core/attribute';

const before = normalize(capture);
const after = normalize(recapture);
const diff = diffSnapshots(before, after);           // deltas and roots, no verdict

const places = isolateRegions(mask, { cell: 8 });    // pixels → regions
const named = attributeRegions(places.regions, after, { scale: 2 });
```

`diffSnapshots` returns `identical`, the flat `deltas`, the `roots` a docket
renders and approves, and the `components` implicated, separated into causes and
collateral — so "`Button` changed, and ten components render it" replaces
"eleven components changed". `attributeRegions` turns regions into components
and files. Choosing a verdict is a separate step, in `core/judge` or in your own
runner.

`scale` is device pixels per CSS pixel and it is required. Attribute a 2x
screenshot at 1x and every region lands in the top-left quadrant with the wrong
component named — a full, plausible, entirely wrong report.

Rendered comparisons throw when the two subjects differ, or when their
observation profiles differ.

### Options that change scope

| call | useful controls |
|---|---|
| `normalize` | `collapseWrappers` removes layout-only wrapper boundaries, `digestText` includes text content, and `sourceRoot` relativizes source locations |
| `isolateRegions` / `attributeRegions` | `cell` and `limit` bound mask work; `origin` and `containment` describe the coordinate origin and how much a node must contain a region |
| `fingerprintOfMask` | `grid` controls the shape sample and `coverage` the minimum occupied share |
| `compareLocales` / ignore validation | `slack` permits a declared locale distance; `sites` supplies resolved ignore locations and `now` evaluates expiry |
| `buildDocket` / dependency reach | `sampleSize` limits review examples; `through` selects graph edge kinds, `avoid` names nodes a walk never enters, and `shadows` carries per file the modules its run never reaches, so `movedBy` leaves out a file every trail to which crosses one of its own shadows; `depends` adds the install — which package rests on which — so a dependency bump is a seed like any other and reaches only the files that import it |
| `beforeReach` | `sensed` names the directories the scan already answers for, and the descent from a declared entry point stops at the first file under one of them rather than dragging the repository's own source in behind the harness |
| `sharedClosures` | `floor` drops a shared subtree below a node count |
| `lexiconOf` | `examples`, `declaredIn` and `regions` supply what the instances cannot: which components a subject is the example of, the files declaring each component, and the regions its journey entered |
| report summaries | `source` maps component names to files when `summarizeAdjudication` or `summarizeFindings` needs an actionable path |
| screenshot stabilization | `animations` and `caret` are explicit intervention settings; omitted means the caller did not assert either intervention |

## Which input moved

`compare` says what changed. `judge` says whether anyone should mind. Between
them, `partingOf` says which input moved.

Given two snapshots carrying holdings — the inputs a collector recorded at each
component boundary — it walks the boundaries for the shallowest one whose inputs
agreed and whose output did not, and reports that as the origin: a moved prop, a
context, an external store, or a hook cell by call position. `explainParting`
turns the result into lines a person reads.

It leads with a slice, so you know whether to open the rest:

| slice | means |
|---|---|
| `settled` | nothing moved: not the tree, not an input, not the output |
| `variation` | an input moved and the output followed — the ordinary case, and the only one where the detail below is worth reading |
| `absorbed` | an input moved and the output did not; the component ignored it |
| `refactor` | the component tree moved and the output did not |
| `reshaped` | the tree is a different tree, no input moved, and the output followed |
| `flake` | every input agreed, the tree held, and the output moved anyway |
| `placed` | the same, but between two readings taken in different places |
| `unread` | the output moved and what would explain it was not read |

`flake` is an accusation against a page, so it is never returned on silence. A
run that recorded no component provenance gets `unread` instead.

## Hand an answer to another machine

What a suite is made of is a fact about a commit rather than about a run.
`core/segment` writes such a thing as columns — equal facts encode to equal
bytes, which is what lets a transport skip an upload — and `core/share` moves
the bytes.

Excerpt: `token` is your store's credential and `bytes` is what `core/segment`
encoded.

```ts
import { httpShare, shareKey } from '@variance-authority/core/share';

const share = httpShare({
  endpoint: 'https://objects.example.com/variance',
  headers: { authorization: `Bearer ${token}` },
  method: 'PUT',
});

await share.put(shareKey({ project: 'web', artifact: 'suite-index-v1', commit }), bytes);
```

`endpoint` is a base URL a key is appended to. `headers` is sent on every
request, which is where a bucket's `Authorization` or a deployment's token goes.
`method` is the verb a write uses — `PUT` for a bucket, `POST` for a deployment
that routes on it. A presigned base needs only the endpoint.

**A share never throws.** A miss, an outage, a permission error and a body
nobody can parse are one outcome: `get` answers `null` and `put` resolves.
Everything a share holds can be derived again, so a broken share costs you the
derivation — and is indistinguishable from a cold one except by the wall clock.
[Sharing an evaluation](https://variance-authority.dev/docs/sharing) is the
operator's side of it.

## What it refuses

**Absent is not empty.** Not measured, measured as zero, and unobservable stay
three distinct states through every type in this package. A band the profile
could not see reports `UNOBSERVED`, and a geometry digest is absent rather than
empty under a profile without layout.

**Two results whose identities differ never compare.** A ruleset bump, a
different viewport, a different intervention — each changes the identity, and
the comparison is refused rather than reported as a difference in the product.

---

**[@variance-authority/core](https://variance-authority.dev/reference/packages/core)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
