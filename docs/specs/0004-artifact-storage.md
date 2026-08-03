# Spec 0004 — Artifact storage: git-LFS and remote

**Status:** `built` — see [the status vocabulary](README.md#status-vocabulary)
**Depends on:** [0003](0003-cli.md)
**Package:** `@variance-authority/store`, `@variance-authority/remote`

## Purpose

Put baseline images somewhere they survive a run. The durable store writes to a
local directory, which is correct for a single machine and useless for a team.

## Contract

Two implementations of the existing `RasterStore` interface, selected by
configuration:

- **git-LFS** (default). Images under a configured path, tracked by LFS, still
  partitioned by renderer identity as ADR-0011 requires.
- **remote**. An HTTP endpoint the operator runs.

## Behaviour

**git-LFS is the default because it needs no infrastructure**, and because a
baseline image is never hand-merged — a conflict is resolved by taking one side,
which is a decision a person can make in seconds.

**The identity partition is preserved by both.** A baseline written by one
machine MUST NOT be reachable by another as if it were comparable. The layout
enforces this; there is no check to forget.

**A remote store failure is not a verdict.** An unreachable endpoint reports an
operator error, never `new` and never `unchanged`. Treating a network failure as
a missing baseline silently re-records whatever is on screen.

**Images are artifacts, not history.** Nothing in [0002](0002-history-store.md)
stores or references image bytes.

## Acceptance

1. A baseline written under git-LFS is byte-identical when read back, git itself
   resolves `filter` to `lfs` for the image glob, and a pointer found where an
   image should be is raised as an operator error.

   An earlier version of this criterion required the working tree to contain a
   *pointer* rather than the image. That is backwards: LFS smudges on checkout,
   so a correct working tree holds the image and the pointer lives in the object
   database. A pointer in the working tree means git-lfs is missing — the broken
   clone — and writing the criterion that way would have made a broken clone the
   success condition. It must not be reported as a missing baseline either, since
   `new` re-records whatever is on screen and destroys the baseline it was meant
   to compare against.
2. A run on a second renderer identity does not find the first's baseline, and
   reports `incomparable` with the machine named.
3. An unreachable remote endpoint exits with the operator-error code, and no
   baseline is written or overwritten.
4. Switching store implementations changes no verdict for the same inputs.

## Out of scope

- Hosting a remote store.
- Garbage collection of superseded baselines.
