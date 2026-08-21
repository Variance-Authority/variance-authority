# Spec 0031 — a contract is a subject, and the detector is somebody else's

**Missing:** any subject that is not a rendered document. `SubjectRef.kind` is
`story`, `route` or `fixture`; `CaptureMaterial` is a document or a raster; the
collector boundary's success arm promises a `RenderDocument` or a sentence saying
why there is none. An OpenAPI description, a GraphQL schema, a route table or a
plain JSON value has nowhere to enter — and the changes they carry are found
today by tools that find them again from nothing on every run, because none of
those tools keeps a record.
**Built on:** [ADR-0044](../context/adr/0044-capture-material-and-rendering-placement-are-independent.md)
(material and placement are independent, which is what makes a third material a
seam rather than a fork), [ADR-0015](../context/adr/0015-a-rule-is-what-a-stored-snapshot-can-decide.md)
(a rule belongs here only if a stored snapshot can decide it),
[ADR-0002](../context/adr/0002-observation-profiles.md) and
[ADR-0012](../context/adr/0012-observability-and-the-damage-boundary.md) (what a
reading could not reach is said, not defaulted),
[ADR-0041](../context/adr/0041-a-request-is-the-edge-a-binding-is-the-name.md)
(a name resolves to the file that declares it, through the re-export chain),
[ADR-0019](../context/adr/0019-one-comment-that-leads-with-causes.md) (one
comment, updated in place), and [ADR-0011](../context/adr/0011-durable-and-ephemeral-retention.md)
(what may accumulate).

## Purpose

A team publishes two things that must not change silently. One is the UI. The
other is the interface other people's code is written against, and it fails
harder: a padding token that moved costs a review, and a response field that
vanished costs everyone who read it, in production, without a screenshot.

