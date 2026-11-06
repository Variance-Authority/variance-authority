# A copy keeps what it needs

**Date:** 2026-10-28

An agent asked for a feature writes it, even when a function that answers
already exists. The two detectors this repository had, `clones.mjs` by shared
tokens and syntax and `owners.mjs` by the commands, files and idioms it lists,
caught 15 of 54 such copies read out of `main`'s history. The other 39 were
written in their own shape: other names, another order, another style. What a
copy cannot rename is what it needs, the calls it makes, the fields it reads,
the strings and types it names. `tools/needs.mjs` reads every function as the
set of those needs and names the existing functions that need the same. It
names the owner of 21 of the 44 copied functions, 12 of them copies neither
earlier detector saw, and `yarn test:loop` prints its list after a green run,
while the second implementation is still being written.

## The labels

`tools/needs-measure.json` holds what was read by hand, before this tool
existed, from `main`'s first-parent line up to 94a02988b, 1,457 changes:

- 54 copies: a change that wrote a function, a constant or an inline idiom
  while one that answered existed at its base. Each was confirmed by reading
  the copy and its owner. 44 are function copies, 48 functions between them
  because four changes wrote two; 4 are constants and 6 inline idioms.
- 39 judged pairs: a sample of what an earlier probe named on ordinary changes,
  each read and called `reuse` (the existing function answers), `family` (the
  same question, answered another way) or `unrelated`. They were sampled from
  that probe's output, not from this tool's.
- 57 sampled pairs: names this tool printed on ordinary changes, ordered by the
  SHA-1 of each pair, so nobody chose them. The measurement reads the first 40
  it prints; 57 are labelled because the measure and the files read changed
  after the first 40 were read, and 17 pairs moved into the first 40. Three
  judges read each pair blind, with the two functions and neither the share
  nor the other judges' verdicts, and the majority labelled it: `reuse`,
  `family` or `unrelated`, as above.

## Method

A unit is a named function, method, arrow, function-valued property or
top-level constant, in the package sources, the scripts at a package's root and
`tools/`; tests, checks, declaration files and configuration are not read. Its
bag holds one token per need, by class: `call:` for each callee and its member
chain, `str:` and `re:` for literals, `prop:` for each field read, `type:` for
each type named, `imp:` for each binding imported from a package, `word:` for
each word of the identifiers inside, and `name:` for each word of its own name.
The words are `tokensOf`'s, the tokenizer `@variance-authority/mcp` locates
subjects with: camel case and separators split, the unsplit compound kept, a
trailing `s` dropped from words of four letters or more. A relative import adds
nothing a path would not. A need counts once, however often the unit holds it.

Each need weighs `rarity(N, df)`, the integer weight `@variance-authority/mcp`
already ranks by: 1,000 for a need no existing unit holds, falling in a
straight line to 0 for one every unit holds, with N and df counted over the
existing units. Two units share the weight of the needs both hold over the
weight of the needs either holds, a weighted Jaccard index, in thousandths
rounded down from integers, so a tie is a tie on every machine. Ties break by
path, then name, then line, in code-unit order.

The tool asks about a function new on the branch, one whose name its file did
not hold where the branch left `origin/main`, when it holds 5 needs or more and
is not a constructor. It names at most 3 existing units at a share of 450 or
more. Existing means every unit in the working tree that is not new: a
function gone from the tree is not one to call.

A labelled copy is compared with every unit at its change's base, the code its
author had. The rate at which it speaks is read as a branch would be: the
functions new at a change, against every other unit at it. That was measured
on every fourth change of the same line, 365 changes, with the labelled copies
left out. Its denominator counts every new function, small ones and
constructors included; the line `yarn test:loop` prints counts only the ones
it asks about.

