# ADR-0101 — the merge queue publishes a partial record of the commit it landed

**Status:** accepted
**Date:** 2026-11-12
**Amends:** [ADR-0084](0084-every-base-is-mains-record.md), its rule that a
mainline takes only a whole run; ADR-0084 is left as written
**Relates to:** [`from-queue.ts`](../../../packages/cli/src/commands/from-queue.ts),
[`share-suites.ts`](../../../packages/cli/src/commands/share-suites.ts),
[`publish.ts`](../../../packages/core/src/share/publish.ts),
[`check.yml`](../../../.github/workflows/check.yml)

## Context

ADR-0084 lets a mainline take only a record in which every test file the
runner collects ran at the publish commit. The only run that is whole is the
push to `main`, whose `publish` job finished a median fourteen minutes after
the push, p90 twenty-nine, from 2026-10-29 to 2026-11-12, and never when the
push run failed. A checkout whose merge base is the new commit reads the
record behind it meanwhile and is charged with every change `main` made since,
although the merge queue had run those tests on that exact tree before the
commit landed.

The runs record already says where each test last ran (`standing`), and the
lay and the repin read it, so a record in which part of the suite ran at the
commit and the rest stands where it stood is one a reader can measure from.

## Decision

**A push to a mainline publishes, at once, the record its merge-queue run made
of the same commit, marked partial. The whole run's publish at that commit
replaces it, and a partial one never replaces a whole one.**

- **The queue's run is found, not trusted.** `share --publish --from-queue
  <artifact pattern>` asks GitHub for a green `merge_group` run of the running
  workflow whose head is `HEAD`, takes the latest, and downloads its artifacts
  that match. A push with no such run publishes nothing and says why.
- **The record folds over the mainline's**, as the whole publish folds, so a
  test the queue did not run keeps the stand the mainline gave it.
- **The whole-run gate stands for every other publish.** Only `--from-queue`
  marks its entry `partial`, and only for a run GitHub reports as the queue's.
- **The manifest holds `partial`.** A whole entry at a commit is kept against
  a partial one at the same commit, on any line, and the publish says so.

## Alternatives

- **Publish from the queue's own run.** Its commit is not on `main` until the
  group merges, and a group that fails never lands; the record would name a
  commit no reader's merge base can be.
- **Wait for the whole run.** The cost above.

## Cost

- One more job per push to `main`: install, build and `vitest list`.
- A test the queue's near wave did not reach stands at an older commit until
  the whole run publishes, so a checkout charges it from there, as before.
