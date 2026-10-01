# Spec 0090 — coverage is layered

**Missing:** the per-test read of item 1, and items 2 to 4. A checkout's
record is still one file, the milestone it was laid on with its runs folded in,
so a landing over an edit still demotes every test on an edited region the run
did not observe (`format-layer-rows.ts`, `mergeCoverage`). Which rows are whose
is now kept beside it: the ledger `coverage.layer.json`
(`packages/sense/src/test-selection/own-layer.ts`) names the pinned milestone
and the tests each run observed, with the state they ran over, and
`repinOwnLayer` (`milestone-repin.ts`) moves the record onto a newer snapshot
HEAD contains. The share keeps one snapshot per line (`docs/sharing.md`, "A
share keeps no history"), so a branch cut before main's latest publish can read
its own base only if this machine fetched it then.
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

## What would discharge it

Items are in the order they should land. Each is one change; 1 stands alone,
3 waits on the measurement in 2.

**1. The milestone under a checkout is pinned, never copied, and a newer one
the checkout can reach replaces it.**

- The own layer stores only what this checkout's runs observed: their test
  rows, the module rows those tests ran, and the milestone commit it was laid
  over. The milestone's bytes stay in `share/read/<suite>/<commit>/` and are
  never written by a run.
- A read composes per test: a test this checkout ran is answered by its own
  row, framed and diffed from the state it ran over; every other test is
  answered by the milestone's row, diffed from the milestone's commit.
  This retires a width the merge pays today: a landing over an edit demotes
  every test on an edited region that the run did not observe
  (`format-layer-rows.ts`, `mergeCoverage`), because one frame serves every
  test. An edit at a module's top level demotes every loader of the module,
  where a diff from each test's own text charges only the readers of what
  changed.
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

Built: the ledger, the re-pin under `suiteBase` for a suite given to the
share, and the reader's note (`packages/cli/src/commands/checkout-read.ts`).
Remaining: the per-test read, which needs the own rows apart from the
milestone's at read time rather than folded at landing.

Discharged by tests that: land a local run and read the milestone file back
byte for byte unchanged; fetch a newer ancestor snapshot and assert untouched
tests now stand at it while locally run tests keep their rows; fetch a snapshot
that is not an ancestor and assert the pin is kept; and switch branches in the
primary checkout and assert the rows from the other branch are named as such
(`packages/cli/src/commands/milestone-pin.test.ts`), and a test that edits a
module's top level and asserts only the readers of what changed are demoted.

**2. The cost of history is measured before it is built.** Two numbers, on
this repository and on one large case:

- how often a pull request's merge base is more than one published snapshot
  behind the newest, over the last sixty merges;
- the size of one snapshot, and of the git pack that holds two consecutive
  ones (git already compresses blobs against each other).

Written to `docs/context/journal/` with the method. If the first number is
small, item 3 is not built and the spec says so.

**3. The share keeps a short history of mainline snapshots, and a reader picks
the newest one HEAD contains.** Only if item 2 asks for it.

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

**4. A merge queue publishes the snapshot main is about to become.** Only if
the repository adopts one. A `merge_group` run publishes at its `head_sha`.
GitHub's queue builds that commit with the merge method it is configured for and
moves main to it, so its snapshot exists when main changes; nothing here relies
on that. A reader takes the snapshot only through item 3's rule, the newest
snapshot whose commit HEAD contains, so a snapshot whose commit main never
reached, ejected or rewritten, is no commit's ancestor and the window drops it. `runLineOf` maps `merge_group` and `gh-readonly-queue/*`
to the mainline instead of refusing them.

## Decided

**The milestone is CI's, and a local run never writes it.** Gradle, Bazel and
Nx Cloud give the shared tier to trusted post-merge CI and keep local results
in a tier of their own. Nx's CVE-2025-36852 was a branch and main writing one
slot.

**A local layer belongs to a change: the commit and the uncommitted edits the
tests ran over.** How it is identified is decided below.

**The base is a milestone HEAD contains, and long-running work keeps the one it
started from** until a newer one is also an ancestor.

**A partial run never removes another test's rows.** Teamscale's
`partial=true` upload exists for the same reason.

**The GitHub Actions cache is not the store.** It evicts an entry seven days
after its last access, has no TTL of its own, and a laptop cannot read it.

**Correctness does not depend on history.** Each test is diffed from the commit
it last ran at, so an older base only widens a selection. Items 2 to 4 buy
width, not safety, and are built only if the width is measured.

**A change layer is named by a tree and decided by digests.** The per-module
source digests the record already stores say whether a module changed since a
test ran: they survive a partial stage and a rebase, cover generated files the
suite loads (`dist/`), and cost nothing new. The git tree of the working state
(`GIT_INDEX_FILE` + `add -A` + `write-tree`) is kept only as the state's name,
for printing and for `git diff`; a tree that `git gc` collected loses nothing.

**Until item 1 lands, the merge over-selects rather than skips.** Demoting
every unobserved test on an edited region is wider than a diff from each test's
own text, and a wider run is the price of never skipping a test whose code
changed.

## Open

These are the owner's to answer.

1. **History storage, if item 3 is built.** Several entries per slot in the
   one ref's manifest (works for the `git`, `directory` and `http` kinds alike;
   the git cell already fetches `blob:none`), or one ref per snapshot (git
   only). And the window: seven days, a count K, or both.
2. **Snapshot deltas instead of whole snapshots.** The newest snapshot whole and
   a short chain of row-level deltas back from it, a delta over a size bound
   refused and the chain cut there. Worth it only if item 2 shows consecutive
   snapshots do not already compress in git.
3. **A reader behind every snapshot** gets the newest with the distance
   printed, or nothing until it rebases.
4. **The merge queue**, and whether its runs may write the base every pull
   request trusts.
5. **External stores.** S3, GCS and R2 already serve as a share through
   `kind: "directory"` with a sync, or `kind: "http"` behind a signer
   (`docs/sharing.md`, "S3 and Google Cloud Storage"). A bucket lifecycle rule
   gives the window a real expiry. Is a bucket the default for repositories
   whose snapshots are large?

## Not this spec

- **Delta layers composed at read time for every run.** A stack of per-run
  files, each framed on its own, multiplies the query by the stack depth and
  gives up the single merge at landing that `format-layer.ts` exists for.
  Item 1 keeps one own layer over one pinned milestone.
- **Git notes on mainline commits.** Not fetched or pushed by default, lost
  on a squash or rebase merge unless `notes.rewriteRef` is set, and a ref with
  a history of its own that every reader would fetch.

## Acceptance

1. After any number of local runs, the milestone file under
   `share/read/<suite>/<commit>/` is byte for byte what the fetch wrote, and
   `variance` lists exactly the tests this checkout ran, with the state each
   ran over.
2. A fetch of a newer snapshot HEAD contains changes the base of every test
   this checkout did not run; one HEAD does not contain changes nothing.
3. The measurement of item 2 is in the journal, and items 3 and 4 are either
   built against it or struck from this spec with its numbers.
