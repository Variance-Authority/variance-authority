# The cache

The cache is one directory where variance-authority keeps what it can rebuild
from your checkout or fetch again from a [share](sharing.md): the test-selection
recording, the [source index](source-index.md), the renders a run took, the
suite indexes a share publishes, what a git share fetched, and the suite records
`select` and `review` read from your mainline. You set where it is with
`cacheRoot` in the `variance.config.json` at the repository root. When
`cacheRoot` is not set, it is `node_modules/.cache/variance-authority` inside
the checkout. Every command, every test runner integration and every function
that takes a `cacheRoot` option read that one answer, so a recording written by
`yarn test` is the recording `variance select` reads.

Nothing in it is a baseline. Delete any part of it and the next run is slower,
not wrong. [After an upgrade](#after-an-upgrade) says what each part of it does
when you move to a new release.

## Where it is

The first of these that applies decides it:

1. The `cacheRoot` option, when you call a
   [`@variance-authority/sense`](../packages/sense/README.md) function or the
   Playwright recorder with one.
2. `cacheRoot` in `variance.config.json` at the repository root, resolved
   against that directory.
3. `$VARIANCE_AUTHORITY_CACHE`, when it is an absolute path. It names the
   cache directory itself.
4. `node_modules/.cache/variance-authority` at the repository root.

The repository root is the top of the git work tree, so a test run started in
`packages/app` reads the same file as one started at the top.

The default is inside the checkout because the checkout is the one directory
every party that runs there may write: you, CI, and a coding agent whose
sandbox allows writes in the working tree and refuses your home directory.
`node_modules/` is already in every project's `.gitignore`, and Vitest's
watcher and other file watchers already skip it, so a run writing its
recording is seen by nothing that reacts to it. `XDG_CACHE_HOME` is not read:
agent harnesses set it for their own reasons, and a repository whose
recording follows it has as many recordings as it has harnesses.

`cacheRootFor(root)` from `@variance-authority/sense/test-selection`, or from
`@variance-authority/sense/cache-root` when you want it without the parser and
resolver loaded, returns the answer for a checkout. `variance index` prints the path of the source index it
wrote, which is inside it.

## Name it yourself

Set `cacheRoot` when you want the cache somewhere else inside the checkout, or
outside it:

```json
{
  "cacheRoot": ".variance/cache"
}
```

```text
# .gitignore
.variance/
```

Write the key only in the file at the repository root. Every test runner reads
that file and no other, so the CLI refuses `cacheRoot` in a
`variance.config.json` in a subdirectory and names the file to put it in. A
config in a subdirectory without the key gets the root's answer.

A file at the root that is not JSON, or a `cacheRoot` that is not a non-empty
string, stops the run with an error that names the file. The run does not fall
back to the default, because you would not know where the recording went.

`VARIANCE_AUTHORITY_CACHE` is for a harness that keeps its runs apart from the
checkout's recording, such as a test suite of its own. The key in the file wins
over it, so a repository that names its cache keeps one answer for everyone.

## What is in it

```text
<cache>/
  test-selection/<repository>/
    coverage.bin                 which test ran which region of which module, by file and by case,
                                 and the cases as they stood before the last run, kept for
                                 `variance review`
    coverage.bin.lock            held while a run writes the recording
    coverage.runs.json           the runs at the current commit, the install they ran on, and where each
                                 other test last ran
    coverage.stories/            a test story for each test a run recorded, when you ask for them
    suites/<name>/               the same files for each suite you declare
    source-index.bin             the source index, and its segments beside it
    source-index.bin.map         the code map `variance ask orient` reads
    checkout.json                the checkout this directory belongs to
    .texts/<hash>                the text a run recorded a module from, or a lockfile or manifest it ran
                                 on, when the commit does not hold it
    .run-<pid>-*/                a run in progress, removed when it ends
    .work/<worktree>/            a git worktree's own layer, the same files again
  renders/                       the images a run took, reused while they match
  suite/<project>/<commit>.bin   every run's suite index, by the commit it names
  share/<digest>.git             a git share's own repository, one per remote URL
  share/read/<suite>/<commit>/   a suite's record as its mainline published it, read by review and select
  report/<digest>/               a run report read from a share, and the images an answer fetched
  report/<digest>.images.json    that run report's image table
```

`<repository>` is the first 32 hexadecimal characters of the SHA-256 of the
checkout's absolute path, with links resolved:

```bash
printf %s "$(pwd -P)" | shasum -a 256 | cut -c1-32
```

The [execution record](execution-record.md) page describes `coverage.bin`, the
[source index](source-index.md) page describes `source-index.bin`, the
[test stories](test-stories.md) page describes `coverage.stories/`, the
[sharing](sharing.md) page describes `suite/`, `share/` and `report/`, and
[when `select` and `review` read `share/read/`](sharing.md#a-suite-your-checkout-has-not-recorded).

## Worktrees

A git worktree writes its own layer under `.work/<worktree>/` and reads the
primary checkout's layer when its own has nothing. So a worktree you created
this morning starts from what the repository already recorded. It never writes
the primary checkout's files.

With the default location or a relative `cacheRoot`, each checkout resolves
the path against its own root: the worktree writes inside the worktree, and
still reads the primary checkout's layer from inside the primary checkout. With
`VARIANCE_AUTHORITY_CACHE` or an absolute `cacheRoot`, both layers are in one
directory.

## In CI

Cache the whole directory, restore it to the same absolute path it was
written from, because `<repository>` is a digest of that path, and save it only
from your main branch:

```yaml
- uses: actions/cache/restore@v4
  with:
    path: node_modules/.cache/variance-authority
    key: variance-${{ runner.os }}-${{ runner.arch }}-${{ github.sha }}
    restore-keys: |
      variance-${{ runner.os }}-${{ runner.arch }}-
# … your tests …
- if: github.ref == 'refs/heads/main'
  uses: actions/cache/save@v4
  with:
    path: node_modules/.cache/variance-authority
    key: variance-${{ runner.os }}-${{ runner.arch }}-${{ github.sha }}
```

With `cacheRoot` set, the path is the one it names. The
[source index](source-index.md#caching-it-in-ci) page explains why the commit is
in the key.

A pull request saves nothing here because `variance review` compares your
change with the cases as they stood before the last run, which the suite keeps
in this directory with the commit they were recorded at. A pull request that saved
its own cache would restore it on its next push, and its review would compare
the change with itself.

What a pull request may carry from push to push is a copy of its suites'
records, outside this directory and under a cache key of its own, read only to
decide which tests the next push runs. Review still compares with the main
branch's. [A pull request's next push](selecting.md#a-pull-requests-next-push)
says how.

## After an upgrade

[Probes](../packages/sense) are what variance places in your code to see which
regions a test ran. Their recipe has a name, such as
`sense:instrument/presence-v6`, and every recording carries the name it was made
under. A run can only add to a recording made under its own recipe, so whether
the recording survives depends on whether the release changed the recipe. A
change of [`mode`](selecting.md#record-as-finely-as-you-select) changes it too.

When the recipe changed, the next run replaces the recording in your cache,
with `coverage.runs.json` beside it, and prints one line to stderr. When you see
no such line, the recipe did not change and the recording carries on:

```
variance-authority replaced the record at <cache>/test-selection/<repository>/coverage.bin: it was written under the probes `sense:instrument/presence-v5` and this run records under `sense:instrument/presence-v6`, so this run cannot be laid over it.
```

**The replacement costs one pass over the suite, spread over at most two runs.**
A run of the whole suite pays it alone. A selected run is still narrowed by the
old recording, which `variance select` reads as it holds it and says so, and the
new recording then holds only the tests that ran. A test file the recording has
never seen always runs, so your next selected run takes the rest, and selection
is back to normal after it. The pass is free when the run can start from another
record under its own recipe: a mainline record this machine fetched, or in a
worktree the primary checkout's.

The rest of the cache follows its own rules:

| Part | After an upgrade |
|---|---|
| [source index](source-index.md) written by another release | `variance index` rebuilds it. On your workstation, the commands that read it rebuild it too and say so. In CI they stop and name `variance index`, which is [the step to run first](source-index.md#caching-it-in-ci) |
| a mainline record in `share/read/` under another recipe | it stays, and a first run passes over it in one line, until your mainline publishes one under the new recipe |
| everything else | the upgrade does not touch it, and it stays until [its rule](#what-is-removed-and-when) removes it |

**A recording at a path of your own is never replaced.** `coverageFile` in a
[runner's options](../packages/sense/README.md#options-on-the-vitest-seam) and
`variance journeys --into` keep the recording in a file you named, outside the
cache. A run under another recipe fails after its tests, with an error naming
the file and both recipes, and leaves the file byte for byte. Give the run a new
path, or delete the file. A recording this build cannot read at all fails the
same way, in the cache too, and there you [start cold](#start-cold).

**The pull request that bumps variance restores the old recording.** The restore
key in the [CI snippet](#in-ci) names no version, so that job selects from the
old recording and its run replaces it. No earlier cases survive that run, so
`variance review` on that push names no case added or removed in a file that
already existed, unless your mainline publishes its cases to a
[share](sharing.md). When
your main branch runs the new release, it saves a recording under the new
recipe, and the pull requests after it restore that one.

## Start cold

Delete the directory for your checkout and run `yarn test` again:

```bash
rm -rf "<cache>/test-selection/<repository>"
```

For a suite given to the share, the first run then copies the mainline's
record, but only when this machine has fetched one, and prints that it did.
With none fetched, a worktree's first run copies the primary checkout's record,
as [sharing](sharing.md#a-suite-your-checkout-has-not-recorded) describes. To
start that suite from nothing, delete `<cache>/share/read/<suite>/` as well.

To reset only the source index and keep the recording, delete
`source-index.bin` and `source-index.bin.segments/` and run `variance index`.

## What is removed, and when

A recording is removed only with its checkout, or
[replaced after an upgrade](#after-an-upgrade). It is one file each run
rewrites, so it stays the same size however long you keep it, and without it
the next selected run declines and runs the whole suite. Everything else in
`test-selection/<repository>/` stays as long as that directory does.

The rest is removed when git, the file system or the process table shows that
nothing uses it any more, or when it is older than a fixed age:

| What | Removed when | Checked against |
|---|---|---|
| `test-selection/<repository>/` | the checkout named in its `checkout.json` is no longer on disk | the file system |
| `.work/<worktree>/` | `git worktree list` in the primary checkout no longer lists it | git |
| `.run-<pid>-*/`, and the `.tmp` files a run writes beside a record | it was last written more than an hour ago, and the process that wrote it has exited: no process has that id, or the one that has it started later | the process table |
| a test story | it was written more than 14 days ago | its modification time |
| `suite/<project>/<commit>.bin`, `share/read/<suite>/<commit>/` | your checkout's `HEAD` is more than 200 commits past that commit, or does not contain it and it was written more than 14 days ago; the newest in each directory stays | git, and its modification time |
| `report/<digest>/`, `report/<digest>.images.json` | it was written more than 14 days ago | its modification time |
| `renders/` | nothing asked for it in 14 days, or the renders are over 512 MiB, oldest first | its modification time |

Every test run writes `checkout.json` beside the recording. A directory without one,
a commit your clone does not have, and anything git could not answer for stay
until nothing in them has been written for 30 days. `share/<digest>.git` is
not removed.

`variance run` checks `renders/` at the end of every run, and the Playwright and
Vitest integrations check it when they close, as
[the render cache](placement.md#the-cache-prunes-itself) describes. `variance
run` checks everything else at its end too, at most once a day, and prints one
line for each part it removed something from:

```
cache: freed 17.8 MiB in <cache>/test-selection: 218 runs whose processes are gone, 7 worktrees git no longer lists
cache: freed 4.1 MiB in <cache>: 12 commits more than 200 behind HEAD
```

A test run removes its own scratch and nothing else, so what one run leaves for
another to clear stays until something checks. `variance prune` checks now,
whenever the last check was, and prints the same lines, or
`cache: nothing to prune`. It reads no project configuration, so a repository
that only runs its test suites keeps its cache bounded with it: in a CI cleanup
step, a scheduled job, or by hand.

An entry a check could not remove gets a line of its own, with the error that
stopped it, and stays out of the freed total. `variance prune` then
exits 2:

```
cache: could not remove <cache>/scans, a directory nothing writes any more: EACCES: permission denied, rmdir '<cache>/scans'
```

`variance doctor` prints what the next check would remove, by rule, and what it
keeps because git or the process table could not answer.
