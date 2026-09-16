# Six hundred million crossings were three thousand sets

The relation a snapshot has to answer from is *which tests entered this region*.
Its size is the product of two numbers a repository grows independently, and at
the shape this project is aimed at — two hundred thousand modules, eight regions
each, two thousand test files whose imports reach forty thousand modules apiece
— the product is six hundred and seventy million pairs.

That number is where most people stop reading, and they are right to compute it.
It is wrong only about what has to be *stored*.

```
node packages/sense/scripts/crossings.mjs 200000 2000 8
```

```
graph: 200,000 modules, 521,443 edges, stored as CSR 2.8 MB
closures: 2,000 walked in 0.5s, 83,929,436 module-test pairs (41,965 modules per test)
  as regions: 671,435,488 crossings, 2561.3 MB as bare u32 pairs, 5122.6 MB as pointers
pool: 3,408 distinct sets for 1,600,000 regions in 4.3s
  live: ids 6.1 MB + sets 0.3 MB + offsets 0.0 MB
  stored: sets 0.1 MB + offsets 0.0 MB
  stored answers: agree on all 20,000 probes in 9 ms
  reverse: one test names 254,035 regions in 5 ms

peak rss 134.0 MB against a 600.0 MB ceiling — fits
```

**One million six hundred thousand regions hold three thousand four hundred and
eight distinct answers between them.** Not because the sets were made to collide,
but because of what makes a test reach forty thousand modules in the first place:
it imports a barrel, the barrel re-exports every leaf, and every leaf is
therefore entered by exactly the tests that touched that barrel. The audience is
a property of the barrel, and every module under it inherits it whole. A
repository big enough for the pair count to frighten you is a repository built
out of barrels, which is the same fact read twice.

So the pair count is real and is never materialized. A region stores a `SetId`
into a pool of the distinct sets — 6.1 MB of ids for 1.6M regions — and the pool
itself is 0.3 MB live, 0.1 MB written. The closures above are **walked, not
assigned**: the script builds a barrel-shaped import graph and computes each
test's reachable set, so the sets the pool is handed are the sets that shape
makes, not sets chosen to intern well.

## Why the containers are three and not one

`crossing-sets.ts` picks a container per set by its size — `LIST` of sorted ids,
`BITS` one bit per test, `RUNS` as `(first, length)` pairs. That is not a
compression menu. It is what makes **interning identity byte equality of the
encoding**: container choice is a pure function of the set, so two equal sets
encode identically and one memcmp decides sharing. A pool that chose containers
by anything else — a heuristic, an order of arrival — would have to compare sets
logically, and the comparison would cost more than the sets do.

A whole-suite set costs 5 or 9 bytes, which is why "every test entered this
region" — the case a barrel produces by the thousand — is the cheapest row in
the file rather than the most expensive.

## Where the memory actually went

The arena is one buffer and the index is an open-addressed `Int32Array`, and
both of those are the measurement rather than a preference. A `Uint8Array` per
set with a `Map` from hash to candidate ids costs **989 MB against 510 MB** on
the same worst case: object headers over sets that are five bytes each. The arena
grows through a resizable `ArrayBuffer` (`new ArrayBuffer(n, { maxByteLength })`,
declared locally because the package targets ES2022), because copying to grow
costs 2n at the instant of the copy and that instant was the whole peak.

The impossible case is worth having measured, because it is the one a reviewer
will propose: every one of 1.6M regions holding its own 20%-dense set, nothing
shared with anything. That is 386 MB of containers at **510 MB peak** — it still
fits unsharded at two thousand tests. At five thousand tests it is 960 MB and
needs three chunks of 453 MB, one per process, which is what the `shards` arm
measures.

## Two fixtures, two numbers, and they are not in conflict

`crossings.mjs` builds its own graph and reports **671,435,488** crossings.
`run-fold.ts` cites **826 million** over 103 million module rows, folded inside
450 MB. Those are different fixtures — the first walks a barrel graph it
generated, the second folds a run's journals off disk — and quoting either as
*the* crossing count is how a number turns into a rumour. Each belongs to the
command above it.

## What this does not say

It says the relation can be **built, stored and queried**. It says nothing about
the object model on the way in, which is still a `string[]` of test paths per
region out of `coverageModule()` — 5,816 MB at this shape, paid and then thrown
away at the encoder's door. The pool's win is real and is currently bought twice.
That is [journal 0051](./0051-the-snapshot-fits-and-the-publish-does-not.md).
