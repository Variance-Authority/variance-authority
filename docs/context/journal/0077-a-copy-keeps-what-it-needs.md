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
names the owner of 22 of the 44 copied functions, 12 of them copies neither
earlier detector saw, and it runs at the end of every `yarn test:loop`, while
the second implementation is still being written.

## The labels

`tools/needs-measure.json` holds what was read by hand, before this tool
existed, from `main`'s first-parent line up to 94a02988b, 1,457 changes:

- 54 copies: a change that wrote a function, a constant or an inline idiom
  while one that answered existed at its base. Each was confirmed by reading
  the copy and its owner. 44 are function copies, 48 functions between them
  because four changes wrote two; 4 are constants and 6 inline idioms.
- 40 judged pairs: a sample of what an earlier probe named on ordinary changes,
  each read and called `reuse` (the existing function answers), `family` (the
  same question, answered another way) or `unrelated`. They were sampled from
  that probe's output, not from this tool's.
- 45 sampled pairs: names this tool printed on ordinary changes, ordered by the
  SHA-1 of each pair, so nobody chose them. The measurement reads the first 40
  it prints; 45 are labelled because the weight below changed after the first
  40 were read, and five pairs moved into the first 40. Three judges read each
  pair blind, with the two functions and neither the share nor the other
  judges' verdicts, and the majority labelled it: `reuse`, `family` or
  `unrelated`, as above.

## Method

A unit is a named function, method, arrow, function-valued property or
top-level constant. Its bag holds one token per need, by class: `call:` for
each callee and its member chain, `str:` and `re:` for literals, `prop:` for
each field read, `type:` for each type named, `imp:` for each binding imported
from a package, `word:` for each word of the identifiers inside, and `name:`
for each word of its own name. The words are `tokensOf`'s, the tokenizer
`variance ask search` reads names with: camel case and separators split, the
unsplit compound kept, a trailing `s` dropped from words of four letters or
more. A relative import adds nothing a path would not.

Each token weighs (1 + log tf) · rarity(N, df): how often the unit holds it,
times `rarity`, the integer weight `@variance-authority/mcp` already ranks by,
1,000 for a need no existing unit holds and falling in a straight line to 0
for one every unit holds. N and df are counted over the existing units. Two
units are compared by the cosine of their weights, rounded to an integer share
of 1,000, so a tie is a tie on every machine. Ties break by path, then name,
then line, in code-unit order.

The tool asks about a function new on the branch, one whose name its file did
not hold where the branch left `origin/main`, when it holds 5 needs or more and
is not a constructor. It names at most 3 existing units at a share of 675 or
more. Existing means every unit in the working tree that is not new: a
function gone from the tree is not one to call.

The first version weighed by log inverse document frequency at a share of 600,
chosen on the copies whose id hashes to the even half by SHA-1, with the odd
half not looked at until the threshold was fixed. The share of 675 was chosen
for `rarity` to speak as often as that one did on unlabelled changes, 12% of
new functions; the odd half's recall was printed alongside and is 7 at both.
Only the threshold was held out: the token classes, the floor of 5 needs, the
weight and the variants below were compared on every copy, so the odd half's
recall is an upper bound.

The rate at which it speaks was measured on every fourth change of the same
line, 365 changes, with the labelled copies left out. Each change is read as a
branch would be: the functions new at the change, against every other unit at
it.

## Results

| Copies whose owner it names | |
| --- | --- |
| Functions | 22 of 44 (50%) |
| Functions, even half | 15 of 24 (63%) |
| Functions, odd half (held out) | 7 of 20 (35%) |
| Constants | 0 of 4 |
| Inline idioms | 0 of 6 |
| Caught by an earlier detector | 10 of 15 |
| Missed by both earlier detectors | 12 of 39 |

On ordinary changes it names a neighbour for 372 of 3,187 new functions, 12%,
and prints 556 names. Of the first 40 of them, 18 are `reuse`, 21 `family` and
1 `unrelated`; the judges were unanimous on 37. The halves differ by 28 points
on 24 and 20 copies, and the odd half is an upper bound, so the recall to
expect on new copies is a third or less, not the 63% of the half the threshold
was first chosen on.

Of the 40 judged pairs, the tool asks about 27; the other 13 are constants and
one constructor, 8 of them `unrelated`, which is why neither is asked about. Of
the 27 it names 19: 7 `reuse` and 12 `family`. A `family` name is the place to
look, not a false alarm: the same question, answered another way.

The 7 `reuse` pairs it does not name were judged against the change's base. In
5 of them, the change moved the body into the new function and left the old
one calling it: the old one's needs fell from 61 to 13, 48 to 8, 101 to 32, 64
to 21 and 20 to 15. That is the refactor to want, and against the tree as the
change leaves it there is nothing to name. In the other 2, the change edited the
neighbour too, its needs grew from 25 to 33 and from 49 to 69, and the share
fell below 675.

