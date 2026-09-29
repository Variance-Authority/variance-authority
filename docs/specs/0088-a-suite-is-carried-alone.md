# Spec 0088 — a suite is carried alone

**Missing:** the whole capability. `variance carry` gives each suite carried by
`actions-cache` an artifact `suite-<name>` with its own key, but every one of
them names the same path: the whole recording directory `top`, less the run
scratch and `.work` (`packages/cli/src/commands/carry.ts:216`). A cache entry
saved by the job that recorded `e2e` also contains whatever `unit` left in that
directory, and restoring it writes over the `unit` record a job restored a step
earlier.
**Built on:** `carryPlan` in `packages/cli/src/commands/carry.ts` (keys, restore
keys and paths per artifact), `testCoverageFile` in
`packages/sense/src/test-selection/suites.ts` (where each suite records),
`repositoryLayers` (the `top` layer).

## Purpose

A repository whose suites run in separate jobs — the unit suite in one, e2e in
another, the visual gate in a third — needs each job to save the record it made
and nothing else, and a later job to restore several records into one checkout.
With one path for all of them, the restore that runs last wins, and the lost
record is not reported. That is a record silently lost, which
[spec 0044](0044-many-writers-one-record.md) calls the defect to avoid.

## What would discharge it

**1. A suite's artifact path is that suite's own directory.** `suite-<name>-path`
is the directory `testCoverageFile(root, { suite: name })` writes into, and
nothing outside it. A test saves two suites' plans and asserts that neither
path contains the other.

**2. Whatever sits beside every suite is its own artifact.** Anything in `top`
that is shared by all suites (the names table, the snapshot of the default suite)
is saved once, under an artifact of its own, by the job that records it.

**3. A restore of several suites into one checkout leaves each one's record as
saved.** A test restores `unit` then `e2e` into one directory and reads both
records back unchanged.

**4. The key names the suite, and a key from the old layout is not restored as
if it were the new one.** An entry saved with the whole-directory path is keyed
under a prefix the new plan never asks for, so a restore finds nothing rather
than a directory of the wrong shape, and the run's own "no recording was
restored" line says so.
