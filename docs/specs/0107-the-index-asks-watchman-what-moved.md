# Spec 0107 — the index asks Watchman what moved

**Missing:** an update of the source index that starts from the generation it
updates and asks what moved since it. Every `variance select` brings the index
up to the checkout before it reads the graph, and today that update rebuilds
the tree from `HEAD` each time: it lists the commit, asks `git status` what the
working tree disagrees with `HEAD` about, hashes all of that again, and checks
every held record. Its cost follows the checkout and the uncommitted work, not
what moved since the last update.
**Built on:** `updateSourceIndex` (`packages/sense/src/published.ts`) and its
native update (`packages/sense/native/src/source_update.rs`, over the snapshot in
`git.rs`); `gitDigests` and its overlays (`packages/sense/src/tree.ts`);
`indexUpToCheckout` (`packages/cli/src/commands/source-graph.ts`), which select,
select-journey, coverage and review call; spec 0056.
**Held by:** a test that runs one update over a sequence of tree changes with
each change source and expects the generation `variance index` publishes over
the same tree; and a count of the git calls, hashed paths and checked records
an update makes.

## 1. Why git answers the wrong question

`git status` answers against `HEAD` and git's own index. What the update needs is
what moved since the generation it holds, and git cannot be asked that:

- **The dirty set is paid every time.** A branch with 400 edited files hashes 400
  files on every update, though one moved.
- **The tree is listed every time.** `ls-tree -r HEAD` on Kibana (125,911 paths)
  costs 72 ms with nothing moved, and every held record is checked against it.
- **The accelerators are per host and per repository.** Git's builtin monitor
  runs on macOS and Windows only, and both accelerators are off by default.

Measured on the measurement machine, median of seven runs of
`status --porcelain=v1 -z --untracked-files=normal` on a clean tree after a
`status` that wrote the index, against a Node process already holding Watchman's
socket and asking `since <clock>`:

| | Material UI, 41,171 paths | Kibana, 125,911 paths |
| --- | ---: | ---: |
| `status`, neither accelerator | 89 ms | 841 ms |
| `status`, as configured | 54 ms (none set) | 109 ms (both set) |
| Watchman `since`, nothing moved | 12.7 ms | 12.7 ms |
| Watchman `since`, one file moved | 13.2 ms | 12.6 ms |

The Watchman row does not grow with the checkout. Most of it is the cookie
Watchman writes and waits for, so the answer covers every write before the
question: the same tick git's fsmonitor IPC costs (12.6 ms, spec 0056). The
`status` row is one of four parts the update pays; the listing, the hashing of
the dirty set and the walk over held records are the others, and journal 0072
puts the snapshot at 720 ms and the walk at 450 ms on a no-op update.

## 2. One update, fed by a change source

The update has one input besides the generation: the paths that may have moved
since it. A change source answers that, or answers that it cannot, and the
update is the same code whichever source answered.

- **Git** is the source on every host. It names what `status` reports against
  `HEAD`, the paths the generation holds where they differed from its base
  commit, and the paths `diff-tree` names between the base commit and `HEAD`.
  This is what today's update finds, and it costs what today's update costs.
- **Watchman** (§3) is the source where the repository runs it. It names what
  Watchman reports since the clock the generation carries.
- **The caller** is a source. `ScanOptions.changed`, which `help` and `ask`
  pass as "every file changed since the last reading", is applied today over
  the commit's listing by `overlayKnownChanges`, which loses every earlier
  edit. It becomes a caller-supplied delta into this update, and
  `overlayKnownChanges` is deleted. Spec 0056's daemon feeds the same input.

The update takes the delta and:

1. drops every reported path from the listing and the records, and adds back
   those that are files on disk and in the index's scope (§4);
2. hashes those paths with `hash-object --stdin-paths`;
3. updates the membership digest of each directory a path was added to or
   removed from;
4. reads again the records whose digest moved, and checks only the records
   whose path or watched directory is in the delta.

A generation with nothing to start from, a cold scan, reads every file as it
does now.

**The generation carries its listing.** Today a generation holds records,
parses and directory digests, and rebuilds the full listing from `ls-tree` on
every update. Starting from the generation needs the listing in it: every path
in the index's tree, with the blob name of every path it reads. On Kibana the
names alone are 12.3 MB and 0.87 MB after gzip; the record growth budget
carries it, and the spec measures it against that budget before it ships.

**The clock moves with a publish.** An update that changes nothing publishes
nothing, so it does not move the clock, and the next update is told the same
paths again. A reverted edit is hashed again on every update until something
publishes; that cost follows the paths touched since the last publish, not the
checkout, and is accepted.

## 3. What Watchman reports, and what it cannot

Where the repository runs Watchman, the update asks it `since` the clock the
generation carries. The clock is taken before the scan reads anything, so a
write during the scan is reported again next time: a file reported twice is
hashed twice, a file never reported is a stale index.

Watchman sees files under the root. Everything else the generation depends on,
it does not, and each is checked by the update itself:

- **Ignore rules.** Watchman does not read `.gitignore`; on Material UI an
  unknown clock reported 202,919 files against 41,171 tracked ones. A path the
  generation does not hold joins only when `git check-ignore --stdin -z` does
  not name it, so the cost follows the new paths. A reported `.gitignore` or
  `.gitattributes`, or a moved `.git/info/exclude`, git config or
  `core.excludesFile`, changes which paths are in and which blob name bytes
  hash to without touching those paths: the update takes the git source.
