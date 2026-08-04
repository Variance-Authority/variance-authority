# Spec 0011 — Storage and cache primitives

**Missing:** three seams — a reduction, a baseline layout, and a lens. Plus one
thing that must *not* be built, recorded here so nobody builds it. A fourth — a
render cache that is not the baseline store — was built on 2026-08-04 and is kept
below as item 1, because what it cost is the useful part.
**Built on:** [ADR-0003](../context/adr/0003-cruft-removal-and-css-applicability.md)
(pruning), [ADR-0007](../context/adr/0007-subject-boundary-is-the-component-tree.md)
(boundaries), [ADR-0011](../context/adr/0011-durable-and-ephemeral-retention.md)
(the identity partition), [ADR-0015](../context/adr/0015-a-rule-is-what-a-stored-snapshot-can-decide.md)
(what a rule may decide), [ADR-0016](../context/adr/0016-where-a-baseline-is-kept-decides-nothing.md)
(where a baseline lives), [ADR-0018](../context/adr/0018-a-component-hash-covers-its-own-nodes.md)
(component hashes).
**Packages:** `@variance-authority/raster` (the contracts), `@variance-authority/store`
(layouts), `@variance-authority/core` (inspectors), and one new package for the
reduction.

## Purpose

Five questions were asked about how an operator configures keys and places. Three
already have answers in the code, and saying which is half of this spec — because
the two that remain are not the two they look like.

| Asked | Already true | Left |
|---|---|---|
| Clean the HTML, match the CSS to what survives | CSS applicability pruning ships in `@variance-authority/dom`: 1007 rules to 1 on the todomvc corpus (ADR-0003). Structural aliasing ships for the *semantic* snapshot. | Nothing reduces the **render** document. It keeps ids and classes deliberately, and its digest churns on both. |
| One global key, or a split by region | Component boundaries and per-band hashes ship, in `packages/core/src/attribute/component-hash.ts:45`. The boundary is the component tree, not an operator's choice (ADR-0007). | Nothing calls it from a run. And a per-region *raster* key is unsound, not merely unbuilt. |
| Where the cache lives — PNG, CI cache, S3, service | **`RenderCache` is its own contract** with its own rule — it never throws — and four backends implement it: a directory under `by-document/`, git-LFS, a wire, and a bucket. | Nothing yet lets an operator *choose* one independently of where baselines live. The seam is open; the configuration is not. |
| Scans, and how they reason about cache | `inspect packages/core/src/judge/inspect.ts:136` ships with nine rules; `compareLocales` adds two; both band as `a11y` (ADR-0015). | The rule set is a closed union, and — the deeper miss — inspection is modelled as a *scan beside* the comparison rather than as a second **lens over the same artifact**. See §4. |
| Where files live | `directory`, `lfs`, `remote` (ADR-0016). | The layout is a private function of one backend, so "next to the component" is unreachable. |

The unifying constraint, and the reason these are one spec: **every item on that
list is a choice about a key or a place, and none of them may change a verdict.**
A seam that lets an operator move where bytes land is ordinary. A seam that lets
them move what a comparison means is the thing this project exists to refuse. Each
primitive below is shaped by which of those it is.

## 1. Reduction — what may leave a document before it is hashed

Two normalizations already exist and they have **opposite contracts**, which is
why neither is the one being asked for:

- `collect()` produces a semantic snapshot, and throws away everything volatile —
  ids become aliases, classes vanish, the cascade is resolved — because the value
  is built to be **compared**.
- `acquireDocument()` produces a render document and keeps all of it, because the
  value is built to be **repainted**, and a selector cannot match a class that was
  normalized away.

The third thing is a **reduction**: a transform whose output paints the same
picture and hashes more stably.

```ts
// Proposed.
export interface Reduction {
  readonly version: string;
  reduce(document: RenderDocument): RenderDocument;
}
```

What makes this a primitive rather than a pile of heuristics is that its contract
is checkable, and the check is already computed on every comparison:

> A reduction rule is admissible only if, across the corpus, every subject renders
> **strict-identical** before and after — `STRICT_POLICY packages/raster/src/policy.ts:39`,
> which is `{ threshold: 0, includeAA: true }`.

Not "within threshold". `unchanged` under the default policy forgives 10% per
channel and antialiasing entirely, and forgiveness is not transitive: eleven
admissible-looking rules each moving a subject slightly compose into a reduction
that paints a different picture, and the digest says nothing moved. Strict equality
is transitive, so rules compose indefinitely.

Candidates, each of which must earn its place by corpus measurement and none by
argument:

