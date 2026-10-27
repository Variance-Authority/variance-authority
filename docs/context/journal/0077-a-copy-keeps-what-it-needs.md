# A copy keeps what it needs

**Date:** 2026-10-28

An agent asked for a feature writes it, even when a function that answers
already exists. The two detectors this repository had, `clones.mjs` by shared
tokens and syntax and `owners.mjs` by the commands, files and idioms it lists,
caught 15 of 54 such copies read out of `main`'s history. The other 39 were
written in their own shape: other names, another order, another style. What a
copy cannot rename is what it needs, the calls it makes, the fields it reads,
the strings and types it names. `tools/needs.mjs` reads every function as the
bag of those needs and names the existing functions that need the same. It
names the owner of 21 of the 44 copied functions, 11 of them copies neither
earlier detector saw, and it runs at the end of every `yarn test:loop`, while
the second implementation is still being written.

## The labels

`tools/needs-measure.json` holds what was read by hand, before this tool
existed, from `main`'s first-parent line up to 94a02988b, 1,458 changes:

- 54 copies: a change that wrote a function, a constant or an inline idiom
  while one that answered existed at its base. Each was confirmed by reading
  the copy and its owner. 44 are functions, 4 constants, 6 inline idioms.
- 40 judged pairs: a sample of what an earlier probe named on ordinary changes,
  each read and called `reuse` (the existing function answers), `family` (the
  same question, answered another way) or `unrelated`.

## Method

A unit is a named function, method, arrow, function-valued property or
top-level constant. Its bag holds one token per need, by class: `call:` for
each callee and its member chain, `str:` and `re:` for literals, `prop:` for
each field read, `type:` for each type named, `imp:` for each binding imported
from a package, `word:` for each word of the identifiers inside, and `name:`
for each word of its own name. A relative import adds nothing a path would not.

Each token weighs (1 + log tf) · (log ((N + 1) / (df + 1)) + 1), with the
document frequency counted over the existing units, so a need every function
has weighs little. Two units are compared by the cosine of their weights,
rounded to an integer share of 1,000, so a tie is a tie on every machine. Ties
break by path, then name, then line, in code-unit order.

The tool asks about a function new on the branch, one whose name its file did
not hold where the branch left `origin/main`, when it holds 5 needs or more and
is not a constructor. It names at most 3 existing units at a share of 600 or
more. Existing means every unit in the working tree that is not new: a
function gone from the tree is not one to call.

The share of 600 was chosen on the copies whose id hashes to the even half by
SHA-1. The odd half was not looked at until the threshold was fixed.

The rate at which it speaks was measured on every fourth change of the same
line, 365 changes, with the labelled copies left out. Each change is read as a
branch would be: the functions new at the change, against every other unit at
it.

## Results

| Copies whose owner it names | |
| --- | --- |
| Functions | 21 of 44 (48%) |
| Functions, even half (threshold chosen here) | 14 of 24 (58%) |
| Functions, odd half (held out) | 7 of 20 (35%) |
| Constants | 0 of 4 |
| Inline idioms | 0 of 6 |
| Caught by an earlier detector | 10 of 15 |
| Missed by both earlier detectors | 11 of 39 |

On ordinary changes it names a neighbour for 431 of 3,187 new functions, 14%.
The halves differ by 23 points on 24 and 20 copies, so the recall to expect on
new copies is somewhere between a third and a half, not the 58% the threshold
was chosen on.

Of the 40 judged pairs, the tool asks about 27; the other 13 are constants and
one constructor, 8 of them `unrelated`, which is why neither is asked about. Of
the 27 it names 20: 7 `reuse`, 12 `family`, 1 `unrelated`. 19 of 20 names are
therefore a function that answers the question or one that answers it another
way. A `family` name is not a false alarm: two answers to one question are what
the Alignment reviewer reads for under one implementation.

The 7 `reuse` pairs it does not name were judged against the change's base. In
5 of them, the change moved the body into the new function and left the old
one calling it: the old one's needs fell from 59 to 13, 42 to 6, 95 to 29, 61
to 20 and 17 to 11. That is the refactor to want, and against the tree as the
change leaves it there is nothing to name. In the other 2, the change edited the
neighbour too, and the share fell below 600.

## What it does not see

- Constants and inline idioms. A constant's bag is its value, which is too
  small to tell a twin from a coincidence, and an idiom is no unit at all.
  Both stay `owners.mjs`'s, by the idioms it lists.
- A function with fewer than 5 needs: a one-line helper is cheaper to read
  than to rank.
- An owner whose needs moved on: a copy of what a function did two releases
  ago shares little with what it does now.

## Tried and dropped

- Names alone. The words of a function's name ranked the owner below the full
  bag; a copy renames itself first.
- A linear rarity, the integer weight the project uses elsewhere: at the same
  threshold it named fewer copies than the log weight and spoke more often.
- Deviance, after Engler and others (SOSP 2001): among a copy's nearest
  neighbours, a function most of them call and the copy does not. Where the
  bag missed the owner, this never found it.

## On its own branch

The first runs on this branch named its own functions:

- `isFunction` in `needs.mjs`, against the one `owners.mjs` holds. That was a
  true copy, so `needs.mjs` now imports it, with `SCRIPT`, `isTest` and
  `lines`.
- `run` in `needs-measure.mjs`, against the git runners that scripts and
  fixtures each write for themselves. `needs.mjs` exports its `git` and the
  measurement imports it. No runner in the repository is one a script can
  import, so the family stays.
- `share` against the CLI's `percent`, which is private to `index-command.ts`
  and prints another format; `half` against `help`'s `digest`, which is
  SHA-256 while the held-out split is SHA-1 parity. Both are family, and both
  stay.

## Prior art

Marcus and Maletic (ASE 2001) found "concept clones", code implementing one
concept in different syntax, by latent semantic indexing over identifiers and
comments: a bag of words compared by cosine, which is this method without the
calls, fields and types. Juergens, Deissenboeck and Hummel (CSMR 2010) named
behaviourally similar code that is not syntactically similar a "simion", and
found that clone detectors miss most simions among independent implementations
of one specification, which is what `clones.mjs` did here.

## Cost

On an M4 Max with Node 24.21, the load under the core count, `yarn needs` on
this branch took 1.26 s with no cache and 0.52 s with one. The cache holds each
blob's bags, 7.5 MB for the repository. `node tools/needs-measure.mjs` takes
about 48 s and peaks at about 1.5 GB.

```bash
yarn needs                       # the new functions on this branch and their twins
node tools/needs-measure.mjs     # every number above, from tools/needs-measure.json
```