- **Git's index.** `add -f` of an ignored file and `rm --cached` change what is
  tracked without a write under the root. When `.git/index` moved since the
  generation, the update asks `diff-index --cached --name-only -z HEAD` (37 ms on
  Kibana) and joins every path whose staged state differs from the
  generation's.
- **The commit.** A commit moves `HEAD` without writing a file. When
  `.git/HEAD`, the ref it names or `packed-refs` moved since the generation, the
  update reads `HEAD` (12 ms) and records it as the base commit; the paths
  `diff-tree` names join the delta.
- **Members outside the root.** An index whose member list reaches beside its
  checkout takes the git source for those members.

Anything Watchman cannot vouch for — a generation with no clock, a clock for
another root or another server, `is_fresh_instance`, a recrawl, a socket error
— is answered by the git source, and the progress line names the reason. A
worktree's first update reads a generation seeded from the primary checkout,
whose clock is for another root, and takes the git source once.

## 4. Declared, not discovered

The repository declares Watchman by watching it. One test, which spec 0056's
daemon uses too: the server is running and its `watch-list` holds the
checkout's root or a directory above it, as `watch-project` resolves it, with
the checkout read through the answer's `relative_root`.

- It never starts the server, adds a watch, writes a `.watchmanconfig` or sets
  `core.fsmonitor`. Starting a file-system daemon on somebody's repository is
  not an indexer's decision, as `working-tree-changes.ts` says for git's
  monitor.
- It never spawns the CLI on a hot path. `watchman --no-spawn get-sockname`
  costs 103 ms, eight Watchman queries. The socket comes from `$WATCHMAN_SOCK`
  or the path recorded with the generation; the CLI is asked only when neither
  is there, once for a lineage of generations.
- There is no switch. Every source feeds one update, so which one answered is a
  cost, never an answer, and the progress line names it.

## 5. Where it lives

The client is `packages/sense/native/src/watchman.rs`, beside `git.rs`, and the
change source is chosen in the native update behind `updateSourceIndex`: the
step that owns what moved. Not in a reader, and not in `indexUpToCheckout`,
which only calls the update. The compass gains a row under *Not ours*: which
files moved since a clock, owned by Watchman where the repository runs it.

**Why Watchman before git's own monitor.** Git's builtin monitor answers the
same question at the same cost on macOS and Windows, and its IPC takes a token
of our own. Watchman goes first because it is the only one on Linux, where CI
and most remote agents run, and its clock protocol is public, where git's
fsmonitor IPC is internal to git. Git's monitor is the next source behind this
seam, and on Kibana as configured it would remove the 109 ms `status`, not the
listing or the walk, which this seam removes for every source.

**Why not a stat cache of our own.** Git's index is that cache, and `status`
already uses it. What remains is the walk that finds the paths to stat, which a
monitor removes and a second stat cache would not.

## 6. What will discharge this spec

1. One update over a sequence of changes publishes, after each, the generation
   `variance index` publishes over the same tree, with the git source, the
   Watchman source and a caller-supplied delta. The sequence borrows the
   fixtures of `packages/sense/src/native.test.ts` (edit, staged, untracked
   add, delete, `git mv` rename, collapsed directory, clean checkout) and adds a
   deleted directory, a new ignored file, a new file outside the index's scope,
   a `.gitignore` edit that ignores a held file, a `.gitattributes` edit,
   `add -f` and `rm --cached`, a commit with no file changed, a branch switch, a
   case-only rename on macOS, a watch above the checkout, and a read-only
   checkout where the sync cookie fails.
2. On a watched checkout, an update with nothing moved runs no `ls-tree`, no
   `status`, no `hash-object` and no CLI spawn, hashes zero paths and checks
   zero records. After one edit it hashes one path and checks the records that
   path and its directories reach. Counted in a test, not timed.
3. With no server, the root unwatched, no clock, another root's clock, and
   `is_fresh_instance`, the git source answers and the progress line names the
   reason.
4. After an update on a host with no running server, no Watchman process
   exists. With a running server, `watch-list` is the same before and after.
5. The listing's size is measured on Kibana against the record growth budget.
6. `packages/sense/scripts/published-index.mjs` gains a Kibana corpus and a row
   per change source for `indexUpToCheckout`, end to end: nothing moved and one
   edit, against today's update with the accelerators as configured and off.

## 7. Prior art

Jest's haste map keeps a Watchman clock per root in its cache file, asks
`since` that clock on the next run, and crawls again on `is_fresh_instance`.
Mercurial's and Sapling's `fsmonitor` extension stores the clock beside the
dirstate, walks in full on a fresh instance or a clock it cannot trust, and
treats an ignore-file change as a reason to walk. Git's own
`fsmonitor-watchman` hook passes git's token to Watchman as a clock. Buck2 reads
its file changes from a Watchman `since` query between commands. All of them
keep the answer the tool computes without Watchman and treat Watchman as a cost,
which is the position here.

## 8. Out of scope

- Starting Watchman, adding a watch, or writing any configuration for it.
- Watchman's `content.sha1hex`. It is SHA-1 of the bytes on disk, not git's
  blob name, and skips git's clean filters.
- A subscription that pushes changes. That is spec 0056's daemon, which feeds
  this update.
- Git's builtin fsmonitor IPC as a source. §5 says why it is next.
- The decode of the generation a reader opens (1,275 ms of Kibana's warm run in
  `docs/performance.md`). This spec removes the scan's share, not the read's.
