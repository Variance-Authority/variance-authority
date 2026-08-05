# Spec 0018 — git-LFS proven as git-LFS

**Missing:** any execution of the filter. No clean/smudge has run, and no image
has been committed through one, so the failure that matters has only ever been
simulated.
**Built on:** the store, which ships and produces identical verdicts to the
directory and remote backends on the same scenarios
([ADR-0016](../context/adr/0016-where-a-baseline-is-kept-decides-nothing.md)).

## Purpose

git-LFS is the default storage rung because it needs no infrastructure and
because a baseline image is never hand-merged — one side is taken. That makes it
the rung most adopters land on first, and the only one whose characteristic
failure this repository has never observed.

The failure is specific: a checkout where the smudge filter did not run hands
back a **pointer file** — a hundred and thirty bytes of text — where a PNG should
be. A comparator that decodes it either throws somewhere unhelpful or, worse,
treats the bytes as an image and reports a difference against a component that
did not change. Every adopter on a CI runner without `git-lfs` installed meets
this, and meets it on their first red build.

## What would discharge it

**A case that commits a real image through the real filter**, in the shape
[`cases/`](../../cases) already uses for software this project did not write:
initialize a repository, install the filter, track `*.png`, commit a baseline,
then check out in a second clone **without** LFS available.

The assertions that matter, in order of how badly each fails today being unknown:

1. **A pointer file is named, not decoded.** The store recognizes what it was
   handed and refuses with the path and the reason. Anything that reaches the PNG
   decoder has already lost.
2. **The refusal is exit 2, not exit 1.** A missing baseline is an operator
   error, not a verdict. This is the exact case the exit-code split exists for,
   and reporting it as "changes need review" is the confident wrong answer.
3. **`variance doctor` sees it before the run does.** Doctor already reads the
   store layout and reports whether any baseline in it was painted by a machine
   like this one; an un-smudged store is the same class of question and should be
   answerable in the same place.
4. **A round trip is byte-identical.** Commit through clean, retrieve through
   smudge, and the bytes that come back are the bytes that went in. Anything else
   makes every subsequent comparison meaningless.

## What it is not

Not a test of git-LFS. The filter works; the question is entirely what this
project does when it did not run.

## Leaves behind

Probably nothing. If it forces a decision it will be about where the pointer-file
check lives — in the store, which knows the backend, or in the codec, which knows
what a PNG looks like — and that is one line in ADR-0016 rather than a record of
its own.