- elements whose resolved `display` is `none`, and their subtrees
- `<script>`, `<template>`, `<link rel="preload">` — no paint, no layout
- comment nodes
- attributes no surviving selector reads
- **class names no surviving selector mentions**

The last is the payoff, and it is available *only after pruning has run*. A
CSS-in-JS hash class that no remaining rule names cannot paint, so it can go — and
that removes precisely the churn ADR-0003 was written about, from the half of the
system ADR-0003 could not reach. ADR-0003 solved it for the snapshot by dropping
classes outright; the render document cannot do that, and this is the version of
it that a repaintable document can afford.

**Why a package of its own.** Reducing a *serialized* document needs an HTML
parser, not a live DOM — a different requirement from `@variance-authority/dom`'s,
which is what ADR-0013 says makes a package. It also means the reduction runs
anywhere a document is stored: on a server, months later, with no browser. That is
what makes §3's heal job possible at all.

**What it forecloses.** Reducing on the acquisition side only. A reduction that
runs in the browser cannot be re-run against a stored document, so the day a rule
is added, every stored key is wrong and unfixable except by re-rendering
everything. Over the serialized form the ruleset is upgradeable, which is the
difference between a versioned ruleset and a one-way door.

**Versioning.** `Reduction.version` enters the environment key, so a change is a
mass-invalidation event exactly as `RULESET_VERSION` is. That is the case the heal
job exists for, and this spec is not dischargeable without it.

## 2. Regions — who defines them, and what they are not for

**The component tree defines them; an operator does not** (ADR-0007). A suspense
boundary is a *delivery* boundary — where code splitting and streaming happen —
and it is coarser than, and unrelated to, where paint is decided. The finer
boundary already exists and is already hashed.

The position worth stating before anyone builds against it:

> **A region is not a cache key and cannot be made into one.**

A region's pixels depend on its siblings. A flex sibling that grows moves your
box; a preceding float reflows you; `:nth-child` restyles you. So "`Card` did not
change, reuse its pixels" is false in general, and false in the direction that
produces a confidently wrong image. Of everything on this list, per-region raster
caching is the only item that is *unsound* rather than merely unbuilt, and it is
recorded here so that "we could go finer" stops being an open question.

What regions are for, and what the primitive should therefore deliver:

**Explaining an invalidation.** A whole-document digest says *re-render*. A region
index says *why* — "`Card`'s style hash moved" — which is the sentence this
product promises about a diff, applied to the cache instead.

**Supplying `before` and `causes` on the durable path.** Today both come from the
collector (the contract SubjectSource `packages/cli/src/commands/collector.ts:161`),
so a durable baseline — an image with no document behind it — has neither, and the
docket falls back to ranking by area. ADR-0021 records that ordering as measured
backwards: a container that only reflowed outranks the edit by 6×. Since the PR
comment is the whole review surface when no service is deployed, this is the gap
that costs the most.

The cost of closing it is measured, not estimated: a document is **14.1% of image
bytes** across the fifteen todomvc subjects — 8.2% to 10.5% for page-sized
subjects, about 1KB gzipped each, against 107KB of PNG.

**It does not go in the repository, and the reason is not size.** A document is
derived, it changes on every edit, and it is structured text. Images escape the
usual objection to committing derived state — that it puts a machine-produced
artifact under human merge resolution — because a baseline is never *merged*: a
conflict is settled by taking one side, in seconds, and cannot be got subtly
half-right. **A document does not escape it.** Git will line-merge two
regenerated documents into a third that is neither, and nothing downstream can
tell. Committing it would buy cause-ranking with a class of corruption that the
one file format in the store was chosen to avoid.

So it belongs in the shared cache of §3, **content-addressed by the digest the
sidecar already carries**. That is what dissolves the awkward part — knowing when
to delete. A digest addresses exactly one document, so a cache entry is never
stale, only absent; a branch may write safely because it cannot collide with a
different document; and eviction costs a lookup rather than correctness. Nothing
is ever deleted at the right time, because nothing ever has to be deleted.

The degradation is graceful and must be **stated**: no document, no causes, so the
docket ranks by area — which is today's behaviour, and the report has to say which
ordering it used. A ranking that silently changes meaning with cache weather is
worse than the bad ranking, because nobody can tell which one they are reading.

## 3. Where the cache lives — and why it must stop being the store

This is the structural one, and it blocks the others.

`RasterStore` has five methods and two of them belong to a different object:

| Method | Object |
|---|---|
| `find`, `describe`, `put` | a **baseline** |
| `cached`, `cache` | a **cache** |

They have opposite loss semantics, and one interface can only encode one of them:

