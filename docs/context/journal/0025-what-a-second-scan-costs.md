# 0025 — What a second scan costs, and whether it wants to be Rust

**Date:** 2026-08-13
**Question:** [ADR-0038](../adr/0038-a-change-reaches-a-component-through-files.md)
puts a source scan on the path of every run that selects. The target is a
frontend of 200,000 files and 14 million lines, where a cold pass is minutes and
nobody enables it. Two things needed measuring before the design could be
defended: what a *second* scan costs, and whether the JavaScript in it is the
constraint — which is the gate
[ADR-0004](../adr/0004-defer-native-acceleration.md) set for reaching for a native
implementation.

## The reproduction

```bash
yarn workspace @variance-authority/oxc bench
```

One Mac, one sitting, two runs back to back. The tree is generated and committed
to a real repository — 10,000 components, each bringing a leaf, a stylesheet and a
barrel share, for **30,500 files and 40,479 edges**. It has to be a real
repository: the digests being measured are git's own, and a tree with no `HEAD`
takes the cold path in every arm without saying so.

Four arms, because any two of the three mechanisms still leave a full pass:

| arm | run 1 | run 2 | what it did |
|---|---|---|---|
| `git ls-tree` + `status` | 97 ms | 95 ms | 30,501 digests, no file opened |
| cold — no digests, no cache | 2944 ms | 3002 ms | every file opened, decoded, parsed, resolved |
| warm — parses remembered | 649 ms | 657 ms | nothing opened, nothing parsed; every specifier still resolved |
| reuse — records remembered too | 230 ms | 236 ms | nothing resolved |
| edit — one file rewritten | 245 ms | 236 ms | the diff |

`4.5×` cold with parses remembered, `12.8×` with records too.

## The edit arm is inside the noise, and saying so is the result

One run put the edit at +15 ms over a scan that found nothing to do; the next put
it at −0 ms. An earlier sitting produced +3 and +7, and one produced −2. The `git`
call itself has been seen anywhere from 95 ms to 218 ms depending on what else the
machine was doing.

So the honest statement is not *an edit costs 15 ms*. It is that **a one-file edit
is not measurable against the fixed cost of a scan that reuses everything**, and
the fixed cost is 230–240 ms of which ~95 ms is a subprocess. The claim the
package makes — that a warm scan costs the diff rather than the repository —
survives, and the number that would falsify it is not the edit but the floor.

## Where the saving actually is, which is not where it was expected

Parsing was never the expensive half once it was cached. Between cold and warm,
2,944 ms of parsing and file reading became 649 ms — and the 649 ms that remained
was almost entirely **resolution**, which is per-specifier, hits the filesystem,
and is not a function of any single file's bytes.

That is why the record cache exists at all and why it is keyed the awkward way
([ADR-0040](../adr/0040-git-already-named-every-files-content.md)). Caching a
parse by content digest is the obvious move and it leaves three quarters of the
warm cost on the table. Caching the *record* — the edges — needs a key that
survives the fact that the same bytes can legitimately resolve differently, and
that key is a digest over the repository's path set.

## The Rust question, answered against ADR-0004's gate

The question was put directly: this is JavaScript, what would Rust change, and do
we need that extra second?

There is no extra second left to need. The path a real run takes is the reuse arm,
and the reuse arm is 230 ms, of which:

- ~95 ms is `git`, a subprocess, and identical in any language;
- the rest is a directory walk and two map lookups per file.

Nothing in that is parsing, and nothing in it is resolution. A native rewrite
would be competing against `readdir` and a hash lookup, and it would first have to
reproduce `oxc-resolver`'s `tsconfig` paths, export conditions and extension
aliases — a second resolver whose answers must agree with the first.

ADR-0004 defers native acceleration until a recorded benchmark shows the
JavaScript path is the constraint. This is that benchmark, and it says the
opposite: **the expensive half was eliminated rather than made faster**, and the
elimination is a cache key, which is a design decision that a rewrite would have
had to make anyway.

The measurement that would reopen this is the cold arm at 200,000 files. 3 seconds
becomes ~20, and a first run in CI with an empty cache pays it. That is a
different problem — a cold-cache problem — and its answers are a shared cache and
a warm CI image before they are a language.

## What this does not measure

**The real target.** 30,500 synthetic files is an order of magnitude short of the
repository this was designed for, and the shape is uniform in a way real trees are
not: no 4,000-line barrel, no directory with 900 siblings, no `tsconfig` with
forty `paths` entries. The costs that grow super-linearly at that size — sorting
200,000 paths for the layout digest, and the record cache's own JSON — are visible
here as nothing.

**A cold CI runner.** Every arm above runs on a machine with warm page cache and a
local git object store.

**The parse cache across machines.** The claim that a digest-keyed cache can never
go stale implies a CI runner that has never seen this branch still holds an entry
for nearly every blob in it. That is an argument, not a measurement; measuring it
needs two machines and a shared cache, and nothing shares one yet.
