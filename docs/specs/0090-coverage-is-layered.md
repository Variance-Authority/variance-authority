# Spec 0090 — coverage is layered

**Missing:** the whole capability. A checkout's first run copies the mainline
record it last fetched into its own layer (`layFetchedMainline`,
`packages/sense/src/test-selection/mainline-layer.ts`), every later run merges
into that copy (`mergeCoverage`, `landRun`), and once the copy exists
`suiteBase` never reads the mainline again
(`packages/cli/src/commands/suite-base.ts:66`). The base and the work done over
it are one file, so nothing can say which rows are the mainline's and which are
this checkout's, and a newer mainline record never replaces the base under a
checkout that has run. The share keeps one snapshot per line
(`docs/sharing.md`, "A share keeps no history"), so a branch cut before main's
latest publish can read its own base only if this machine fetched it then.
**Built on:** [ADR-0084](../context/adr/0084-every-base-is-mains-record.md)
(every base is main's record; proposed),
[ADR-0078](../context/adr/0078-the-cache-is-pruned-by-its-owners.md) (pruning),
[spec 0074](0074-what-ci-derived-is-reachable-from-a-checkout.md) (what CI
derived is reachable from a checkout),
[spec 0044](0044-many-writers-one-record.md) (many writers, one record),
`mainlineBase` (`packages/cli/src/commands/mainline-base.ts`), the per-test
stand in `coverage.runs.json` (`commit-runs.ts`, `stands.ts`), and the kept
texts of a dirty run (`kept-texts.ts`).

## Purpose

The mainline record costs CI twenty minutes over thirty shards. It is a
milestone: the one statement of what every test ran at one commit of `main`.
A developer's checkout is the opposite. Its code changes many times between
runs, a run may cover one test file or none, and the work may move to another
branch or another worktree. Both are needed to select tests, and they must stay
apart, so that a checkout can always answer two questions:

- **In git terms:** which commits and which uncommitted edits separate this
  work from the milestone it stands on.
- **In record terms:** which tests this checkout ran itself, over which state,
  and which rows it reads from the milestone unchanged.

Folding the two into one file loses the second answer the first time a local
run lands, and pins the milestone the checkout had then for as long as the
copy lives.

The same reading found one case where today's merge can select too few tests
(item 1). It is first in the order because a selection that skips a test whose
code changed is the one failure this product does not trade for speed.

## What would discharge it

Items are in the order they should land. Each is one change; 1 to 3 stand
alone, 5 waits on the measurement in 4.

**1. A test the run did not observe is not carried over a region whose text
changed under it.** Found by reading, not yet reproduced:

1. T1 runs at commit H and covers function `foo` in file f.
2. `foo`'s body is edited and not committed. Only T2, which also loads f, runs.
3. The landing re-records f. It carries T1's crossings onto the new rows by
   name, path and kind alone; the block digest is not compared
   (`format-layer-rows.ts:205-215`, `reusableBlock` in `merge-carry.ts:435-452`).
   The rows take the edited text's digest, and `kept-texts.ts` keeps that text.
4. The run is at the same commit, so `commitRunsAfter` adds T2's file to H's
   list (`commit-runs.ts:173-174`) and T1 stays standing at H.
5. The next selection frames f by the kept text (`frame.ts:65-70`). The change
   from that text to the disk is empty, so the file reads `none`
   (`select.ts:250-260`), and T1 is skipped. T1 never ran over the edited `foo`.

`reusableBlock`'s comment says selection charges the changed region from the
diff. A kept-text frame removes that diff.

Discharged by a fixture that runs the five steps and asserts T1 is selected,
then by the fix that makes it pass: a carried crossing on a block whose digest
differs from the block it was carried from marks each crosser the run did not
observe incomplete, as the `stale` set in `format-layer-rows.ts:217-222`
already does for a block that lost its address. Only the tests that crossed the
edited region re-run. If the fixture selects T1 without a fix, the fixture lands
alone and this item says where the reading was wrong.

**2. Every push to `main` publishes its record.** `check.yml` sets
`concurrency: check-${{ github.ref }}` with `cancel-in-progress: true`, so two
merges in quick succession cancel the first one's suite run, and that commit is
never published. On `main` the group is keyed by the commit; on a pull request
it stays keyed by the ref. A workflow test (or a check on the parsed YAML)
asserts the two groups.

**3. The milestone under a checkout is pinned, never copied, and a newer one
the checkout can reach replaces it.**

- The own layer stores only what this checkout's runs observed: their test
  rows, the module rows those tests ran, and the milestone commit it was laid
  over. The milestone's bytes stay in `share/read/<suite>/<commit>/` and are
  never written by a run.
- A read composes per test: a test this checkout ran is answered by its own
  row, framed and diffed from the state it ran over; every other test is
  answered by the milestone's row, diffed from the milestone's commit.
- When `mainlineBase` fetches a snapshot M that is an ancestor of HEAD and
  descends from the pinned one, M becomes the pin. Own rows stay for tests
  whose stand descends from M; the others are answered by M. When git cannot
  say whether M is an ancestor (a shallow clone, a commit this clone lacks), the
  pin does not change and the reader says why.
- Long-running work keeps the milestone it pinned until a newer one is an
  ancestor of HEAD: a fetch of a snapshot the branch does not contain changes
  nothing.
- `variance` prints both answers from the purpose: the milestone commit and the
  distance to it, and the tests this checkout answers itself, each with the
  state it ran over.

Discharged by tests that: land a local run and read the milestone file back
byte for byte unchanged; fetch a newer ancestor snapshot and assert untouched
tests now stand at it while locally run tests keep their rows; fetch a snapshot
that is not an ancestor and assert the pin is kept; and switch branches in the
primary checkout and assert the rows from the other branch are named as such.

**4. The cost of history is measured before it is built.** Two numbers, on
this repository and on one large case:

- how often a pull request's merge base is more than one published snapshot
  behind the newest, over the last sixty merges;
- the size of one snapshot, and of the git pack that holds two consecutive
  ones (git already compresses blobs against each other).

Written to `docs/context/journal/` with the method. If the first number is
small, item 5 is not built and the spec says so.

**5. The share keeps a short history of mainline snapshots, and a reader picks
the newest one HEAD contains.** Only if item 4 asks for it.

- Write: a publish inserts its snapshot by commit and drops those outside the
  window. The publisher prunes; no reader writes the mainline.
- Read: `git merge-base HEAD <remote>/<mainline>`, then the first commit on
  `rev-list --first-parent` from it that has a snapshot. With none, the newest
  snapshot is the base and the distance is printed, as today.
- Compatibility: a client that reads today's one-entry manifest still reads
  the newest snapshot.

This amends spec 0074 ("A checkout does not need history"; acceptance 3, "each
mainline ref is one commit") and the no-history paragraph in
`docs/sharing.md`, and is recorded in ADR-0084.

**6. A merge queue publishes the snapshot main is about to become.** Only if
the repository adopts one. A `merge_group` run publishes at its `head_sha`;
main fast-forwards to that commit, so its snapshot exists when main changes.
A group the queue ejects leaves a snapshot that is no commit's ancestor, and
the window drops it. `runLineOf` maps `merge_group` and `gh-readonly-queue/*`
to the mainline instead of refusing them.

## Decided

**The milestone is CI's, and a local run never writes it.** Gradle, Bazel and
Nx Cloud give the shared tier to trusted post-merge CI and keep local results
in a tier of their own. Nx's CVE-2025-36852 was a branch and main writing one
slot.

**A local layer belongs to a change: the commit and the uncommitted edits the
tests ran over.** The identity it is stored under is open (below); what it
describes is not.

**The base is a milestone HEAD contains, and long-running work keeps the one it
started from** until a newer one is also an ancestor.

**A partial run never removes another test's rows.** Teamscale's
`partial=true` upload exists for the same reason.

**The GitHub Actions cache is not the store.** It evicts an entry seven days
after its last access, has no TTL of its own, and a laptop cannot read it.

**Correctness does not depend on history.** Each test is diffed from the commit
it last ran at, so an older base only widens a selection. Items 4 to 6 buy
width, not safety, and are built only if the width is measured.

## Open

These are the owner's to answer.

1. **The identity of a change layer.** The git tree of the working state
   (`GIT_INDEX_FILE` + `add -A` + `write-tree`) is recognised exactly when that
   state is later committed, and `git diff <tree>` works natively. It misses
   ignored and generated files the suite loads (`dist/`), an exact tree rarely
   recurs after another edit, and an unreferenced tree is collected by
   `git gc`. The per-module source digests the record already stores survive a
   partial stage and a rebase, and cost nothing new. Tree, digests, or the tree
   as a name over the digests?
2. **History storage, if item 5 is built.** Several entries per slot in the
   one ref's manifest (works for the `git`, `directory` and `http` kinds alike;
   the git cell already fetches `blob:none`), or one ref per snapshot (git
   only). And the window: seven days, a count K, or both.
3. **Snapshot deltas instead of whole snapshots.** The newest snapshot whole and
   a short chain of row-level deltas back from it, a delta over a size bound
   refused and the chain cut there. Worth it only if item 4 shows consecutive
   snapshots do not already compress in git.
4. **A reader behind every snapshot** gets the newest with the distance
   printed, or nothing until it rebases.
5. **The merge queue**, and whether its runs may write the base every pull
   request trusts.
6. **External stores.** S3, GCS and R2 already serve as a share through
   `kind: "directory"` with a sync, or `kind: "http"` behind a signer
   (`docs/sharing.md`, "S3 and Google Cloud Storage"). A bucket lifecycle rule
   gives the window a real expiry. Is a bucket the default for repositories
   whose snapshots are large?

## Not this spec

- **Delta layers composed at read time for every run.** A stack of per-run
  files, each framed on its own, multiplies the query by the stack depth and
  gives up the single merge at landing that `format-layer.ts` exists for.
  Item 3 keeps one own layer over one pinned milestone.
- **Git notes on mainline commits.** Not fetched or pushed by default, lost
  on a squash or rebase merge unless `notes.rewriteRef` is set, and a ref with
  a history of its own that every reader would fetch.

## Acceptance

1. The fixture of item 1 selects T1.
2. After two merges to `main` a minute apart, both commits have a published
   record.
3. After any number of local runs, the milestone file under
   `share/read/<suite>/<commit>/` is byte for byte what the fetch wrote, and
   `variance` lists exactly the tests this checkout ran, with the state each
   ran over.
4. A fetch of a newer snapshot HEAD contains changes the base of every test
   this checkout did not run; one HEAD does not contain changes nothing.
5. The measurement of item 4 is in the journal, and items 5 and 6 are either
   built against it or struck from this spec with its numbers.
