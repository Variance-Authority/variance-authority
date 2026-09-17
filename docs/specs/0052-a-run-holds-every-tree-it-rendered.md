# Spec 0052 — a run holds every tree it rendered

**Missing:** a bound. `variance run` keeps the full normalized tree of every
subject it captures, from the moment the subject is collected until the report is
composed at the end. Peak memory is therefore subjects × tree, and a tree is the
largest thing the loop touches. On a five-hundred-route suite the run does not
get slower or coarser — it dies.

The array beside it already knows the rule. `retained`, which holds snapshots for
declared variations, is bounded before the loop starts by
`variationsWanted(plan, config.names)`, and says why
(`packages/cli/src/commands/run.ts`):

> Subjects some other subject declared itself a variation of, plus the variations
> themselves. Both halves are needed and neither is the whole run: a suite of
> three hundred subjects holds three hundred normalized trees to compare four of
> them otherwise, and the tree is the largest thing this loop touches.

`compositions` does exactly the thing that comment refuses, unconditionally, for
every subject. Its own comment is the defect stated precisely:

> Carried so a divergence can name the input that moved, which needs the
> documents and not the digests. It does not outlive this array.

The snapshot does not outlive the array. The array outlives the run.

## 1. What a tree costs, measured

One page of the Docusaurus website — `blog/preparing-your-site-for-docusaurus-v3`,
5,131 nodes, captured through `@variance-authority/route-collector` in `directory`
mode at 1280×800:

| | |
|---|---|
| snapshot, serialized | 29.01 MB |
| `root` | 26.34 MB |
| — node `provenance` | 14.75 MB (2.9 KB per node) |
| — node `style` | 9.96 MB (399,069 keys — 78 longhands per node) |
| — everything else per node | 1.1 MB |
| `styleProvenance` | 2.67 MB (19,933 rows) |
| live heap for that one subject | 102.5 MB |

None of it is design tokens: that root carries zero custom properties, so the
per-node duplication is the longhand allowlist and the owner chain, both repeated
in full on every descendant.

The whole-run slope, same suite, 502 routes, one subject at a time:

| subjects captured | resident |
|---|---|
| 75 | 4,439 MB |
| 121 | 7,060 MB |

57 MB per subject, linear, which puts the full suite at roughly **28.8 GB**. At
Node's default heap the run dies after 137 subjects and 455 seconds with
`Ineffective mark-compacts near heap limit`. There is no configuration of this
machine that finishes it.

## 2. Two readers, and they are not alike

`SubjectComposition.snapshot` is read in exactly two places.

**The lexicon** (`packages/core/src/attribute/lexicon.ts`) walks the tree once and
reduces it to nine string sets and an ordered `Landmark[]` — no `style` map, no
`attributes`, no `tokens`, no children. Nothing in that walk depends on another
subject. It is a pure per-subject fold, the same kind of thing as
`componentInstances`, which is *already* taken in the worker for precisely this
reason. It is in the wrong place, and moving it costs nothing: set union is
commutative and the same filter applies on either side, so `terms`, `elided`,
`landmarks` and `boundaries` come out identical.

**The parting** (`packages/core/src/attribute/divergence.ts`) is the hard half.
`partingsOf` lifts `rendering.sites[0]` of each rendering of a divergent props
class and compares the two boundaries node by node, and `boundarySnapshot`
projects nothing — it copies the subtree whole, because that is what
`compareTrees` is. So the fields needed are *all of them*, and the nodes needed
are chosen by `sites[0]`, which is a cross-subject ordering fact. A subject in
isolation cannot know whether it will be asked.

What it *can* know is bounded by something small: every input to that
selection — the props class, the rendering count, `fromOneInput`, the site
order — is folded from `instances` alone, with no snapshot anywhere. The demand
is a short list of `(subject, path)` pairs, usually empty, and it is computable
without holding a single tree.

## 3. Four ways to bound it, and what each one costs

**Drop the snapshot.** Peak becomes one subject's worth. It removes
`Divergence.partings`, which is the only explanation in the report that needs no
baseline, and the file is explicit that its absence means *has not looked* rather
than *found nothing*. One report field, permanently, for every suite — including
the small ones that could afford it.

**Spill each snapshot to disk and read back what the fold asks for.** Preserves
every field. It also writes 15–29 MB of JSON per subject — about 10 GB per run of
this suite — to serve a demand that is usually zero, and `packages/store` has no
blob facility to borrow: the render cache is `Raster`-shaped end to end and keyed
by document digest. The tax is universal and the benefit is rare.

**Retain a per-subject over-approximation.** The safe one is *the first site of
every distinct rendering I hold*, and those subtrees nest — the shallowest
attributed boundary of a route is very nearly the whole route. It saves nothing.

**Ask for the sites after the fold names them.** Fold the instance-only subjects,
which is cheap and already happens twice (`compositionOf` and `examplesOf` both
call `composeSubjects`), take the `(subject, path)` list out of it, and collect
just those subjects again to lift their boundaries. Peak becomes one tree plus
the demand. It preserves every field, and it buys that by trusting a second
render of a handful of subjects to be the same render — which is the claim this
product already makes with `again`, and the one place it would now be load-bearing
for a *report field* rather than for a verdict.

The fourth is the one to take. It is also the one that needs a decision this spec
does not have the right to make alone: whether a parting explanation may be
computed from a second reading of a subject, and what the report should say when
the second reading disagrees with the first.

### Sharding is not the fifth way

The mitigation available to an operator today is `variance run --subjects <glob>`,
which leaves the plan whole and skips the collection of everything the glob misses,
so each slice reports the subjects it did not observe rather than losing them. It
bounds a run. It cannot cover a suite: `--subjects` takes one glob, matched by
`matchesGlob` in `packages/cli/src/commands/collector.ts`, which understands `*`
and `?` and nothing else — no list, no alternation, no negation. The 502-route
Docusaurus website has eleven pages at its root (`index.html`, `404.html`,
`search.html`, `versions.html` and the rest) that share no prefix with each other
and no prefix that does not also match the whole suite. There is no set of globs
that partitions it, so an operator who shards either writes a glob per page or
stops watching the pages no shard names.

That is worth recording next to the defect because it is the reason the defect
cannot be pushed onto the caller. If `--subjects` accepted a list, sharding would
be a real answer for a suite this size and the bound below would be a performance
question rather than a ceiling.

## 4. The recording path has the same defect

`readings` is filled from the same snapshot for every subject whenever a run has
both an identity and a configured history, and is held until the record is
written. Bounding `compositions` alone caps peak memory at whatever
`config.history` costs — which is the same number. Both references have to go, or
neither is fixed.

## 5. What this is not

It is not the rasters. `packages/cli/src/commands/images.ts` reads each raster
from the disk-backed render cache, writes it and drops it, and the file already
argues why holding two PNGs per subject "is the shape that makes this tool
unusable on a real suite". That part was done. The trees were not.

It is also not an argument for a smaller snapshot. 78 longhands and a 2.9 KB
owner chain per node is what the comparison is made of, and interning the
repeated halves would move the constant without touching the slope. A suite twice
this size would reach the same wall twice as fast.
