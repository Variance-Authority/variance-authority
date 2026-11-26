# Where each checkout's record comes from, and how old it is

The record is what a test run writes when its runner is wrapped: which tests
ran which lines, measured at one commit. `variance select`, `covering` and
`review` read it to decide what a change needs. Every branch, a pull request's
included, selects from the runs made on that machine plus, when the machine has
one, a record of your mainline, the branch the others merge into. This page describes that record's
life on a team's machines and CI, and lists every way to get the mainline's
record to them: no transport at all, your CI host's cache, or a share, a store
your mainline's CI publishes to. An old record never skips a test it should
run. It runs more: every mainline commit between the record and your branch
counts as part of your change. So the choice in front of you is how many
commits behind each machine's record may fall, and what you pay to keep that
number small.

## What an old record costs

Every selection prints which record it read, and how far that record is from
your branch, before the first test starts:

```text
record of "unit": read from mainline main, published at 3f1c9a2…, 2 commit(s) behind the merge base with this checkout; kept at <cache>/share/read/unit/3f1c9a2…/coverage.bin
```

The [execution record](execution-record.md) names the commit it was measured
at, and `select` diffs from that commit. What that diff contains decides the
cost:

| The record | What `select` runs |
| --- | --- |
| at your merge base with the mainline | the tests your change needs |
| behind your merge base, as when a pull request's check merges into a mainline tip newer than the last publish | those, plus the tests the mainline's commits between the record and your merge base change |
| past your merge base, as when your branch has not taken the mainline's latest commits | those, plus the tests the mainline's commits between your merge base and the record change |
| none, or one this version cannot read | every test file |

A run made on the same machine since then narrows it again: a test file you ran
after the record is selected from the commit it last ran at.