- **Losing a baseline is fatal.** `null` means "looked, nothing there", which
  becomes `new`, which re-records whatever is on screen, which destroys the
  baseline this run existed to compare against. So every failure must throw —
  `RasterStoreError packages/raster/src/store.ts:57` and the `REFUSAL` beside it.
- **Losing a cache costs a render.** `null` is the correct answer to every
  failure, including a failure to reach the network.

Welded together, the cache inherits the baseline's paranoia: the remote backend
throws on the cache path too, and its own comment concedes the miss "costs only a
render". That is right given the shared interface and wrong given what a cache is.
A CI cache service answering 503 should cost a render, not a red build.

**Primitive: split `RenderCache` out, and invert the rule.**

```ts
// Proposed.
export interface RenderCache {
  get(digest: Digest, identity: RenderIdentity): Promise<Raster | null>;
  put(raster: Raster): Promise<void>;
}
```

> **A `RenderCache` never throws.** A backend that cannot reach its bucket returns
> `null` from `get` and resolves `put`. That is not laxity; it is the definition of
> the object, and it is safe for exactly the reason the baseline rule is not — a
> cache miss re-renders, and re-rendering is the correct answer.

`RasterStore` then drops to three methods that all mean one thing, and the
operator's list becomes configuration:

| `cache.kind` | Needs | Lost when |
|---|---|---|
| `memory` | nothing | the process exits |
| `directory` | a filesystem | the directory is cleaned |
| `actions` | the CI cache API | the branch is evicted |
| `s3` | credentials | never, until the bill |
| `remote` | a tribunal deployment | the deployment goes |

Every one of those is a legitimate choice *because* losing any of them is free.
None of them is a legitimate baseline store for the same reason.

### PNG metadata: the tension resolves against it

Whether the cache key belongs inside the image was the sharpest form of the
question, and the case against it is the operator's own follow-up — that a key
change with no image change should not rewrite the image.

That case is not hypothetical; it is the normal one. A reduction-ruleset bump (§1)
changes every key and no pixel. If the key is a `tEXt` chunk, healing rewrites
every PNG: a six-figure byte count to change thirty-two characters, and a git diff
the size of the corpus for a no-op. If the key is the sidecar, healing writes a few
hundred bytes per subject and the images are untouched.

So:

> **Nothing goes in the PNG. The image is bytes, and everything about it is the
> sidecar.**

The weaker version of this — key in the sidecar, *provenance* in a `tEXt` chunk,
so an image in a chat thread can still say which machine painted it — was proposed
and then measured against the codec this repository actually has. pngjs 7.0.0 is
the only decoder in the tree, confined to `@variance-authority/png` for exactly
that reason, and it:

- never writes a `tEXt` chunk, even with `.text` set;
- returns `undefined` for `.text` on a file that carries one;
- **strips it on re-encode, with no error.**

A provenance chunk would therefore survive being written and be gone by the time
anything read it — destroyed by `diffImage`, on this project's own diff path,
silently. That failure shape is not hypothetical here. It is the one already
shipped once, when `stabilization` was missing from the identity codec and a
durable workflow could never see its own baseline — every run, forever, with no way
to act on it (`packages/raster/src/store.ts:258`). In-band metadata would
reintroduce it somewhere no test crosses the codec either.

The general form is worth keeping even if pngjs is someday replaced: **a field is
only as durable as the least careful thing that rewrites its container.** A
sidecar is rewritten by code that knows what a sidecar is. A PNG is rewritten by
every image tool anybody runs.

Keeping the key out also preserves the cheap path. `describe` settles a subject
from thirty-two hex characters without decoding an image; a key in the PNG makes
every cheap lookup a codec call, in every backend, including the ones that would
have to range-request it over a network.

### The heal job, its seam, and its precondition

A stored baseline's key may be rewritten when a fresh render of the current
document is **strict-identical** to the stored image — `changed.strict === 0`, and
not `unchanged`.

The distinction is the whole safety argument. Refreshing a key on a
within-threshold `unchanged` reproduces the eleven-approved-2px-changes trap
*inside the cache key*, where no report will ever surface it. Strict equality is
transitive, so a key that has been healed a hundred times still addresses an image
identical to the one first approved.

The seam is a fourth store verb, whose signature **structurally cannot carry an
image**:

```ts
// Proposed.
restate(
  key: BaselineKey,
  identity: RenderIdentity,
  provenance: { documentDigest: Digest; missingFonts: readonly string[] },
): Promise<void>;
```

The same reasoning that keeps `raster` off `Described`: the moment this can take
bytes, a heal can write a picture, and a heal that can write a picture is
`accept --all` under another name. It refuses a key with no existing baseline —
creating one is `put`'s job and inventing one is `new`. Durable and LFS rewrite one
`.json`; remote gains a route; the tribunal does one `UPDATE`; ephemeral refuses.