The first version weighed by log inverse document frequency and compared by
cosine at a share of 600, chosen on the copies whose id hashes to the even half
by SHA-1, with the odd half not looked at until the threshold was fixed. It
spoke for 12% of new functions on unlabelled changes. Every measure since takes
its threshold by one rule that reads no copy: the lowest multiple of 25 at
which it speaks for at most 12%. For this one that is 450; the odd half names
7 at both. Only the threshold was held out: the token classes, the floor of 5
needs, the weight and the variants below were compared on every copy, so the
odd half's recall is an upper bound.

## Results

| Copies whose owner it names | |
| --- | --- |
| Functions | 21 of 44 (48%) |
| Functions, even half | 14 of 24 (58%) |
| Functions, odd half (held out) | 7 of 20 (35%) |
| Constants | 0 of 4 |
| Inline idioms | 0 of 6 |
| Caught by an earlier detector | 9 of 15 |
| Missed by both earlier detectors | 12 of 39 |

On ordinary changes it names a neighbour for 324 of 2,911 new functions, 11%,
and prints 466 names. Of the first 40 of them, 20 are `reuse`, 17 `family` and
3 `unrelated`. The halves differ by 23 points on 24 and 20 copies, and the odd
half is an upper bound, so the recall to expect on new copies is a third or
less, not the 58% of the half the threshold was first chosen on.

Of the 39 judged pairs, the tool asks about 23. Of the other 16, 11 are in
files it does not read, package scripts and an example, and 5 are constants and
a constructor. Of the 23 it names 13:
5 `reuse` and 8 `family`. A `family` name is the place to look, not a false
alarm: the same question, answered another way.

The 8 `reuse` pairs it does not name were judged against the change's base;
the tool reads the tree the change leaves. Read by hand, 5 of those changes
moved the body into the new function and left the old one calling it, so the
old one keeps little of what it needed. That is the refactor to want, and
there is nothing left to name. One edited the neighbour as well, and its share
fell from 846 to 285. The other 2 share 382 and 348 with their neighbour even
at the base.

## What it does not see

- Constants and inline idioms. A constant's bag is its value, which is too
  small to tell a twin from a coincidence, and an idiom is no unit at all.
  Both stay `owners.mjs`'s, by the idioms it lists.
- A function with fewer than 5 needs: a one-line helper is cheaper to read
  than to rank.
- A copy or an owner outside the files it reads: a script under a package's
  `scripts/`, a test, a check, `site/` or `examples/`. 7 of the 44 copied
  functions have one side there, 6 of them the `tracked` helper copied from
  one package script to the next and into two checks.
- An owner whose needs moved on: a copy of what a function did two releases
  ago shares little with what it does now.
- An owner written in Rust. It reads TypeScript and JavaScript only.
- A second path written inside a function that already existed: only functions
  new on the branch are asked about.
- Two new functions on one branch that copy each other. Each is compared with
  what existed, never with the other.
- A new function whose name its file already held, a second method of that
  name in another class of the file: a unit is new by its path and its name.

## Tried and dropped

Each is `node tools/needs-measure.mjs` with the one edit to `tools/needs.mjs`
it names and `SHARED` at the lowest multiple of 25 at which it speaks for at
most 12%. Only the copies and the rate are quoted: the sampled names were read
for this tool's output, not for a variant's.

| Variant | Share | Functions named | Held out | Speaks for |
| --- | --- | --- | --- | --- |
| This tool | 450 | 21 | 7 | 324 (11.1%) |
| Cosine of the same weights, exact in integers | 625 | 21 | 7 | 329 (11.3%) |
| The first version's cosine, weighted by how often a unit holds each need | 675 | 21 | 7 | 328 (11.3%) |
| Without `word:` and `name:` | 450 | 10 | 3 | 349 (12.0%) |
| An identifier splitter of its own in place of `tokensOf` | 475 | 21 | 7 | 316 (10.9%) |
| log ((N + 1) / (df + 1)) + 1 in place of `rarity` | 400 | 22 | 7 | 344 (11.8%) |