None of these rows skips a test the change needs on the record's word, so a
stale record costs time. One case it cannot see: a file added after the record
that a test reaches by scanning a directory, not by an import, selects nothing
until a record that holds it is read, as [sharing](sharing.md#a-suite-your-checkout-has-not-recorded)
describes. How much time depends on which tests the mainline's
commits in between change, so one commit to a module every test imports runs
every test. [Where selection widens](selecting.md#where-selection-widens) lists
the other changes that run more than the diff.

## How a record changes on one machine

Each checkout keeps one record per suite in [the cache](cache.md), and each
wrapped run of that suite writes it. A [worktree](cache.md#worktrees) keeps its
own:

| When | What happens to the checkout's record |
| --- | --- |
| the first run, with nothing to start from | it runs every test file and writes the first record |
| the first run, on a machine that fetched the mainline's record from a share | it starts from a copy of that record, and says so |
| a worktree's first run, with nothing fetched | it starts from a copy of the primary checkout's record, and says so |
| a run of some test files | their rows are replaced; every other row stays |
| a newer mainline record is fetched, at a commit your branch contains | the checkout's record changes to it, and keeps the rows of the test files you ran since |
| a `variance` upgrade | the next run adds to the record, replaces it, or fails after its tests and names it: [after an upgrade](cache.md#after-an-upgrade) |

A command reads the checkout's own record first, then the mainline's from a
share, then, in a worktree, the primary checkout's: [a suite your checkout has
not recorded](sharing.md#a-suite-your-checkout-has-not-recorded) has the order
and the line each one prints. [What is removed, and
when](cache.md#what-is-removed-and-when) lists how long fetched copies stay,
and [start cold](cache.md#start-cold) deletes the record.

## How other machines get the mainline's record

One run writes the mainline's record: the whole suite, run on a push to the
mainline. Every other machine either records for itself or reads a copy of that
run. There are three ways:

| | No transport | The CI host's cache | A share |
| --- | --- | --- | --- |
| Who writes | each checkout, for itself | a push to the mainline in CI | a push to the mainline in CI |
| Who reads it | that checkout | CI jobs of the same repository | CI jobs, laptops, worktrees and agents |
| What you set up | the wrapped runner config | a cache step | a `share` section, a publish step, and a credential that writes |
| The record a CI job reads | none: every test file runs | the last mainline push that saved | the latest publish, or with a git share the one at your merge base |

### No transport: every machine records its own

Wrap the runner and run it. The first run on each checkout runs every test
file, and each run after that selects from the record it wrote. A fresh CI
machine has none, so in CI every run is the full suite. Choose this to try
selection on one machine, or when CI time is not what you are paying for.

### The CI host's cache

The mainline's push saves the cache directory, and each pull request restores
that save; a pull request never saves over it. [In CI](cache.md#in-ci) has the
GitHub Actions workflow; on another CI host, the same save on a mainline push
and restore on a pull request use that host's cache. [`variance carry`](../packages/cli/README.md#what-the-next-job-reads)
prints the paths and keys for a suite with `"carry": "actions-cache"`, and
[review coverage on every pull request](review-coverage.md) uses this
transport with no steps of your own. Laptops and agents never read it.

### A share

A [share](sharing.md) is a store your mainline's CI publishes to and every
checkout reads from, so a laptop's first selection starts from CI's run of the
whole suite. It keeps one line per branch, the latest entries published from
that branch, and `select` reads only the mainline's. Choose the store by what
you already run:

- [the repository's own refs](sharing.md#the-repositorys-own-refs), when CI can
  push to the repository. It also keeps each mainline publish at its commit,
  so a branch reads the record at its own merge base once that commit's CI
  has published, and the newest one behind it until then.
- [a directory](sharing.md#a-directory), when CI and readers share a mount.
- [an HTTP endpoint](sharing.md#an-http-endpoint), including a
  [Tribunal](../packages/tribunal/README.md) deployment, when you run a store
  that takes a bearer token. A bucket needs a [signing
  service](sharing.md#s3-and-google-cloud-storage) in front of it.

[Publishing](sharing.md#publishing) says which runs write which line, and
[what a line keeps](sharing.md#what-a-line-keeps) says which publish wins and
what is never deleted. When a share does not answer, a command reads the
record this machine fetched from it earlier, and with none, runs as with no
record: [when a share fails](sharing.md#when-a-share-fails).

### Several suites or projects in one repository

Declare each suite under `suites` in the root `variance.config.json`, and each
gets its own record and its own `carry`. Only a suite whose `carry` is
`"share"` publishes to the share and reads from it; the others keep a record on
each machine:
[one record for each suite](execution-record.md#one-record-for-each-suite).
`select` and `review` read every suite's record from the share the root config
names. A project with a config of its own publishes its run reports to the
share that config names, so give each one its own location: [what a line
keeps](sharing.md#what-a-line-keeps).

## Options for pull requests, merge queues and shards

Each of these decides which record a CI job selects from, or what it is
compared with. The next-push keys and the merge-queue publish work on GitHub
Actions only:

- **[Test a pull request on the record's commit](sharing.md#a-pull-request-that-runs-the-mainlines-changes-too)**
  with `variance carry merge`, which merges the pull request into the record's
  commit, so the mainline's commits since the record are not counted as its
  change.
- **[Keep a pull request's record for its next push](selecting.md#a-pull-requests-next-push)**
  with `variance carry keep` and `take`, so each push runs what changed since
  the last one.
- **[Publish the merge queue's run](sharing.md#the-merge-queues-record-as-soon-as-the-commit-lands)**
  with `variance share --publish --from-queue`, so the landed commit has a
  record before the mainline's whole run finishes.
- **[Hand every shard one record](sharding.md#run-a-failed-shard-again)** with
  `variance carry hand` and `receive`, so every shard and every re-run selects
  from the same record of each suite the share serves.

## Choose by your situation

| Your situation | What to set up | The record each job selects from |
| --- | --- | --- |
| One machine, or trying it out | nothing beyond the wrap | your own last run; CI runs every test file |
| CI time only | the CI host's cache, with a selecting run on pull requests | the last mainline push that saved; laptops record their own |
| Laptops and agents should select from CI's run | a share, published on each mainline push | the latest publish; a git share gives each branch the one at or behind its merge base |
| A busy mainline | a share and `carry merge` | the mainline's latest, with the pull request merged into its commit, so only the pull request's change counts |
| A merge queue | `--from-queue` on the push | the queue's run, from the moment the commit lands |
| Many pushes per pull request | `carry keep` and `take` | the last push's, over the mainline's |
| A sharded suite | a share, `carry hand` and `receive` | one record for every shard and re-run |
| Pull requests from forks | a git share | the mainline's; an HTTP share has no token there, so the fork runs every test file |
| GitLab CI, Bitbucket Pipelines or another CI | the CI host's cache | the last mainline push that saved; only GitHub Actions publishes a mainline line to a share, so laptops record their own |
| A monorepo | a suite per runner config under the root config, each with `"carry": "share"`, and a share location per project config | each suite's own last publish |