## What it does not see

- Constants and inline idioms. A constant's bag is its value, which is too
  small to tell a twin from a coincidence, and an idiom is no unit at all.
  Both stay `owners.mjs`'s, by the idioms it lists.
- A function with fewer than 5 needs: a one-line helper is cheaper to read
  than to rank.
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

Each was measured with the first version's weight at its share of 600, but the
same-name lead, measured with `rarity` at 675.

- Names alone. The words of a function's name ranked the owner below the full
  bag; a copy renames itself first.
- A same-name lead: every existing function whose name is the new one's. On
  its own it names 20 of the 44 copies, 8 of the 20 held out, and speaks for
  28% of new functions; joined with the bag, 24 of 44 at 33%. Two more copies
  for nearly three times the noise.
- The bag without `word:` and `name:`: 9 of the 44 function copies, 2 of the
  20 held out, speaking for 12% of new functions, and of the judged pairs it
  named 5 `reuse` and 6 `family`. A copy renames itself, but the words of what
  it reads stay.
- An identifier splitter of its own: the same 21 copies, but it spoke for 14%
  of new functions where `tokensOf` speaks for 12%.
- The first version's weight itself, log ((N + 1) / (df + 1)) + 1 in place of
  `rarity`, where it speaks as often: 21 of 44, 7 of the 20 held out, for 375
  of 3,187 new functions. `rarity` names one copy more, and the project
  already had it.
- Deviance, after Engler and others (SOSP 2001): among a copy's nearest
  neighbours, a function most of them call and the copy does not. Where the
  bag missed the owner, this never found it.

`variance ask search`, asked with each copy's name and the first lines of its
doc comment, ranks the owner in its top 3 for 15 of the 44 copies; 9 of them
are copies the bag names too, so the two together name 28. The search was
asked of today's index, which holds 40 of the 44 owners and the docs written
since, an advantage the bag at the copy's base did not have, and 5 of the 6
copies only the search names share a word of their owner's name. It is a
second lead worth joining, measured at each copy's base, on its own branch.

## On its own branch

The first runs on this branch named its own functions:

- `isFunction` in `needs.mjs`, against the one `owners.mjs` holds. That was a
  true copy, so `needs.mjs` now imports it, with `SCRIPT`, `isTest` and
  `lines`.
- `run` in `needs-measure.mjs`, against the git runners that scripts and
  fixtures each write for themselves. `needs.mjs` exports its `git` and the
  measurement imports it. The other scripts' runners are left as they are:
  joining them is a change of its own.
- `share` against the CLI's `percent`, which is private to `index-command.ts`
  and prints another format; `half` against `help`'s `digest`, which is
  SHA-256 while the held-out split is SHA-1 parity; `keyOf`, a unit's path and
  name joined, against the tribunal's object key and the core's component key,
  each private to its file and built from other parts. All three are family:
  the answers they need differ, and none of the neighbours can be imported.
- `listed`, the non-empty lines of git's output, against `lines` in the CLI's
  `clone-cut.ts`, which is the same line of code and private to its file. No
  package exports it, so it stays a copy until one does, with the git runners.

A review found what the list did not: `walk` and an inner `visit` in
`needs.mjs` re-typed `visit` in `owners.mjs`, the depth-first walk over oxc's
nodes, at a share below the threshold. `variance ask search`, asked for a
depth-first walk over every node of the parse tree, ranks `owners.mjs`'s
first. `owners.mjs` now exports `visit` and `needs.mjs` walks with it. Reading
the units through it showed the old walk took a constant declared in a block or
a loop at the top of a module for the module's, 1,253 of them across the
repository; a constant is now the module's only where a statement of the module
declares it.

## Prior art

Marcus and Maletic (ASE 2001) found "concept clones", code implementing one
concept in different syntax, by latent semantic indexing over identifiers and
comments: a bag of words compared by cosine, which is this method without the
calls, fields and types. Juergens, Deissenboeck and Hummel (CSMR 2010) named
behaviourally similar code that is not syntactically similar a "simion", and
found that clone detectors miss most simions among independent implementations
of one specification, which is what `clones.mjs` did here.

## Cost

On an M4 Max with Node 24.21, the load under the core count, the list costs
`yarn test:loop` 0.50 s with its cache warm and 1.39 s on the first run after
the reader changes, as the amendment to
[ADR-0096](../adr/0096-the-edit-loop-answers-for-one-edit.md) records. `yarn
needs` alone, with Node's start and Yarn's, takes 0.77 s and 1.67 s. The cache
holds each blob's bags, 8 MB for the repository. `node tools/needs-measure.mjs`
takes about 50 s and peaks at about 1.5 GB.

```bash
yarn needs                       # the new functions on this branch and their twins
node tools/needs-measure.mjs     # the Results, from tools/needs-measure.json
```