Every variant that keeps the words names 7 of the 20 held out; what differs is
on the half the threshold was first chosen on. The measure and the weight were
chosen for what they are, not for recall: the Jaccard index needs no square
root to stay an integer, and `rarity` and `tokensOf` were the project's
already. Log idf names one more copy of the even half for 20 more functions,
and `Math.log` is not correctly rounded, so its ties would differ between
engines. Without the words, fewer functions reach 5 needs, so it asks about 17
of the judged pairs and names 5 `reuse` and 6 `family`. A copy renames itself,
but the words of what it reads stay.

A same-name lead, which names every existing function in another file whose
name is the new one's, names 19 of the 44 copies, 8 held out, and speaks for
777 new functions, 27%. Joined with the bag it names 22, 8 held out, for 893,
31%: one more held-out copy for nearly three times the noise.

`variance ask search`, asked with each copy's name and the first sentence of
its doc comment, finds owners the bag does not, mostly ones that share a word
of the copy's name. It was asked of today's index, which holds docs written
after the copies, so its recall is not comparable with the bag's at each
copy's base. It is a second lead worth joining, measured at the base, on its
own branch.

## On its own branch

Its first runs on this branch named its own functions, and three were true
copies, now imports:

- `isFunction` in `needs.mjs`, against the one `owners.mjs` holds; `needs.mjs`
  now imports it, with `isSource` and `lines`.
- `run` in `needs-measure.mjs`, against the git runner `needs.mjs` holds; the
  measurement imports `needs.mjs`'s `git`.
- `walk` and an inner `visit` in `needs.mjs`, which re-typed `visit` in
  `owners.mjs`, the depth-first walk over oxc's nodes. The list did not name
  these, the share was below the threshold; a review did, and `variance ask
  search`, asked for a depth-first walk over every node of the parse tree,
  ranks `owners.mjs`'s first. `owners.mjs` now exports `visit`. Reading the
  units through it showed the old walk took a constant declared in a block or a
  loop for the module's; a constant is now the module's only where a statement
  of the module declares it.

What it names on the branch now, 7 of the 40 new functions it asks about, is
left as it is:

- `mergeBase` in `needs.mjs`, against the private `mergeBase` of sense's
  `stands.ts`. The CLI's `since.ts` and `share-lines.ts` each hold a private
  one too; no package publishes it, and publishing one is a change of its own.
- `git` in `needs.mjs`, against the git runners `site-reach.mjs`,
  `bundle-carried.mjs` and the CLI's `since.ts` each write for themselves.
  Joining them is a change of its own.
- `listed`, the non-empty lines of git's output, against `lines` in the CLI's
  `clone-cut.ts`, the same line of code, private to its file. No package
  exports it, so it stays a copy until one does, with the git runners.
- `text` in `needs.mjs`, a file read under the root, against the same read
  inside `owners.mjs`'s `sites`: one call, local to each.
- `keyOf`, `share` and `half` in `needs-measure.mjs`, against keys, percentages
  and digests private to other packages, built from other parts and printed in
  other formats. All family: the answers they need differ, and no neighbour can
  be imported.

## Prior art

Marcus and Maletic (ASE 2001) found "concept clones", code implementing one
concept in different syntax, by latent semantic indexing over identifiers and
comments: a bag of words compared by cosine, which is this method without the
calls, fields and types. Juergens, Deissenboeck and Hummel (CSMR 2010) named
behaviourally similar code that is not syntactically similar a "simion", and
found that clone detectors miss most simions among independent implementations
of one specification, which is what `clones.mjs` did here.

## Cost

On an M4 Max with Node 24.21, the load under the core count, reading the list
alone takes 0.56 s with its cache warm and 1.5 s on the first run after the
reader changes, Node's start included, as the amendment to
[ADR-0096](../adr/0096-the-edit-loop-answers-for-one-edit.md) records. The
cache holds each blob's bags, 6.4 MB for the repository.
`node tools/needs-measure.mjs` takes about 40 s and peaks at about 1.4 GB.

```bash
# The list alone; remove node_modules/.cache/variance-authority/needs.json first for a cold run
time node tools/needs.mjs
node tools/needs-measure.mjs     # the Results, from tools/needs-measure.json
```
