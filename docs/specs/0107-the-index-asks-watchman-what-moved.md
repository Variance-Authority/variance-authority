# Spec 0107 — the index asks Watchman what moved

**Missing:** an update of the source index that asks what moved since the
generation it updates, rather than what differs from `HEAD`. Every `variance
select` now brings the index up to the checkout before it reads the graph, so
this question is asked on every selection. Today the update lists the commit
(`ls-tree -r HEAD`), asks `git status` what the working tree disagrees with
`HEAD` about, re-hashes all of that, and walks every held record. Its cost
follows the size of the checkout and of the uncommitted work, not what changed
since the last update.
**Built on:** `updateSourceIndex` (`packages/sense/src/published.ts`), the
native snapshot (`packages/sense/native/src/git.rs`), `gitDigests` and its two
overlays (`packages/sense/src/tree.ts`), and the readers that call
`indexUpToCheckout` (`packages/cli/src/commands/source-graph.ts`).
**Held by:** an equality test that builds a generation from a Watchman delta and
one with `variance index`, over the same tree, and expects them equal; and a
count of the git calls and hashed paths an update makes.

## 1. Why git answers the wrong question

`git status` answers against `HEAD` and git's own index. The published
generation already holds a digest for every file the working tree has changed,
so the part of git's answer the update needs is "what changed since that
generation", and git cannot be asked that:

- **The dirty set is paid every time.** A branch with 400 edited files re-hashes
  400 files on every update, though one moved.
- **The tree is listed every time.** `ls-tree -r HEAD` on Kibana (125,911
  paths) costs 72 ms, with nothing moved.
- **The accelerators are per host and per repository.** Git's builtin monitor
  runs on macOS and Windows only. On a Linux host without Watchman, and on any
  repository that leaves both settings off, `status` walks the tree.

Measured on the measurement machine, median of seven runs of
`status --porcelain=v1 -z --untracked-files=normal`, against a fresh Node
process asking Watchman's socket for `since <clock>`:

| | Material UI, 41,171 paths | Kibana, 125,911 paths |
| --- | ---: | ---: |
| `status`, neither accelerator | 89 ms | 843 ms |
| `status`, as configured | 54 ms (none set) | 298 ms (both set) |
| Watchman `since`, nothing moved | 12.7 ms | 12.7 ms |
| Watchman `since`, one file moved | 13.2 ms | 12.6 ms |

The Watchman row does not grow with the checkout. Most of it is the cookie
Watchman writes and waits for, so the answer covers every write before the
question: the same tick git's fsmonitor IPC costs (12.6 ms, spec 0056).

## 2. The promise

Where the repository is already watched by Watchman, an update of the source
index learns what moved from Watchman, since the clock its generation carries.

- **The generation carries a clock.** Every publish records the Watchman clock
  and the watched root it was taken against. The clock is taken before the scan
  reads anything, so a write during the scan is reported again next time. A
  file reported twice is hashed twice; a file never reported is a stale index.
- **The delta is applied to the generation, not to `HEAD`.** The update starts
  from the previous generation's digests, removes every path Watchman reports,
  and hashes again, with `hash-object --stdin-paths`, the reported paths that
  are files on disk. `overlayKnownChanges` today lays a known list over the
  commit's listing, which loses every earlier edit: it is not this input.
- **Git still answers the commit.** When `HEAD` differs from the generation's
  base commit, the paths that `diff-tree -r --name-only -z <old> <new>` names
  join the delta. A commit moves `HEAD` without touching a file, so Watchman
  cannot report it. Hunks between two known texts stay git's.
- **Ignored paths stay out.** Watchman does not read `.gitignore`. On Material
  UI an unknown clock reported 202,919 files against 41,171 tracked ones. A
  reported path the generation already holds passes through. A path it does not
  hold is indexed only when `git check-ignore --stdin -z` does not name it and
  it is inside the index's scope, so the cost follows the new paths only.
- **Anything Watchman cannot vouch for runs today's update.** A generation with
  no clock, a clock for another root, `is_fresh_instance`, a recrawl, or an
  error from the socket: the update runs as `variance index` does now, and its
  progress line names the reason. A reader's output is unchanged either way.

## 3. Declared, not discovered

The repository declares Watchman by watching it. The update uses Watchman only
when its server is already running and already watches the checkout's root, or
a directory above it, as `watch-project` would resolve it.

- It never starts the server. The socket is found from `$WATCHMAN_SOCK`, or
  from `watchman --no-spawn get-sockname`, and a missing server is the git path.
- It never adds a watch, writes a `.watchmanconfig`, or sets `core.fsmonitor`.
  Starting a file-system daemon on somebody's repository is not an indexer's
  decision, as `working-tree-changes.ts` says for git's monitor.
- There is no switch. The two paths publish the same generation (§5), so which
  one ran is a cost, never an answer, and the progress line names it.

## 4. Where it lives

In the step that owns what moved: the native update behind
`updateSourceIndex`. Not in a reader, and not in `indexUpToCheckout`, which
only calls the update. A cold scan has no generation to start from, so it
takes the clock and then reads every file as it does now.

Spec 0056's daemon subscribes to Watchman to keep the index current between
questions. With this spec, a reader on a watched checkout is current at the
question for one round trip, without a daemon. The daemon still owns push and
the hosts where only git's monitor runs.

## 5. What will discharge this spec

1. A generation built from a Watchman delta equals the one `variance index`
   publishes over the same tree, across the edit, add, delete, rename, checkout
   and collapsed-directory cases in `packages/sense/src/native.test.ts`, and
   across a deleted directory, a new ignored file, a new file outside the
   index's scope, a commit with no file changed, and a branch switch.
2. On a watched checkout, an update with nothing moved runs no `ls-tree`, no
   `status` and no `hash-object`, and hashes zero paths. An update after one edit
   hashes one path. Both are counted in a test, not timed.
3. With no server, with the root unwatched, with no clock in the generation,
   and with `is_fresh_instance`, the update publishes what `variance index`
   publishes and names the reason in its progress line.
4. After an update on a host with no running server, no Watchman process exists.
   With a running server, `watch-list` is the same before and after.
5. `packages/sense/scripts/published-index.mjs` gains a row per change source
   on Kibana: nothing moved and one edit, Watchman against `status` as
   configured and with neither accelerator.

## 6. Prior art

Jest's haste map keeps a Watchman clock per root in its cache file, asks
`since` that clock on the next run, and crawls again on `is_fresh_instance`.
Mercurial's and Sapling's `fsmonitor` extension stores the clock beside the
dirstate and falls back to a full walk on a fresh instance or a clock it cannot
trust. Buck2 reads its file changes from a Watchman `since` query between
commands. All three keep the answer the tool would have computed without
Watchman, and treat Watchman as a cost, which is the position here.

## 7. Out of scope

- Starting Watchman, adding a watch, or writing any configuration for it.
- Watchman's `content.sha1hex`. It is SHA-1 of the bytes on disk, not git's
  blob name, and skips git's clean filters. The index's digest is the blob name.
- A subscription that pushes changes. That is spec 0056's daemon.
- Git's builtin fsmonitor IPC with a token of our own. It answers the same
  question at the same cost on macOS and Windows, and it is the next source
  behind the same seam, not this spec.
