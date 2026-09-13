# Spec 0040 — a baseline in git is a picture and nothing else

**Missing:** the record's own *backend*, and the rule that makes a missing record
survivable. The two file-backed stores take a `recordRoot` and the config takes a
`records` key, so the records already go somewhere version control is not looking
— but they go to a second directory, chosen by the same code that chose the
first, and both halves are still required. So a checkout whose record store is
cold is still read as corruption, and a record that only a database or a CI cache
can hold has nowhere to be.
**Built on:** [0011 §3](0011-storage-and-cache-primitives.md) (nothing goes in the
PNG — this is the same operator's follow-up applied one level out),
[0011 §5](0011-storage-and-cache-primitives.md) (`beside`, which is what puts an
image in a reviewed directory in the first place),
[ADR-0011](../context/adr/0011-durable-and-ephemeral-retention.md) (the identity
partition, which is half of what a lone image still knows),
[ADR-0016](../context/adr/0016-where-a-baseline-is-kept-decides-nothing.md) (where
a baseline is kept decides nothing about the verdict),
[0023](0023-accept-tells-new-from-changed.md) (a precondition, not a neighbour —
see §4).
**Packages:** `@variance-authority/raster` (the contract),
`@variance-authority/core` (the three fields that move together),
`@variance-authority/store` (the file-backed halves), `@variance-authority/cli`
(`accept`, `push`), and the CI action.

## Purpose

The image is the evidence. Everything else a store keeps about it — the document
digest, the fonts the renderer could not find, the components the document
rendered, the marks inspection left — is a record *about* the evidence, and it
moves on runs where the picture does not.

Keep both in the checkout and they churn together. Rename a class, repaint the
identical pixels, and the sidecar moves because the document digest moved: the
reviewer gets a diff with no picture in it. At a few hundred subjects the baseline
directory becomes the noisiest path in the repository, and a directory nobody
reads is a directory that catches nothing.

[0011 §3](0011-storage-and-cache-primitives.md) already settled the inner half of
this question — *a key change with no image change should not rewrite the image* —
and put the churn in the sidecar because a few hundred bytes is cheaper than a
PNG. The outer half is the same sentence with `image` replaced by `commit`:

> If a change did not update an image, it updates no file under version control.

So the split is by lifetime, not by size. **Git holds pixels. The record lives
wherever the run can reach one** — `tribunal` when a deployment is there, an
uncommitted local database for an agent working on one machine, the CI cache for a
pull request. None of those is the working tree, and the update path is the one
Lost Pixel established: a job that finds moved pixels opens a pull request against
the source branch carrying images, and nothing else.

## 1. The union, not the pair

A baseline is one pair under one root, and existence is decided by the pair being
there. Two positions push on that from opposite sides, and they are the same
position:

- **A record with no image is a baseline.** A subject that occupies no pixels — a
  wrapper whose only child went to a portal, a mount with no children — still has
  a document, components and an accessibility tree, all of which compare. `Raster`
  makes the image optional; `pictured` narrows the three fields that move
  together; `occupiesPixels` answers the same question of a record that never had
  bytes in the first place.
- **An image with no record is a baseline.** It is the ordinary state of a fresh
  clone once the record leaves the tree.

Together: **a baseline is a record and an image, sourced independently, and
existence is the union of what the two stores hold.** Not the presence of two
files in one directory.

`readRaster` throws on half a pair, and that reasoning holds for as long as the
halves are one store's pair — a `null` is read as `new`, `new` records whatever
this build painted, and the overwritten image was the only evidence of what the
subject looked like before. Split the stores and the throw has to split with them:
corruption is *one store returning half of its own answer*, and it is no longer
inferable from the other store's silence.

## 2. Two places, and a store that knows what its silence means

The record needs a backend selected independently of the image's, with the
directory backend as one implementation among four rather than the shape the
others are measured against.

**The directory half of this is landed.** `createDurableStore` and
`createLfsStore` take a `recordRoot`, `baselines.records` sets it, and the two
halves of a baseline are now sourced from two path prefixes computed
independently — [`durable.ts`](../../packages/store/src/durable.ts) holds them in
one `Places` value, and the sibling scan that decides `incomparable` moved to the
record root, because a subject with no pixels has no image to scan for. Set
`records` to an ignored directory and the invariant above is true today: a change
that repaints identical pixels writes no tracked file.

What that does not buy is a record that is somewhere other than a filesystem, or
a record that is allowed to be missing. Both halves are still written and still
read, and the placement rules being root-parameterised is exactly why the rest is
an argument and not a rewrite.

```ts
// Proposed. `RasterStore` keeps its contract; what changes is where its halves
// come from, and what a `null` from one of them is allowed to mean.
interface RecordStore {
  read(key: BaselineKey, identity: RenderIdentity): Promise<Omit<Raster, 'bytes'> | null>;
  write(key: BaselineKey, record: Omit<Raster, 'bytes'>): Promise<void>;

  /**
   * Whether a `null` from `read` means *there is no baseline* or *I did not have
   * it*. A database answers `complete`. A CI cache answers `partial`, because a
   * miss and an absence are the same bytes.
   */
  readonly answers: 'complete' | 'partial';
}
```

## 3. A cold record costs approval, and never costs comparison

What a lone image still supplies, with nothing added to any format: `identity`,
from the `v1:<32 hex>` directory it sits in; `width` and `height`, from the IHDR,
with an eight-byte reader for exactly this already shipping at
`packages/png/src/size.ts:26`; and `pictured`, because there are pixels.

What it cannot supply is the record. Take each field in the direction its absence
pushes the run:

| Absent | What the run loses |
|---|---|
| `documentDigest` | The settle shortcut. The subject is rendered and compared instead of skipped — slower, same verdict. |
| `components` | The `--since` narrowing. Absent already means *unknown, never none*, so selection widens to include the subject. |
| `findingMarks` | The inherited-versus-new distinction, so a standing defect reports as new. A false alarm, which is the direction a person can correct. |
| `missingFonts` | The promotion. `push` already refuses a candidate whose sidecar lacks the list, in `packages/cli/src/commands/push.ts` — it may be looked at and never approved. |

Every one degrades toward more work and more review. None degrades toward a green
that was not earned, and that asymmetry is why the record may live somewhere a
clone does not have. Hold every backend to it: **a cold record makes the run
louder, never quieter.**

## 4. The state neither half can name

A pixel-less baseline is *entirely* record. With the record out of the tree, a
fresh clone holds nothing at all for one — and nothing on either side is today's
rule for `new`. That is not a corner case: it is the shape a quarter of Material
UI's unit tier takes.

Git is complete for pictures and silent about everything else, so the rule cannot
be about files:

> A run may answer `new` only when a store that answers `complete` said it holds
> nothing.

Under a `partial` record store, a subject with an image in the tree is still a
baseline. A subject with **no** image and **no** record is *unrecorded*, not new:
reported, and never promoted without a person. That is exactly the distinction
[0023](0023-accept-tells-new-from-changed.md) exists to draw — `--all` promoting a
never-reviewed subject and a just-regressed one identically — which makes 0023 a
precondition for running this on a cache backend rather than a separate
improvement.

## 5. The commit-back stages images and refuses records

The CI action does the reverse: it stages the baseline root and fails on any path
that is not a `.png` or a `.json`, with a comment explaining that the sidecar is
what makes an image a baseline. The guard keeps its shape and inverts its list — a
staged `.json` is the bug it stops.

`restate` gets simpler at the same time. [0011 §3](0011-storage-and-cache-primitives.md)
proposes it as a fourth store verb whose signature structurally cannot carry an
image; once the record has a store of its own it is that store's `write`, and
"cannot carry an image" stops being a convention about a signature and becomes a
fact about which store is being addressed.

## What it forecloses

**Metadata inside the PNG.** Decided in [0011 §3](0011-storage-and-cache-primitives.md)
and not reopened here. The measurement is what closes it: pngjs writes no `tEXt`,
reads none, and strips one on re-encode without erroring, so a field put in the
image would be destroyed by this project's own diff path, silently.

**Making the record optional by making its fields optional.** `components` and
`findingMarks` are already optional and carry a paragraph each saying that absent
means unknown. Widening `missingFonts` and `pictured` the same way would let a
backend holding no record at all report a pixel-less subject as a photographed
green — the exact failure those two fields are required to prevent. The
optionality belongs to the *record*, as one object that is either held or not, and
never to the fields inside it.

**One blob for the whole store.** [0011 §5](0011-storage-and-cache-primitives.md)
rules out collapsing N sidecars into one manifest, because one unparseable index
fails every subject under an identity where one unparseable sidecar fails one. The
rule is per-subject *failure*, not per-subject *file*: a row per subject in a
database keeps the bound, and a single serialized object for the store does not,
whatever it is stored in.

**A verdict that depends on which store answered.** ADR-0016, unchanged. Two
operators with the same images and different record backends may wait different
amounts of time and may be offered different promotions; they may not be told
different things about whether the pixels match.
