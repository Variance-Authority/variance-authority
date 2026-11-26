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
| behind your merge base | those, plus the tests every mainline commit in between changes |
| past your merge base, as when a pull request's check merges into the mainline's tip | those, plus the tests the mainline's commits since the record change |
| none, or one this version cannot read | every test file |

A run made on the same machine since then narrows it again: a test file you ran
after the record is selected from the commit it last ran at.

None of these rows skips a test the change needs, so a stale record costs time,
never a missed failure. The cost grows with what the mainline changed in
between, not with the count of commits: forty commits of documentation cost
nothing, and one commit to a module every test imports runs every test. A record
many commits behind usually means nothing has published to the mainline since:
[when a share fails](sharing.md#when-a-share-fails) lists why. [Where selection
widens](selecting.md#where-selection-widens) lists the other changes that run
more than the diff.

## How a record changes on one machine

Each checkout keeps one record per suite in [the cache](cache.md), and each
wrapped run of that suite writes it. A [worktree](cache.md#worktrees) keeps its
own. What a run finds there decides what it does:

| When | What happens to the checkout's record |
| --- | --- |
| a run finds no record and nothing fetched | the run executes every test file and writes the first record |
| a run finds no record, and this machine fetched the mainline's record of a suite the share serves | the run copies the mainline's record into place, says so, and adds its own runs over it |
| a worktree's run finds no record and nothing fetched | it copies the primary checkout's record, and says so |
| a run of some test files | their rows are replaced, and every other row stays as it was |
| `select` or `variance share --suite` fetches a newer mainline record whose commit your branch contains | the checkout's record changes to that one; a test file you ran keeps your rows when it ran at that commit or after it |
| a newer mainline record your branch does not contain | nothing changes until you merge the mainline or rebase onto it |
| a `variance` upgrade changes how tests are recorded | the next run replaces the record and runs the suite once in full, as [after an upgrade](cache.md#after-an-upgrade) explains |
| an upgrade changes the file's layout | the next run fails, naming the file: [start cold](cache.md#start-cold) |
| the checkout is deleted | its record is removed with it |

Beside each record, `coverage.layer.json` lists the test files your own runs
observed and the commit each ran at, so a selection can tell your runs from
the mainline's.

Where a command finds a record, in this order:

1. The checkout's own record.
2. The mainline's record, for a suite the share serves: the one published at
   your merge base when the share keeps it, otherwise the newest behind your
   merge base, otherwise the newest.
3. In a worktree, the primary checkout's record, when nothing was fetched.

[A suite your checkout has not
recorded](sharing.md#a-suite-your-checkout-has-not-recorded) has every rule
and message of that order. The fetched copies sit under
`<cache>/share/read/<suite>/<commit>/`, apart from the checkout's own, and
are removed once your `HEAD` is more than 200 commits past them, or after 14
days when your branch does not contain their commit. `variance prune` checks
now: [what is removed, and when](cache.md#what-is-removed-and-when).

## How other machines get the mainline's record

One run writes the mainline's record: the whole suite, run on a push to the
mainline. Every other machine either records for itself or reads a copy of that
run. There are three ways:

| | No transport | The CI host's cache | A share |
| --- | --- | --- | --- |
| Who writes | each checkout, for itself | a push to the mainline in CI | a push to the mainline in CI |
| Who reads it | that checkout | CI jobs of the same repository | CI jobs, laptops, worktrees and agents |
| What you set up | the wrapped runner config | a cache step, or [`variance carry`](../packages/cli/README.md#what-the-next-job-reads) on GitHub Actions | a `share` section, a publish step, and a credential that writes |
| How old a CI record is | a new CI machine has none: every test file runs | the last push to the mainline that saved | the latest publish, or with a git share the one at your merge base |
| When the record is gone | every test file runs | every test file runs | every test file runs, and the lookup says why |

### No transport: every machine records its own

Wrap the runner and run it. The first run on each checkout executes every test
file and writes the record, and each run after that selects from it. Nothing
leaves the machine. A fresh CI machine has no record, so in CI every run is
the full suite, and so is the first run after each clone. A worktree starts
from the primary checkout's record. Choose this to try selection on one
machine, or when CI time is not what you are paying for.

### The CI host's cache

The mainline's push saves the cache directory, and each pull request restores
the newest save on its target branch. A pull request never saves under the
mainline's key, because `variance review` would then compare the change with
itself.
[In CI](cache.md#in-ci) has the GitHub Actions workflow and the five things in
it that decide whether a pull request selects. Give a suite
`"carry": "actions-cache"` and [`variance carry restore` and
`save`](../packages/cli/README.md#what-the-next-job-reads) print the path and the
keys for `actions/cache` instead: only a push to a mainline saves, and a pull
request into a branch that saves nothing, such as the base of a stacked pull
request, restores what a mainline saved. [Review coverage on every pull
request](review-coverage.md) uses this transport with no steps of your own.

The record lasts as long as the host keeps the cache entry. Laptops and agents
never read it: each records its own, as with no transport.

### A share

A [share](sharing.md) is a store your mainline's CI publishes to and every
checkout reads from, so a laptop's first selection starts from CI's latest run
of the whole suite. Give a suite `"carry": "share"` and add a `share` section.
A share keeps one **line** per branch, `mainline/<name>` or `branch/<name>`:
the latest entries published from that branch. There are four kinds of store:

| Store | What it keeps | Choose it when |
| --- | --- | --- |
| [the repository's own refs](sharing.md#the-repositorys-own-refs) (`kind: "git"`) | each mainline publish at its commit, under `refs/variance/at/<commit>/`, so a branch reads the record at its own merge base | your CI can push to the repository; this one needs no other service |
| [a directory](sharing.md#a-directory) | the latest publish of each line | CI and readers share a mount, or something syncs it |
| [an HTTP endpoint](sharing.md#an-http-endpoint) | the latest publish of each line | you run a store that takes a bearer token |
| a [Tribunal](../packages/tribunal/README.md) deployment, [configured as an HTTP share](sharing.md#a-tribunal-deployment) | the latest publish of each line | you run Tribunal: its ingest token publishes, its share token only reads |

A bucket in S3 or Google Cloud Storage needs a service in front of it that
signs requests: [S3 and Google Cloud
Storage](sharing.md#s3-and-google-cloud-storage).

What each run publishes depends on where it runs, and [publishing](sharing.md#publishing)
has every case:

- **A push to a mainline on GitHub Actions** writes the mainline's line. A
  suite's record is published there only from a run of the whole suite:
  [`share --publish <records> --collected <list>`](sharing.md#a-suite-with-no-run-report)
  compares the record with the test files your runner collects, and refuses a
  selected run with exit 2. A test file the runner no longer collects leaves
  the published record.
- **A pull request from a branch of this repository** writes its branch's line,
  so `variance ask` on that branch can answer from CI's run. `select` never
  reads a branch line: a branch's record would measure the change against
  itself.
- **A pull request from a fork, a merge-queue run and a scheduled run** write
  nothing.
- **On GitLab CI, Bitbucket Pipelines or a laptop**, the line comes from the
  checkout's branch, and a mainline is never written. A share published only
  from those hosts has no mainline record, and every checkout runs every test
  file.

On a mainline line, a slow run of an older commit that finishes last never
replaces a newer commit's record, and a CLI never replaces an entry in a format
newer than it writes. Nothing deletes a line. A git share keeps every mainline
publish until `variance share --purge-older-than <days>` deletes those older
than that; a directory or an HTTP store keeps only the latest of each line, and
an entry or image no manifest names stays until you, or a bucket lifecycle
rule, remove it. [What a line keeps](sharing.md#what-a-line-keeps) has the
rules.

A reader needs the same `share` section and, for an HTTP store, a token that
reads. A share that does not answer, refuses the token or has nothing
published is a miss: `variance share` exits 0, prints why, and selection runs
as with no record. A pull request from a fork gets no secrets, so with an HTTP
share its lookup is a miss and it runs every test file. A git share is fetched
from the base repository's `refs/variance/` with the credential the clone has
for it, so a fork's pull request in a public repository reads it with its
read-only token.

### Several suites or projects in one repository

Declare each suite under `suites` in the `variance.config.json` at the
repository root. Each has its own record, its own `carry`, and its own entry
on the share, and a publish can include several:
[one record for each suite](execution-record.md#one-record-for-each-suite).
With no suites declared, every wrapped runner config in the checkout writes to
one record at the repository root; run them in one CI job, because a cache key
saves once.

One share serves one `variance.config.json`, and line names do not include the
project. Each project that has its own config needs its own `root`, `endpoint`
or `namespace`. `select` and `review` read the share of the root config, the
one that declares `suites`.

## Options for pull requests, merge queues and shards

Each of these changes how far a CI job's record is from what it tests. Every
one runs on GitHub Actions; [what the next
job reads](../packages/cli/README.md#what-the-next-job-reads) has the steps for
each.

### Test a pull request on the record's commit, not the mainline's tip

A pull request's check runs on the head merged into the mainline's tip, and
the mainline's record is at an older commit whenever the mainline changed after
its last publish. Those commits count as the pull request's change.
`variance carry merge <commit>` merges the head with the record's commit
instead, so the diff is the pull request alone. The cost: this run does not
test your change with what the mainline gained since. Your merge queue, a
required up-to-date branch or a rebase tests that before the merge.
[A pull request that runs the mainline's changes
too](sharing.md#a-pull-request-that-runs-the-mainlines-changes-too) has the
workflow. `carry merge` takes the head from the pull request's event, or from
`--head <sha>`.

### Carry a pull request's record to its next push

Each push to a pull request is a fresh CI machine, so it selects the whole
change again. `variance carry keep` saves what this push ran, red or green,
under a cache key only that pull request restores, and `variance carry take`
lays it over the mainline's record on the next push. The next push runs what
changed since the last one, and every test file the last one did not finish
green. `variance review --against` still compares the change with the
mainline's cases, never with the last push's. The key is printed only on a
`pull_request` run: [a pull request's next
push](selecting.md#a-pull-requests-next-push).

### Publish the merge queue's run before the mainline's

A merge queue tests the commit that lands, so its run can stand as the
mainline's record of that commit before the push's whole run finishes.
`variance share --publish --from-queue` on the push publishes it marked as
partial: the tests the queue ran stand at the new commit, every other keeps the
record the mainline had, and the whole run's publish at that commit replaces
it. A partial record never replaces a whole one. It reads the queue's run with
`gh`, from the `merge_group` event: [the merge queue's
record](sharing.md#the-merge-queues-record-as-soon-as-the-commit-lands). Inside
the queue, `variance select --ran-at` skips the test files only one side of
the merge changes: [a pull request in the merge
queue](selecting.md#a-pull-request-in-the-merge-queue).

### Hand every shard one record

Shards that each ask the share can read two records, if a publish lands
between them, and split the files two ways. `variance carry hand` reads the
share once in a planning job, an artifact takes the result to each shard, and
`variance carry receive` lays it down, so a re-run of a failed shard selects
what it selected the first time. Keep the artifact 30 days, as long as GitHub
re-runs a job: [run a failed shard again](sharding.md#run-a-failed-shard-again).
On the push to the mainline, the publish folds every shard's record into one.
A build with no record places shards by file count: [when nothing is
recorded](sharding.md#when-nothing-is-recorded).

## Choose by your situation

| Your situation | What to set up | How old the record is, and what it costs |
| --- | --- | --- |
| One machine, or trying it out | nothing beyond the wrap | your own last run; CI runs every test file |
| GitHub Actions, CI time only | the CI host's cache, or the review action | the last mainline push that saved; laptops record their own |
| Laptops and agents should select from CI's run | a share, published on each mainline push | the latest publish; a git share gives each branch the record at its merge base |
| A busy mainline, where every check merges into a newer tip | a git share and `carry merge` | the pull request's diff alone; the merge queue or an up-to-date branch tests the rest |
| A merge queue | `--from-queue` on the push, `--ran-at` inside the queue | the queue's commit is readable before the mainline's whole run publishes |
| Many pushes per pull request | `carry keep` and `carry take` | each push runs what changed since the last |
| A sharded suite | `carry hand` and `carry receive`, and one publish of every shard's record | every shard and every re-run reads one record |
| Pull requests from forks | a git share, which the job reads with its read-only token | the mainline's record, as for any pull request; an HTTP share has no token there, so the fork runs every test file |
| GitLab CI, Bitbucket Pipelines or another CI | no transport | each machine's own last run; a share published from these hosts writes branch lines only, so it gives selection no mainline record |
| A monorepo | a suite per runner config under `suites`, each project's share its own `root`, `endpoint` or `namespace` | each suite's record is as old as its own last publish |
| After a `variance` upgrade | nothing | one full run per suite, unless the fetched mainline record is already under the new recipe |