**The detection half is solved, by other people, mostly for free.** `oasdiff`
carries about 250 breaking-change checks over OpenAPI, each already qualified by
whether the thing it found sits in a request or a response, and each reported
with the file, line and column it was found at. `@graphql-inspector/core`
classifies every schema change as breaking, dangerous or safe.
[`jsondiffpatch`](https://github.com/benjamine/jsondiffpatch) handles a value
with no schema at all. An earlier draft of this spec proposed a fourth one — a
band table qualifying each delta by position, on the argument that *the same edit
is safe in a request and fatal in a response*. The argument is true. It is also
the first page of oasdiff's manual, and writing it again is not work worth doing.

What none of them has is a **record**. A detector answers one question: *what is
different between these two files, now.* Every question a team asks after the
first week is about time instead.

- I read this change last Tuesday and said yes. Why is it red again?
- This response has changed shape in six of the last thirty runs. Is that a
  migration, or a leak?
- Which line of which file declares the type that moved — not in the schema, in
  the application that generates the schema?
- The checkout button moved and the checkout response changed shape. Is that one
  edit or two?

A diff of two files answers none of them, because each needs an identity for one
change that outlives the run that found it, and a store that outlived it too.
This repository is already that, in a different medium: it mints an identity for
a changed shape, carries an approval against that identity across commits, counts
how often the identity has come back, and resolves it to the binding that
declares it. None of that ever depended on the medium being pixels.

So the position is the one this project already takes with a browser and with
image comparison. **Neither is reimplemented; both are wrapped; what is added is
everything that has to be remembered.** Two consequences follow, and they are the
whole of the argument.

**One docket, one comment, one exit code.** A repository that watches its UI here
and its API with a detector's own CI action gets two dockets, two comments and
two exit codes, and no way to ask whether the two findings are one edit. Nothing
else joins them, because nothing else holds both media. The join is not a feature
bolted onto the report — the report is keyed on a subject and a shape, and an
interface change is a shape that happened to a subject.

**An approval that survives a commit.** Per-change approval carried across
commits is what a detector's paid tier sells, when it is offered at all. Here it
is not a tier and not new code: `accept` already promotes an identity rather than
a file, `variance changelog` already records what was approved and against what
claim, and the recurrence arithmetic already divides by the runs that asked
([ADR-0032](../context/adr/0032-a-flake-rate-divides-by-the-runs-that-asked.md)).
An interface change joins a ledger that exists.

## What would discharge it

**1. A material that is not a rendering.** The acquisition boundary already
routes documents and rasters to one attribution path. A value is the third arm,
and it carries text rather than a parse tree for the same reason the raster arm
carries bytes: every reader that understands a dialect is somebody else's
dependency, `core` carries none, and a stored parse is a parse that reader's next
version disagrees with.

```ts
/** Proposed: the third arm of `CaptureMaterial`. */
interface ValueMaterial {
  readonly kind: 'value';
  readonly value: CapturedValue;
}

interface CapturedValue {
  /** How to read the text: `json`, `openapi`, `graphql`, `route-table`. */
  readonly dialect: string;
  /** The canonical serialization — byte for byte what the digest was taken over. */
  readonly text: string;
  readonly digest: Digest;
  /** The normalization ruleset this text was produced under. Part of the digest. */
  readonly recipe: string;
  /** What emitted it. The environment key for this material, when there is one. */
  readonly generator?: { readonly name: string; readonly version: string };
}
```

The canonical form is not new work: `canonicalize` already sorts keys by code
unit, formats numbers identically on every machine, omits `undefined` rather than
nulling it, and refuses a non-finite number instead of hashing a broken
measurement. What is new is the digest domain — `value/v1` over the text and the
recipe — so that a normalization rule changing is a new identity rather than a
silent re-reading of an old one.

**`SubjectRef.kind` gains `value`, and that is a fourth member rather than a
reuse.** The word this project would reach for is already taken: `route` means *a
page rendered at a URL*, produced by the route collector. A
route **table** — the paths an application publishes, with their methods and
parameters — is a value about the same thing, and a subject list where one word
means both is one nobody can filter. So a route table is `kind: 'value'` with
`dialect: 'route-table'`; the medium lives on the material, where the medium
already lives.

The narrowing sites are three, and none of them is a compile error:
`packages/unit-test/src/archive.ts:83`, `packages/unit-test/src/collector.ts:34`
and `packages/observe/src/capture.ts:43` all test `=== 'document'`, so a third
arm passes typechecking and is dropped at runtime by every one of them. That is the shape of this work: not errors to fix, refusals to
write. The one union whose widening is load-bearing is the collector boundary's
`ok: true` arm, which promises a `RenderDocument` today.

**2. The untyped floor, and the call an adopter makes.** Any value is a subject
before any dialect is: a config file, a generated manifest, a recorded response,
a route table. It ships first because every dialect degrades to it, and because
it is the only part that needs no third-party reader at all.

```ts
/** Proposed: in `packages/unit-test`, beside `capture`. */
function snapshotValue(value: unknown, options: SnapshotValueOptions): Promise<string>;

interface SnapshotValueOptions {
  readonly subject: string | SubjectRef;
  readonly directory: string;
  /** Defaults to `json`. */
  readonly dialect?: string;
  /** Paths whose values are volatile. Recorded as present, never compared. */
  readonly drop?: readonly string[];
  /** Paths whose values become a stable token before the digest is taken. */
  readonly replace?: Readonly<Record<string, string>>;
  /** For an array of records, the member that identifies a row. */
  readonly arrayKey?: Readonly<Record<string, string>>;
}
```

`arrayKey` is load-bearing and not a convenience. An array compared by index
reports a row inserted at the top of a two-thousand-row list as two thousand rows
having changed, which is the same failure as forty red screenshots for one edit,
in a medium where nobody can see it at a glance. Keyed, it is one insertion.

**It writes a capture and returns its path. It does not compare, and it does not
throw.** That is deliberate and it is the existing contract: `capture` does not
compare either, because the baseline is not present in a unit-test process and a
comparison written there would be a second, weaker copy of the run. The loop is
`variance run`, which the adopter runs locally with the same arguments CI runs —
a value subject gets exactly the loop a DOM subject has, and inventing a
different one for this medium would be the drift, not the fix.

**3. An identity that outlives the detector.** Every change gets a
content-addressed, domain-tagged id, minted here rather than taken from whatever
found it.

```ts
/** Proposed: minted from what the change *is*, never from how it was described. */
interface ChangeRecord {
  /** `digestCombine('interface-site/v1', [subject, dialect, pointer, positions])`. */
  readonly site: Digest;
  /** `digestCombine('interface-change/v1', [site, kind, band])`. */
  readonly fingerprint: Digest;
  /** The detector's rule name, reported and never hashed. */
  readonly rule: string;
  /** JSON Pointer into the document. Present or absent; never a placeholder. */
  readonly pointer?: string;
  readonly band: string;
  /** Where the declaration lives, when a reader resolved one. */
  readonly file?: string;
  readonly line?: number;
}
```

What the digest excludes is the point: the detector's rendered sentence, its
severity spelling, its version, and its own fingerprint. A detector is free to
change all four and does — so an approval keyed on any of them expires the day
its dependency is upgraded, which is precisely the failure a durable ledger
exists to prevent.

**4. One docket, which needs a second join.** `clusterChanges` groups changed
subjects by the fingerprints of their `regions`, and a subject whose regions
carry none goes to `ungrouped`. A `RegionRecord` is a rectangle — `x`, `y`,
`width`, `height`, `pixels`, all required — so a value subject can only join that
index by filing four lies and a zero. It would report as one docket in the sense
that it is one file, and in no sense a reviewer would accept.

So `ObservationRecord` gains `changes?: readonly ChangeRecord[]`, and
`clusterChanges` reads its fingerprints from the regions **or** the changes. The
`settles` arithmetic is unchanged and stays correct: a subject is settled by a
fingerprint exactly when every change it carries has that fingerprint, which is
the same sentence the region path already uses. One optional field and one branch
buys the sentence the purpose section is built on.

**5. Readers wrap detectors.** The reader is a package per dialect, named for the
artifact it reads, because `core` carries no third-party dependency and every
dialect arrives through one.

- **`packages/json`** — the untyped floor over `jsondiffpatch`. HTML
  and Markdown are values it will accept and will report as a whole-document
  replacement, not a text diff, until somebody wants the text-diff bundle and
  says so.
- **`packages/openapi`** — spawns `oasdiff` and consumes its output,
  *including the positions it already reports for both revisions*. Rebuilding
  those from a second YAML parse would be a worse copy of something already in
  the process's stdout.
- **`packages/sdl`** — the GraphQL reader. Not `packages/graphql`:
  `tools/boundaries.check.ts` refuses a package that shares a hyphen-separated
  word with one of its own third-party dependencies, and a GraphQL reader depends
  on npm `graphql`. It is the `playwright` situation exactly, and `sdl` names the
  artifact rather than the library.

**Each side is located against the document that contains it.** A removed field
exists only in the baseline, so a reader that resolves every position against the
new revision cannot locate a breaking change at all and will report the first
line of some file instead. Stated here because it is the one implementation
detail that decides whether the `file:line` in a report is worth reading.

**6. What a report says when a band does not apply.** A profile that could not
read a band reports `unobserved`, and must keep doing so. A band that *cannot
apply* — `geometry` on a schema — is neither observed nor unobserved, and
printing `unobserved` for it turns a category error into a permanent yellow line
in every report. Band applicability becomes a property of the subject kind,
intersected with `observableBands` rather than replacing it. The two failures
this keeps apart: a swagger file that claims a layout regression went unmeasured,
and a Chromium run that quietly stopped reporting `a11y`.

**Acceptance:** three fixture pairs, each a two-revision run, and one of them is
the whole spec.

- A JSON value changes in one path. The run reports it beside a DOM subject in
  one report, with one exit code, and `variance changelog` records the approval
  against the change's own fingerprint.
- The same value is presented again, unchanged, in a later run against a later
  commit. It is `unchanged` — because the approval was keyed on the identity and
  not on the revision, which is the thing a detector re-run cannot do.
- A row is inserted at the top of a keyed two-thousand-row array. The docket
  names one change.

## The untyped case, and what it may conclude

Without a schema there is no request or response position, so there is no
direction, so **compatibility cannot be decided**. What remains is real and
smaller: a canonical form, a digest, a structural delta naming the paths that
appeared, vanished or changed type, and a grouping by path prefix.

An untyped subject may never be **inferred** into `authorized`: no compatibility
rule may promote it, and the ceiling policy alone can reach is `needs-review`.
Inferring one — *a key was added, additions are safe* — is precisely the guess
that lets a required field appear in a request body and pass. A *declared* intent
is a different producer and stays legitimate: an agent that says it regenerated
the manifest is answered against what it claimed, exactly as it is for a
component. ADR-0015's test settles it: a stored snapshot can decide *this path
changed type*; it cannot decide *your callers survive it*.

**Values are never stored beyond the subject's own canonical text**, and the
adopter chooses that text. A recorded response carries customer data, retention
is a decision this project must not make on an adopter's behalf, and `drop` and
`replace` exist so the choice is written down in the test rather than discovered
in a baseline.

## What it is not

- **Not a detector.** No breaking-change rule is written here. A dialect that has
  no reader degrades to the untyped floor and says so; a dialect that has one
  reports what the detector found, under identities this project minted.
- **Not contract testing.** Nothing is executed against a provider, no consumer's
  expectations are recorded, and no mock is generated. This compares two
  descriptions; Pact-style tools compare a description to a running system.
- **Not a linter.** Style, naming and completeness rules belong to the tools that
  already do them well; every rule here needs two revisions.
- **Not runtime validation.** A response that violates its own schema is a defect
  in the service, found by asserting against the schema, and invisible to a
  comparison between two schemas.
- **Not a client-impact claim.** The system knows which of *this repository's*
  callers a change reaches. It knows nothing about the mobile app shipped six
  months ago, and a widened response is reported at its band rather than
  adjudicated against clients nobody enumerated.
