# Spec 0037 — a closure per node, at every grain the tree has

**Missing:** a digest over a node *and everything under it* for two of the
three trees a run reads — the fiber and the journey — the grain between a
node's own content and its whole subtree, and the index that lays the three
trees' answers beside each other. The document tree has it:
[`nodeClosures`](../../packages/core/src/attribute/closure.ts) hashes every
`SemanticNode` over its subtree, twice, and `sharedClosures` reports the maximal
subtrees a suite shares ([`composition.md`](../composition.md#the-subtree-that-recurs-at-every-depth)).
The file graph has it: [`closureOf`](../../packages/sense/src/tree.ts) hashes a
node over its whole input closure, cycles condensed, and
[ADR-0039](../context/adr/0039-the-digest-is-the-proof-the-trail-is-the-explanation.md)
says why that digest is the proof. A boundary and a journey region do not, and
on the fiber that is by construction: a component's hash covers its own nodes
and names a hole where a child sits
([ADR-0018](../context/adr/0018-a-component-hash-covers-its-own-nodes.md),
[ADR-0035](../context/adr/0035-a-node-stands-in-every-component-above-it.md)),
so that an edit stays local. The price is that *this whole `Modal`, chrome and
contents, is the one on three other pages* is a sentence no digest can say.
**Built on:** [`closure.ts`](../../packages/core/src/attribute/closure.ts) (the
two document closures, the index, the maximal rule and the held-or-parted
qualification — the shape every tree below repeats),
[`composition.md`](../composition.md) (the join on shared boundaries, and the
echo it reports), [`parting.md`](../parting.md) (the descent this makes cheap),
[ADR-0033](../context/adr/0033-the-component-that-mounted-it-is-not-the-one-it-sits-in.md)
and [ADR-0034](../context/adr/0034-a-divergence-must-survive-the-children-it-excludes.md)
(what a boundary is named for, and what a props digest may not claim),
[ADR-0036](../context/adr/0036-the-fiber-is-a-band-and-a-finding.md) (a value
that moves between two readings of one page is not a digest),
[0024](0024-what-a-prop-controls.md) (the join by hand this would replace
half of), [0026](0026-selection-by-closure-digest.md) (a closure across
revisions needs somewhere to be written down; this one does not).

## Purpose

**Composition joins at one grain, and the tree has several.** The join key is
`rendering` — four digests over a component's own nodes, children named and
never included — so a suite compared to itself answers *which boundaries render
the same* and nothing finer or coarser. Finer: a `<tbody>` of forty rows that
three pages render identically under three different components is three
renderings, because no boundary sits on it. Coarser: the same `Modal` with the
same contents on three pages is one `Modal` rendering and three of whatever is
inside, and the fact that the *whole* recurs is spread across the boundaries
it crosses. A fingerprint already does for a difference what nothing does for a
sameness: it removes position and value from a delta and keeps its shape, so
the same edit across rows and subjects is one key
([`judge/fingerprint.ts`](../../packages/core/src/judge/fingerprint.ts)). A
closure per node is the same move on what did not change — content-addressed,
position-free, at every depth at once — and it turns two of the run's
questions into lookups. *Where else is this* is a map from closure to sites.
*Where did two readings part* is a descent that stops where the closures agree,
which is what `partingOf` does today by comparing bands.

The three trees are not one tree, and the point of hashing all three the same
way is that their answers can be laid beside each other. The document says
what was rendered; the fiber says who rendered it; the journey says which code
ran to do so. A subtree shared in the first and not the second is a layout
recurring under different authors. Shared in the second and not the third is
one component reached by different paths — the finding
[`journeyDivergences`](../../packages/sense/src/test-selection/divergence.ts)
computes region by region, made a key.

### Three grains

The trees differ; the grains do not, and the middle one is the whole of the
difficulty.

| grain | covers | exists |
|---|---|---|
| **own** | a node's content, children as named holes | the component hash, and the block digest on the journey side |
| **placed** | own, and everything this node *put there itself*, to any depth; a hole where something was handed in | no |
| **whole** | everything under the node | `closureOf` on files, `nodeClosures` on the document |

*Whole* is the merkle digest and the proof: two nodes with one whole closure
are the same subtree, and nothing needs to be opened to say so. *Placed* is the
pattern. A `Modal` is ten components of chrome around a `{children}` it did not
write; its whole closure is unique on every page, and its own hash says nothing
about the ten. The placed closure is the chrome to full depth with one hole
where the contents go, and it is the digest that recurs. The rule deciding what
is a hole is already written: ADR-0035 hashes a child as `{boundary: name}`
when this component placed it and as `{slot: null}` when a parent did, read
off provenance's `createdBy`. This spec applies that rule below the boundary
instead of at it, and inherits its honest degradation — a production build
carries no `createdBy`, so *placed* collapses to *own* and says so.

### A branch that changes shape for a reason that is not on the tree

The second middle block is `const data = useContext(Theme)`: a branch that
starts like every other and then changes its shape without an observed reason,
because the reason is beyond observation. Nothing was handed in at a position,
so it is not a hole, and the nodes between the read and the shape it decides
show nothing. The tree holds the *effect* and not the *cause*, and a closure
can only be honest about that division.

What the closure carries is the subscription — the wiring digest names the
context — and never the value: a value moves between two readings of one
unchanged page, and ADR-0036 has already ruled that a digest that moves when
nothing changed produces work. So two such branches have one strict closure and
part on the props-aware one, and the parting is *located* — the lowest node
where the shapes disagree — while the reason is looked for beside the tree, in
the holding. Where the held context digests disagree the parting is explained;
where they agree, or where nothing was held, the finding is the honest one: the
same input, two shapes, a cause not in evidence. That is the divergence
ADR-0034 allows, and the spec adds nothing to it beyond the location.

On the journey tree there is not even the subscription. Presence-v2 records
arrival and nothing else; `useContext` is not a block kind and a probe reads no
value. A branch that changed shape for a reason beyond observation is, on the
journey, two paths that fork at a region with nothing recorded at the fork —
the same fact the document closure states as a parting, one layer further in.
Recording the reason would be a second probe recipe under its own
`INSTRUMENTATION_ID`, and this spec does not ask for one.

## What would discharge it

0. **A closure per boundary, twice, at all three grains.** Over
   [`boundaries()`](../../packages/core/src/attribute/boundary.ts): *strict* —
   the component's declaration identity, its wrapper chain, and the children's
   closures — and *props-aware*, which adds `propsDigest` and the context
   subscriptions. Both at own, placed and whole, with placed read off
   `createdBy` exactly as ADR-0035 reads it. `children` is excluded from the
   props digest already and stays excluded: a child's contribution is its
   closure or its hole, never its serialization twice. The document closure's
   decisions carry over where they apply: a generated id is presence, a
   reference binds at the lowest node holding both ends, and the strict closure
   is the key under which the props-aware one is `held` or `parted`.
1. **A closure per journey region, per observer.** Over
   [`CoverageModule.blocks`](../../packages/sense/src/test-selection/index.ts),
   rebuilt into a tree by `owner`, restricted to the regions this observer
   entered, hashed over `kind`, `name` and `path` — the static identity, so
   that an edit inside a body moves the diff and not the journey. *Whole* is
   the only grain that means anything here: a region places every region it
   encloses, and nothing is handed in.
2. **One index over three trees.** `sharedClosures` files one tree; the
   finding this spec is for lays two beside each other. Each entry carries the
   tree and the grain it was read at, and a site on one tree is joined to its
   site on another through the path the document node and the boundary
   already share. A subtree shared on the document and not on the fiber is a
   layout recurring under different authors; shared on the fiber and not on
   the journey is one component reached by different paths — the finding
   [`journeyDivergences`](../../packages/sense/src/test-selection/divergence.ts)
   computes region by region, made a key.
3. **The measurement.** On `examples/todomvc`, beside the 21 boundary echoes
   composition reports: how many maximal shared closures exist that no boundary
   sits on, how many enclose more than one boundary, and whether any placed
   closure recurs where the whole one does not. If every entry coincides with a
   boundary the grain was not missing, and this spec is discharged by that
   number rather than by code.
4. **The fallback where nothing is placed.** Without provenance — no framework
   reader, a production build, the document tree on its own — the placed grain
   is empty, and the alternative is a longest common run of sibling closures
   between two candidate nodes: a partial match, reported as one, quadratic in
   the candidates. Item 3 says whether it is needed. Built before that number
   exists, it is a second matcher answering a question nobody has measured.

## What it forecloses

- **A closure enters no baseline and no join key that exists.** `rendering`
  stays four own-node digests; the component hash stays own-with-holes so that
  an edit stays local (ADR-0018, ADR-0035). A closure is computed by a run over
  what it already collected and compared within that run — no second render,
  no image, no store, the terms composition set.
- **No value in any closure.** Props values, context values and hook cells
  stay in the holding, beside every hash and inside none (ADR-0036). The
  props-aware closure carries `propsDigest` because that is a digest of what
  was handed and already a stored fact; it does not become a place to smuggle a
  value in.
- **At one commit only.** A closure against an earlier revision is
  [0026](0026-selection-by-closure-digest.md)'s question and needs its storage.
  Here the two sides are two subjects of one run, and nothing is written down.
- **The journey is a path, not a stack.** A region's closure is over static
  identity of regions entered; no call stack is captured, no depth is recorded,
  and a value that chose a branch is not in it.
- **Not a fifth band.** Three trees, two variants, three grains is the surface;
  a variant that does not answer item 5 is removed rather than kept beside the
  others.