Healing is a separate command — a `heal` verb the CLI does not yet have — and not
a step inside `run`, because `run` must not write the baseline store: a gate that
records is not a gate (ADR-0017).

## 4. Lenses — and what is actually reviewable

The framing this spec opened with was wrong, and correcting it is the largest
change in it. Inspection was filed as *scans*: a side capability, adjacent to the
comparison, rendered underneath it. It is not adjacent. It is a second **lens** over
the same artifact, and the comparison is merely the first.

Look at what each produces. A ranked region resolves to a component, a file, and a
reason. A `Finding` carries `component`, `owners`, `where`, `what` and a `band` — a
component, a file, and a reason, reached through the same provenance chain. This
project's thesis is that a change resolves to a component and a file rather than to
a pixel count; a defect resolves exactly the same way, and nothing in the resulting
sentence says which lens produced it.

So:

> **Images are not the only artifact held, and they are not the unit of review.
> What is reviewable is the union of what the lenses found.**

Rung 0 of the [setup ladder](../flows.md) is the proof: ephemeral retention stores
no image at all, and still has something to review.

Two kinds of lens, distinguished by what they read.

**Artifact lenses** read a stored snapshot or document — `inspect`'s nine rules,
`compareLocales`'s two, and whatever anyone adds later. Each is a pure function of
something already recorded, so nothing is cached and nothing invalidates. The
payoff is retroactivity: **a lens written today reports on everything ever
stored**, with no re-render and no mass-invalidation event. That is the capability
`inspect` claims over a live-DOM scanner, and it is bought entirely by not caching.

**The raster lens** reads two images. It is machine-bound, so it needs the identity
partition, a store, and a cache — the whole apparatus this spec is about. One lens,
and much the most expensive.

Which gives the real rule, sharper than "an inspector may not read pixels":

> **A lens that reads the raster pays for a machine. A lens that reads the artifact
> is free and retroactive.** Nobody is forbidden the pixels; they are quoted the
> price — and the price is why nine rules ship and no contrast rule does.

```ts
// Proposed.
export interface Lens {
  readonly name: string;
  readonly band: Band;
  look(artifact: SemanticSnapshot): readonly Finding[];
}
```

Contrast stays refused, and an operator's own lens cannot smuggle it in: the
background a glyph is painted on is a stacking fact a snapshot does not carry, and
a rule that is right most of the time about accessibility is switched off after its
second false alarm and takes the working ones with it. That is a statement about
what a stored snapshot can decide (ADR-0015), not about who wrote the rule.

**What this costs the ladder.** Retroactivity reaches exactly as far back as the
artifacts do — in a cache, until eviction; in a service, indefinitely. So *how far
back can a new lens look* is a real difference between rung 2 and rung 4, and a
better argument for deploying the service than storage capacity ever was.

## 5. Where files live — layout as a value

Three backends ship (ADR-0016). Co-location — a baseline beside the component that
produced it — is unreachable today because `pathFor` is private to the durable
store, and `lfs.ts` delegates to it on purpose: *a second copy of that layout is a
second chance to get the partition wrong*, and the partition is all that stands
between a runner upgrade and a day of unattributable red.

That reasoning is correct and the primitive must not break it. So the layout
becomes a value with the partition **outside** it, where nothing configurable can
reach:

```ts
// Proposed.
export interface BaselineLayout {
  readonly name: string;
  /** Never sees an identity. The partition is the store's, not this. */
  leafFor(key: BaselineKey): string;
}
```

The store composes `<root>/<identityDigest>/<layout.leafFor(key)>`. An operator can
put `Button/default.png` next to `Button.tsx`, and cannot put two identities in one
directory, because nothing hands the leaf function an identity to ignore.

**One file per subject, and why that is not a preference.** The obvious way to
make a layout configurable is a manifest — one index per identity directory,
mapping subject to key. It is worse than it looks, and the reason is the blast
radius the rest of the system already fixed. A `RasterStoreError` is the one class
`run` rethrows out of the subject loop, deliberately, so a store that cannot be
trusted stops everything rather than reporting three hundred subjects as `new`;
and exit 2 suppresses both the docket and the baseline commit-back. So one
unparseable index fails *every subject under that identity*, where one unparseable
sidecar fails one subject and ends in a copy-pasteable command. A manifest also
maximises write contention on exactly the file whose damage is widest: any two
pull requests that accept anything both append to it.

Per-subject files are therefore load-bearing, not incidental — they are what bounds
the cost of every failure a metadata scheme can have. A layout may move where the
leaf goes. It may not collapse N files into one.

**The reviewable half deserves the same conflict rule as the image half.** LFS
tracks `*.png` with `-text`, so a baseline image conflict is settled by taking one
side. The `.json` beside it is line-merged, so two accepts of one subject can
produce a sidecar that is neither. Adding `*.json merge=binary` alongside costs two
lines and makes both halves of a baseline fail the same way.

**What co-location costs, stated rather than discovered.** No file path enters
`documentDigest`, deliberately, so moving a story between files costs no re-render.
Co-location breaks that at the storage layer instead: renaming `Button.tsx` orphans
`Button/default.png`, and the next run reports `new` and re-records. The key is
untouched; the baseline is unreachable, which is worse, because a key miss is slow
and a lost baseline is silent. That is why co-location is a layout an operator opts
into with the consequence written down, and not the default.

## What would discharge this

In this order, because each unblocks the next.

0. ~~**`missingFonts` on `Described`.**~~ **Done, 2026-08-04.** `Described` carries
   a fourth field, every backend supplies it out of a sidecar it was already
   reading, `settle` takes a `Described`, and the durable path calls `describe`.
   A run in which nothing moved now reads **no baseline image at all**, which is
   asserted rather than described — the settled-path test counts image reads and
   expects zero. Two things were learnt that the estimate did not contain. The
   full lookup had to move *into* `images`, behind the verdict check, because
   once settling stopped reading images there was no `Found` left to reuse and
   reinstating one for every subject would have given the saving straight back;
   only a `changed` subject, which is about to write a diff anyway, now reads a
   baseline. And the wire had to **refuse** an absent `missingFonts` rather than
   default it to `[]`, because absent and empty are not the same claim: empty is
   a verdict that no font was substituted, and a codec that invents it is the
   `stabilization` failure again. The compiler catches a dropped field; only the
   parity suite catches a hardcoded one, so it has a case for that.
1. ~~**Split `RenderCache` out of `RasterStore`**~~ **Done, 2026-08-04.**
   `RasterStore` has a `renderCache` property instead of two methods, `neverFails`
   holds an implementation to the rule at construction, and the parity suite has
   the cache-loss case: all four backends answer a miss and resolve a write with
   a cache that fails both ways, while still serving a real hit.

   Three things came out of it that the item did not predict. The two tests that
   pinned the *old* rule had written its argument down — *"a store that decides
   for itself which failures are survivable has two rules"* — and that is exactly
   the claim the split refutes: there are two rules because there are two objects,
   and the fix is to put the rule in a type rather than in each backend's
   judgement. Both now assert the same damage getting two answers from one store,
   which is a better test than either was. Second, git-LFS's pointer refusal
   becomes a *miss* on the cache path, which is right rather than a weakening: a
   cached entry that is 130 bytes of pointer is not an image, and re-rendering
   gets the run correct where returning it would compare against text. Third,
   `renderCached` was deleted rather than ported. It had no caller outside its own
   tests, and it carried the identity bug that `observe`'s `renderOnce` was written
   to fix — reading under `renderer.identity` and writing under the raster's, so
   above 1x the cache could never hit its own write.
2. **`BaselineLayout` as a value**, with the identity partition applied by the
   store. Contained in `@variance-authority/store`; the existing path becomes the
   default layout and nothing moves on disk.
3. **The `Lens` seam**, with `inspect`'s nine rules as its first implementation,
   and the review surface leading with the union of what the lenses found rather
   than with the images. The pixels are one lens, not the subject the others hang
   off.
4. **A document cache**, content-addressed by the digest the sidecar already
   carries, so the durable path has `before` and `causes` and the docket stops
   ranking by area — and so a lens written later has something to look back at.
   Measured at 14.1% of image bytes; it goes in the cache and not the repository,
   for the merge reason in §2.
5. **The reduction package and the `heal` command**, together. A reduction ruleset
   with no heal is a mass re-render on every version bump, so neither half ships
   alone. The corpus score is the acceptance: strict-identical renders before and
   after, on every subject, or the rule does not go in.

Item 0 is a bug fix the code has already written the argument for. Items 1 through
3 are seams that already have exactly one implementation, so each is a refactor
with a test that the behaviour did not move. Item 5 is the only genuinely new work,
and it is last because §3's `restate` seam and its strict precondition are what
make it safe to ship at all.

**Measured while writing this, so nobody re-derives it.** pngjs 7.0.0 writes no
`tEXt`, reads none, and strips one on re-encode without erroring — which is why §3
puts nothing in the image. A document costs 14.1% of image bytes across the fifteen
todomvc subjects. Neither number is an estimate.
