# Read CI's latest run from your checkout

A **share** is a store where CI publishes what each run found, for commands on
your checkout to read. `variance ask` and `variance serve` answer questions about
CI's latest run from the report that run wrote, when your checkout has no run of
its own. `variance select` names the test files a change lets you skip, and
`variance review` counts the changed code no test covered; where your checkout
has no recording to measure the change from, both read which tests ran which
lines on your mainline, the branch your other branches merge into.
`variance share` publishes a run, or prints how far the mainline's latest
publish is from your checkout.

A share keeps no history. For each branch it keeps one copy of each file a run
publishes, and the next publish of that file replaces it, unless the branch is a
mainline and has that file at a newer commit. It is stored as refs in the
repository that hosts your code, in a directory, or behind an HTTP endpoint such
as a deployment of [Tribunal](../packages/tribunal/README.md), the self-hosted
review service.

New here? Start with [your first run](start.md).

The CLI is a devDependency, and every command below is run through it:

```bash
npm install --save-dev @variance-authority/cli
```

A share does not replace [`baselines`](../packages/cli/README.md#configuration).
The baselines are the images a run compares against, and `baselines.carry`,
the [setting that names who takes a file to the next machine](#what-a-share-stores),
refuses `"share"`. Everything in a share was derived from a commit the share
names beside it, so losing a share costs you a run of the suite, and losing a
baseline costs you the comparison.

## The words this page uses

- **Line** — the place in a share for one branch: a manifest and the entries it
  lists. A publish replaces the entries it offers, so a line keeps one of each.
- **Mainline** — a branch your other branches start from and merge into, such
  as `main`. Its line is `mainline/<name>`.
  [Which branches are mainlines](#which-branches-are-mainlines) says how the CLI
  decides.
- **Branch line** — the line of any other branch, `branch/<name>`.
- **Entry** — one file a run publishes to a line. Its name states its format
  version, such as `suite-index-v1`, and it names the commit it was derived at.
- **Record** — the entries a line has now, which may come from several runs.
- **Manifest** — the file of a line that lists its entries: each entry's name,
  commit and digest.
- **Run report** — the JSON file `variance run` writes at the path `report`
  names in `variance.config.json` (`report.path` when `report` is an object),
  `.variance/report.json` by default.
- **Subject** — one UI state a run captures, such as one story, under an id that
  stays the same from run to run, such as `cart/empty`.
- **Suite** — a set of tests you declare under `suites` in the
  `variance.config.json` at the repository root, with an [execution record of
  its own](execution-record.md#one-record-for-each-suite): which tests ran which
  lines.

## What a share stores

| Entry | What it is | Published when |
| --- | --- | --- |
| `suite-index-v1` | the [suite index](lexicon.md#where-it-is-kept) of the run | the run report has a [composition](composition.md) section and names a commit |
| `subject-costs-v1` | what each subject took to collect, in whole milliseconds, and the file that declares it | the run report timed a subject, and is not one shard of a sharded build |
| `report-v1` | the run report byte for byte, and a table from each image path it names to that image's digest | `report.carry` is `"share"` |
| `suite-v1/<suite>` | that suite's execution record, as this machine recorded it | the suite's `carry` is `"share"`, its execution record here was recorded at the run report's commit, and the line is a branch's: a mainline takes it only from [`share --suite`](#a-suite-with-no-run-report) |

Every publish includes `suite-index-v1`, which is what `variance share` reads,
and the other entries are published only beside it. A run report has no
composition section, the part that records which subjects mounted which
components, when it comes from a run that read no markup (a raster-only
capture, or a run whose collector gave only images), or from one shard of a
sharded build. It gives no suite index, and a publish of it writes nothing and exits 0.

An image is stored once per share, under `images/<digest>`, and every record
names it by digest.

`carry` names who takes a file to the next machine: `"share"` is
`variance share`, and `"actions-cache"` is your CI host, job to job, at the paths
and keys [`variance carry`](../packages/cli/README.md#what-the-next-job-reads)
prints. `report.carry` and a suite's `carry` are set in `variance.config.json`,
where `suites` declares your test suites and `subjects` what a run captures:

```json
{
  "report": { "path": ".variance/report.json", "carry": "share" },
  "suites": { "stories": { "kind": "visual", "carry": "share" } },
  "share": { "kind": "git" }
}
```

- **A run report or execution record with no `carry` stays on the machine that
  wrote it.**
- **`"carry": "share"` needs a `share` section in the same file.** A config that
  sets it without one is refused, and the message names the key.
- **A suite's execution record is the one this machine has**, at
  `<cache>/test-selection/<repository>/suites/<name>/coverage.bin`, where
  [`<repository>`](cache.md#what-is-in-it) is a digest of your checkout's path.
  The [runner integration](execution-record.md#one-record-for-each-suite) you
  run the suite under writes it; `variance run` does not. When it was
  recorded at another commit, names no commit, or does not read, the publish
  leaves that suite out, publishes the rest of the run, and prints why:

  ```text
  left out suite-v1/stories: its record at <path> was recorded at 5d0c…, not at 3f1c….
  ```

  A suite this machine has no execution record of is not published, and
  nothing is printed for it: each job publishes the suites it ran.

The suite index is one binary file with four things in it:

| In the file | What it is |
| --- | --- |
| the census | which component was mounted in how many subjects, and which subject shows each one with the fewest other components around it |
| the subject denominator | the ids of the subjects that contributed a capture: the total each census count is divided by |
| the [lexicon](lexicon.md) | per subject, the words and names read off it, in the nine fields [the lexicon lists](lexicon.md#what-the-run-writes-down) |
| the commit | the revision all of the above was read at |

A suite index lists only the subjects its own run captured: two runs that
capture the same subjects at one commit write the same bytes. A sharded build's
index is composed from every shard's part, so it lists what one run over the
whole suite would have.

### What it exposes

The lexicon records accessible names and visible text as the run read them off
your rendered UI — `Clear completed`, `--va-space-2`, `src/todo/TodoFooter.tsx`
— beside your component names and file paths, and a published run report adds
its images. A share is as sensitive as your source plus whatever your test
states put on screen, so give it the audience you give the repository.

Text an [ignore](ignores.md) declared volatile — a clock, a feed, an order
number — is the exception: it is digested before the lexicon is written, so the
suite index never stores it as words. An ignore never changes an image, so a
published run report's images still show it.

## What a line keeps

A share has three kinds of path, whatever it is stored in:

```text
mainline/<name>/    the record of each mainline
branch/<name>/      the record of each branch
images/<digest>     every image a record names, stored once
```

There is no history. Your branches are brought up to date with a mainline
before they merge, by a merge queue, a required up-to-date branch or a rebase,
so the question for your checkout is *what is mainline now, and how far am I
from it*, and every lookup prints that distance.

**A publish replaces only the entries it offers.** Two jobs that publish
different suites at one commit leave both `suite-v1` entries on the line. Each
also offers `suite-index-v1`, and `report-v1` when the report is shared, so the
line keeps those two from the job that published last: for a sharded run, the
last shard's, covering that shard's subjects only. For an entry the line
already has:

- **On a mainline, the line keeps its entry when that entry's commit strictly
  descends from the offered one.** That is a slow run of an older commit
  finishing last:

  ```text
  kept suite-index-v1: the line holds it at 9ab2…, which descends from this run's commit.
  ```

  Git answers descent for every kind of share. When the held entry is from
  another commit, the publish fetches the mainline's commits without trees
  (`--filter=tree:0`) from `share.remote` into a bare repository under
  `<cache>/share/`, never into your clone. When git cannot answer, the offered
  entry replaces the held one:

  ```text
  replaced suite-index-v1 without knowing whether the held commit was newer: git could not answer.
  ```

  After a force-push nothing descends, and the next publish replaces the entry.
- **On a branch line, the offered entry always replaces the held one.** A rebase
  leaves no descent to test. The cost: a slow run of an older commit that
  finishes last replaces the newer one, and a reader on the branch sees it as
  `N commit(s) before HEAD`.
- **On any line, an entry in a newer format is kept**, so an older CLI does not
  replace it:

  ```text
  kept suite-index-v2: the line holds it in a newer format, at 9ab2….
  ```

In git, in a directory every writer mounts, or in an `http` store that sends an
`ETag` and honours `If-Match` (Tribunal does), two jobs that publish to one line
at once do not lose each other's entries. Each writes the manifest against the
version it read, and the one that loses reads the line again and decides
again, so for an entry both offer, the later write wins unless the mainline
rule keeps the earlier. After 8 attempts it prints
`nothing published to <line> in <store>: the line moved under 8 writes in a row; nothing was published.`
and exits 0.

**Line names are folded.** In each `/`-separated part of a branch name, every
run of characters outside `A-Z`, `a-z`, `0-9`, `.`, `_` and `-` becomes one `-`,
and leading and trailing `-` and `.` are removed. An empty part is dropped, and
a name with nothing left is `unnamed`. Case is kept.

- **Two names that fold to one are one line.** `feat/cart+page` and
  `feat/cart-page` both write `branch/feat/cart-page`, and the last publish
  replaces the other's entries. A reader on either branch may read the other's
  run, marked as *another run of* its branch.
- **Case on a case-insensitive disk.** `Feature` and `feature` are two lines by
  name, and storage that treats them as one name keeps the first one published.
  The other is refused, and neither line reads or replaces the other's entries:
  - **A directory share** refuses a publish to the other spelling with a message
    that names the line and both spellings, and a lookup of it prints *nothing
    is published there*.
  - **A Tribunal deployment running on Node** answers a publish to the other
    spelling with HTTP 422, which the publish prints as a refusal with the
    deployment's reason, and answers a read of it with 404. Put
    `VARIANCE_TRIBUNAL_STORAGE` on a case-sensitive volume to keep both.

  A directory share on a case-sensitive disk, and a Tribunal deployment on
  Cloudflare R2 or on a case-sensitive volume, keep two lines. Your own `http`
  endpoint receives each spelling as written, and keeps two lines when it
  stores paths case-sensitively.

**Nothing deletes a line**, so a branch's line outlives the branch. In a
directory or `http` share, an entry or image no manifest names stays until you,
or a bucket lifecycle rule, remove it. In a `git` share, the next publish writes
a tree without it, and your host's garbage collection removes it.

**One share serves one `variance.config.json`.** `variance` reads the file in the
current directory, or the one `--config` names, and each project in a repository
has its own, with its own `project` and `share`. Line names do not include the
project, so give each project's share its own `root`, `endpoint` or `namespace`.
`select` and `review` read the `share` of the root file, the one that declares
`suites`, so they read the suites a publish with that file wrote.

## Which branches are mainlines

`share.mainlines` lists them, in order of priority:

```json
{ "share": { "kind": "git", "mainlines": ["main", "release/2.0"] } }
```

When you leave it out, the first of these that answers names the one mainline:

1. `refs/remotes/<remote>/HEAD` in your clone.
2. On GitHub Actions, the event's `repository.default_branch`.

`main` is never assumed. `"mainlines": []` is refused; leave the key out
instead.

When nothing answers — no `share.mainlines`, no remote `HEAD` and no event:

- **A publish still writes the run's branch line**, and prints, after saying
  what it wrote:

  ```text
  no mainline: nothing answered from config, remote-head, event, so this run's line is branch main.
  ```

  A pull request's publish does not print this, because its line is its head
  branch whatever the mainlines are.
- **A lookup reads nothing**, and prints:

  ```text
  no mainline: nothing answered from config, remote-head, event.
  ```

`share.remote` names the remote the mainlines are on, `origin` unless you set
it. The remote's `HEAD`, the distance a lookup prints and the descent a publish
checks are all read from it.

## Publishing

Every `npx variance run` keeps its suite index in [your cache](cache.md), under
the commit the run report names, and prints where:

```text
suite index: <cache>/suite/checkout-ui/3f1c…bd.bin
```

That is `<cache>/suite/<project>/<commit>.bin`, where `<project>` is your
config's `project`.

It prints this line only when the run report has a composition section and
names a commit. You publish after the run, from each job whose entries the line
should include:

```bash
npx variance share --publish
```

It reads the run report `report` names, or the path you give as the last
argument. Name several, and they are the shards of one build; see
[A sharded build](#a-sharded-build).

**The commit comes from the run report.** `variance run` names the run from
`--run <id>` and `--commit <sha>` when you pass both, anywhere. Otherwise it
takes the first pair in this table whose two variables are both set:

| CI | Run id | Commit |
| --- | --- | --- |
| GitHub Actions | `GITHUB_RUN_ID` | `GITHUB_SHA` |
| GitLab CI | `CI_PIPELINE_ID` | `CI_COMMIT_SHA` |
| Bitbucket Pipelines | `BITBUCKET_BUILD_NUMBER` | `BITBUCKET_COMMIT` |

The two flags are a pair, and one without the other is ignored: on CI the run
takes both from the table, and anywhere else the run report names no commit. A
run report that names no commit publishes nothing, prints
`nothing published: this report names no commit.` and exits 0.

**The line depends on where the publish runs.** On GitHub Actions
(`GITHUB_ACTIONS=true`):

| The run | What it writes |
| --- | --- |
| a push to a mainline | `mainline/<name>` |
| a push, or any other event, on a branch that is not a mainline | `branch/<name>` |
| a `pull_request` or `pull_request_target` from this repository | `branch/<head branch>` at `GITHUB_SHA`, the merge commit under `pull_request` and the base branch's tip under `pull_request_target`, with the head commit beside it |
| a pull request from a fork, under either event | nothing, whatever its token may write |
| a merge queue: a `merge_group` event, or a `gh-readonly-queue/` branch | nothing: *a merge-queue run publishes nothing; its branch is temporary* |
| any other event on a mainline, such as `schedule` | nothing: *only a push to main publishes its record, and this run is a schedule* |
| a tag, or any other ref that is not a branch | nothing: *this run is not on a branch* |

Anywhere else, the publish reads your checkout:

| The checkout | What it writes |
| --- | --- |
| on a branch that is not a mainline | `branch/<name>` |
| on a mainline | nothing: *only a push to main publishes its record, and this run is not on CI*. The remote may not have your commit yet; then git cannot order it against the line's entries, and a publish git cannot order replaces them |
| detached | nothing: *this checkout is not on a branch* |

**Only GitHub Actions' variables choose the line.** On GitLab CI and Bitbucket
Pipelines, the run id and commit come from the first table, and the line from
the job's checkout, read as a checkout off CI:

- a job that checks out a branch that is not a mainline by name, for example
  with `git checkout -B "$CI_COMMIT_REF_NAME"`, writes `branch/<name>`;
- a detached job writes nothing, and so does a job on a mainline, which prints
  *this run is not on CI*.

A share published only from those CIs therefore has no mainline line, and
`ask`, `serve`, `select` and `review` find no mainline record in it.

The publish prints what it did, and where:

```text
wrote suite-index-v1, report-v1, subject-costs-v1 to mainline main in refs/variance on origin.
```

The store is named as `<namespace> on <remote>` for a `git` share, `the
directory <root>`, or `the endpoint <url>`. For a publish the store did not
take, the CLI prints why, with the same reasons a lookup gives:

```text
nothing published to branch feat/cart in the endpoint https://variance.example.com/share: https://variance.example.com/share/branch/feat/cart/manifest.json: HTTP 403.
```

With `report.carry` set to `"share"`, an image the run report names that this
machine could not read is left out, and the run report is still published:

```text
left out 2 image(s) the report names and this machine could not read, the first at /home/runner/work/web/.variance/renders/cart-empty.png.
```

The same publish gives the line `subject-costs-v1`: what each subject took to
collect, under the same commit. `npx variance run --shard k/n` reads it back
from the mainline to split the suite evenly, and a run with `workers` reads it
to take the slowest files first. `npx variance ask costs` reads the same line to
show you, or an agent, which files and subjects the suite spends its time on;
see [the command-line questions](agent-cli.md#find-where-the-suites-time-goes).

### A sharded build

A sharded build publishes once, from the job that holds every shard's run
report. A shard keeps no index and publishes none: its census counts part of the
suite, and an index written from it would be read as the whole suite. Each shard
writes its part of the index beside its run report instead, as
`report.suite-part.json` next to `report.json`, and prints where:

```text
suite index: not kept from one shard; its part is .variance/report.suite-part.json, for the merge
```

Name every shard's run report to `share --publish`. It composes the index one
run over the whole suite would have written — the same census, the same
lexicon, counted across every shard — keeps it, and publishes it with the costs
of the merged run report:

```bash
npx variance share --publish shard-1/report.json shard-2/report.json shard-3/report.json
```

```text
suite index at 3f1c…bd, composed from 3 shard(s): <cache>/suite/checkout-ui/3f1c…bd.bin
wrote suite-index-v1, subject-costs-v1 to mainline main in refs/variance on origin.
```

Keep each part beside its run report when you move the reports between jobs.
The command publishes nothing, and names the file, when a run report has no part
beside it, when a shard is missing, or when you name one shard's run report
alone. A build that does not shard publishes from its own run and needs no extra
job.

## Looking up mainline's record

```bash
npx variance share
```

reads the suite index of the mainline your checkout is measured against:

- **On a GitHub Actions pull request**, the base branch that `GITHUB_BASE_REF`
  names, when it is one of your mainlines.
- **Otherwise**, the mainline whose merge base with `HEAD` is the fewest commits
  from `HEAD`. A tie, or a clone that cannot count, picks the first one listed.
- **`--mainline <branch>`** names one yourself.

```text
mainline main evaluated at 3f1c9a2…, 2 commit(s) behind the merge base with this checkout, read from the share.
412 subject(s), 168 component(s), lexicon over 9 field(s) of 412 subject(s)
at <cache>/suite/checkout-ui/3f1c9a2….bin
```

`evaluated at` names the commit the publishing run ran at, which the manifest
names. When this machine already has a suite index at that commit, the lookup
reads that one instead of fetching, and the first line ends in
`read from this machine`. What the share returns is written under that commit,
so the next command reads it from disk.

**The distance is counted from `HEAD`'s merge base with
`refs/remotes/<remote>/<mainline>`**, so run `git fetch` first:

- `at the merge base with this checkout`
- `N commit(s) behind the merge base with this checkout` — the record is older
  than your merge base.
- `N commit(s) past the merge base with this checkout` — the record is newer.
- `at a distance this clone cannot count` — your clone has no
  `refs/remotes/<remote>/<mainline>`, does not have the record's commit, or
  neither commit descends from the other. A shallow clone that has both
  commits gets this too when its history between them is cut: `git rev-list
  --count` stops at the cut and prints a smaller number, so a count whose walk
  reaches the cut is not printed. The lookup still answers. To get the number,
  check out every commit and no trees: `fetch-depth: 0` with `filter: tree:0`
  on `actions/checkout`, as [a CI checkout needs](selecting.md#what-a-ci-checkout-needs). No fixed depth is enough, because both commits change
  while the branch is open.

A distance *past* the merge base means your mainline has changed since you
branched: update your branch to measure against it.

**A lookup that finds nothing prints why**, as `mainline <name>: <why>.`,
because each reason needs a different action:

| The message says | What to do |
| --- | --- |
| `nothing is published there` | publish from a push to that mainline |
| `it holds suite-index-v2, a format this version does not read` | upgrade the CLI |
| `no share is configured` | add a `share` section |
| `nothing answered from config, remote-head, event` | set `share.mainlines`, or run `git remote set-head origin --auto` |
| HTTP 401 or 403, git's authentication error, or a token variable that is not set | check the credential on this machine |
| another HTTP 4xx, with the store's reason after it | act on the store's reason |
| a timeout, an address that does not resolve, a connection error, HTTP 408 or 429, or a 5xx | check the store is reachable from this machine, and its own log for that request |
| a reason the bytes do not decode | publish to that line again, from a push when it is a mainline. A publish replaces a manifest that does not decode, and an entry unless a mainline has it at a commit that descends from the one published |

## A checkout with no run of its own

When `variance ask` or `variance serve` needs the run report and there is no
file at the path `report` names, it reads a run report from the share. That
needs `report.carry` set to `"share"` in the config CI publishes with. The order
is:

1. **Your own run report.** Only a missing file falls through to the share. A
   run report this process cannot open is still yours, and the error says why.
2. **Your branch's line.** The branch is `GITHUB_HEAD_REF` on a pull request,
   `GITHUB_REF_NAME` on a GitHub Actions branch run, or your checkout's branch.
   It is not read on a mainline, on a detached checkout, or on a pull request
   from a fork, where a line of that name belongs to a branch of the base
   repository.
3. **The mainline your checkout is measured against**, chosen as in [Looking
   up](#looking-up-mainlines-record).

A run report you name on the command line is read, or refused, and the share
is not read.

Every answer read from the share opens with a sentence starting `report:` that
says which line it came from. From a branch line:

```text
report: read from branch feat/cart, evaluated at 51ab09e… for pull request head 9c4e1d2…, 2 commit(s) before HEAD; kept at <cache>/report/<digest>/.variance/report.json.
```

The commit the run report was published at is compared with your `HEAD`, the
pull request head first when there is one:

- **`which is HEAD`**, or **`N commit(s) before HEAD`** — the record is from
  your history.
- **`which this checkout does not contain: another run of feat/cart, not this
  checkout's`** — the record is from a commit your history does not have: a
  run before a rebase, a colleague's run, or a branch whose name folds to the
  same line. It still answers.
- **`which this clone does not hold: read as another run of feat/cart, not this
  checkout's`** — your clone does not have the commit.

An answer from the mainline gives the [distance](#looking-up-mainlines-record)
a lookup prints, and when your branch's line did not answer, the reason follows
underneath:

```text
report: read from mainline main, evaluated at 3f1c9a2…, 2 commit(s) behind the merge base with this checkout; kept at <cache>/report/<digest>/.variance/report.json.
branch feat/cart: https://variance.example.com/share/branch/feat/cart/manifest.json: HTTP 403.
```

**The configured `report` path is never written.** The run report is kept in
[your cache](cache.md) under `<cache>/report/<digest>/`, where `<digest>` is the
entry's digest, at your configured report's path relative to the repository
root, or as `run.json` when that report is outside the repository. Its image
table is `<cache>/report/<digest>.images.json`. A second question that finds the
same digest in the manifest opens the kept files and fetches nothing.

**`variance ask` fetches images for the subjects a question names.** `ask
describe --subject cart/empty` fetches that subject's images and no others, by
digest, checks each one against its digest, and writes it at the relative path
the run report gives it, resolved from the kept run report's directory. An image
that is not fetched adds a line to the answer:

```text
image renders/cart-empty.png: it was not published with the report.
image ../../x.png: it names a path outside <cache>/report/<digest>, so it is not fetched.
image renders/cart-empty.png: the bytes the line holds do not match their digest.
```

**Your own run takes over when it exists.** After `variance run` writes your run
report, `ask` and `serve` read it. In `variance serve`, the first call to
`variance_diff`, the MCP tool that compares the report this answer reads with
the one the previous answer read (`variance ask diff` on the command line),
opens with the report it compares with:

```text
report: this checkout's own run, compared with the report the previous answer read from branch feat/cart at 51ab09e….
```

**When no line answers, `ask` exits 2 and `serve` does not start.** Both list
each line read, with its result:

```text
there is no run report at /work/web/.variance/report.json, which is where `report` in your configuration points, and the share holds none for this checkout:
  branch feat/cart: nothing is published there
  mainline main: it holds only suite-index-v1
```

*it holds only suite-index-v1* means CI publishes to that line without
`report.carry` set to `"share"`.

Without a `share` section, the same message ends with *`variance run` writes it
there, and no share is configured to read CI's from*.

`variance report`, `adjudicate`, `comment` and `push` do not read the share.
They [report on a run](../packages/cli/README.md#commands) your checkout made,
and it made none.

## A suite your checkout has not recorded

`variance select` and `variance review` measure a change from a suite's
execution record. For a suite whose `carry` is `"share"`, they can read the
`suite-v1/<suite>` entry the mainline published, and never a branch line's,
because a record of your own branch would measure the change against itself.

- **`select`** reads it when your checkout has no execution record of the suite.
- **`review`** reads it when `--since` names no base and the suite's first run
  at your `HEAD` started with no execution record here, as in a fresh clone.
  The lines your tests ran still come from your own record; the mainline's gives
  the commit to diff from. With no run of the suite here, it reads nothing and
  prints that you need to run the suite or pass `--since`.

Records are read in this order:

1. **Your checkout's own execution record.** In a git worktree, that is the
   worktree's own, not the primary checkout's.
2. **The mainline's record.** It is kept at
   `<cache>/share/read/<suite>/<commit>/coverage.bin`, apart from every record a
   run writes, so it is never read as your checkout's own. One fetch is reused
   for 10 minutes, and so is the result that the line has none for you, with the
   time of that result. After that, outside CI, `variance select` answers from
   the record fetched earlier and starts a process of its own that fetches the
   mainline's record again. The answer prints that process's id and the file
   its output goes to, and a command you run after it ends reads the new
   record. In CI, and for every other reader, the record is fetched before the
   answer. When the remote does
   not answer, the record fetched earlier is read, and the answer prints when it
   was fetched and why it was not fetched again.
3. **In a worktree, the primary checkout's record**, only when no mainline
   record was ever fetched on this machine. It is what that checkout last ran,
   so the answer names it as the offline fallback and prints why the mainline's
   was not read.

The answer prints which one it read:

```text
record of "stories": read from mainline main, published at 3f1c9a2…, 2 commit(s) behind the merge base with this checkout; kept at <cache>/share/read/stories/3f1c9a2…/coverage.bin
```

`variance share --suite <name>` queries the remote now, whenever the last fetch
was. Your test runner's integration never queries the remote. When its first run
in a checkout has no record to land on, it copies the mainline record last
fetched on this machine into the checkout's own place, with the runs record
that came with it, and prints that it did. None of those runs are the
checkout's own, so `variance review` finds no run listed until your first one,
which starts your change at that commit. With none fetched, a worktree's
first run copies the primary checkout's, and prints that it did.

That copy stays the mainline's. Your runs are laid over it, and beside the
checkout's record a ledger, `coverage.layer.json`, lists the test files your
runs observed and the commit each ran at, with the working tree's git tree when
it had uncommitted edits. When `select` or `variance share --suite` reads a
newer mainline record whose commit your HEAD contains, the checkout's record
moves onto it: every test file you did not run reads the newer record, and a
file you ran keeps your rows if it ran at that commit or after it. A newer
record of a commit your branch does not contain changes nothing, so long work
keeps the record it started from until you merge or rebase. The answer names
both:

```text
record of "unit": read from this checkout's own, over mainline main at 3f1c9a2…, 4 commit(s) before HEAD; 2 test file(s) ran here, every other is the mainline's: test/cart.test.ts, test/total.test.ts at 8e01b44…
```

A [miss](#when-a-share-fails), or an execution record that names no commit or
was recorded at a commit other than the one it was published at, is not used,
and the `record of "<suite>":` line says why. With no execution record, `select`
runs every test file, and `review` requires `--since`.

`select` diffs from the commit the mainline's execution record names, so one
behind or past your merge base adds mainline's changes in between to yours: a
wider run, never a narrower one. `review` diffs from the merge base of that
commit and `HEAD`. It compares the cases, the tests each test file declares,
with the ones the mainline published only when that merge base is the published
commit. For a record past your merge base it is not, and `review` compares them
with the cases your checkout recorded before its latest run, which a fresh clone
has none of.

## When a share fails

**A share never fails a run.** `variance run` does not read or write the share,
so nothing a run decides depends on it.

A **miss** is a lookup or a publish the share did not complete.
**`variance share` exits 0 on every miss**, because a share saves you a run of
the suite and nothing more, and prints which miss it met:

- a store that did not answer, or timed out;
- a request the store refused, such as a rejected credential or a file it may
  not write;
- a token variable that is not set, or is empty;
- an entry in a format this version does not read;
- bytes that do not decode;
- a line with nothing published on it.

`variance ask` and `variance serve` go on to the next line on each of these, and
`select` and `review` go on [without the mainline's
record](#a-suite-your-checkout-has-not-recorded).

**These are command errors, and exit 2:**

- `variance share --publish` with no run report at the path, or one that does
  not parse;
- a run report whose commit is not a commit id, for example
  `cannot publish suite-index-v1: "HEAD" is not a commit`;
- a config the CLI refuses, such as `"mainlines": []`, a `share` carrier with no
  `share` section, a `method` other than `PUT` or `POST`, or a `namespace`
  outside `refs/`;
- `variance ask` when no line has a run report for your checkout, and
  `variance serve`, which does not start;
- `variance share --suite <name> --publish` on a mainline that wrote nothing,
  for a miss or a record it left out. Every checkout measures from that line's
  record, so an older one left in place has to show in CI.

Apart from that last case, `variance share` exits 0 on a miss, so a publish
that stopped working does not turn CI red.
Watch the distance `npx variance share` prints: a mainline record forty commits
behind your merge base is one nothing has published to since.

## Configuring one

A share is one `share` section in `variance.config.json`, beside the keys that
file already has:

```jsonc
// variance.config.json
{
  "project": "checkout-ui",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": {
    "kind": "storybook",
    "index": "storybook-static/index.json",
    "collector": "variance/storybook.mjs"
  },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "fonts": [],
  "report": { "path": ".variance/report.json", "carry": "share" },
  "suites": { "stories": { "kind": "visual", "carry": "share" } },
  "share": { "kind": "git", "mainlines": ["main"] }
}
```

Paths resolve against this file's own directory, and unknown keys are refused by
name. Every kind takes `mainlines` and `remote`. There are three kinds, and a
Tribunal deployment is an `http` share.

### The repository's own refs

```json
{ "share": { "kind": "git", "namespace": "refs/variance" } }
```

- **Each line is one commit** under `refs/variance/mainline/<name>` or
  `refs/variance/branch/<name>`, whose tree has the manifest, the entries and
  the images they name. Nothing is under `refs/heads/`, so a clone does not
  fetch these refs and your branch list does not show them. `namespace` sets
  another prefix under `refs/`, for a repository that already uses
  `refs/variance/`.
- **Every fetch and push runs in a bare repository of the share's own**, at
  `<cache>/share/<digest>.git`, one per remote URL, never in your clone. It
  fetches commits and trees, and an image only when something opens it, so a
  publish over a record that names a thousand images downloads none of them and
  sends only the images the remote does not have. A publish pushes with
  `--force-with-lease`. When the remote refuses the push, the publish reads
  where the line is now. A line at another commit than the one the publish read
  is another writer's, and the publish reads it again. A line that has not
  moved means the remote refused the push for another reason, and the publish
  reports git's message.
- **It authenticates with your global and system git configuration**, with
  the `http.extraheader` your clone has for that remote, which is where
  `actions/checkout` writes its token, and with git configuration in the
  `GIT_CONFIG_COUNT` environment variables, which is how one CI step can give
  git a token the clone does not keep. A credential helper set only in your
  clone's `.git/config` is not used. Git never prompts, and each git command
  is stopped after 60 s.
- **A lookup reuses a fetched line for 60 s**, so ten lookups in a minute fetch
  once.
- **A missing remote, or a name git cannot make a ref of, is a miss.** A clone
  with no such remote prints *this clone has no remote named origin*, and a
  name git refuses prints *`<name>`: git cannot name a ref `<ref>`*.

Anyone with write access to the repository can replace a record under
`refs/variance/`, because branch protection covers branches and tags only. A
wrong mainline record costs a branch wrong `ask` and `serve` answers, a wrong
`select` skip list and a wrong `review` base until the next push to that
mainline replaces it. An entry in a newer format than your CLI writes is kept by
every publish, so it goes only when you delete the line's ref, for example
`git push origin --delete refs/variance/mainline/main`. A pull request from a
fork publishes nothing, whatever its token allows.

### A directory

```json
{ "share": { "kind": "directory", "root": ".variance-share" } }
```

A directory is what `aws s3 sync` writes, what an NFS mount is, and what a
laptop has.

- **The layout** is `<root>/<mainline|branch>/<name>/manifest.json`, the
  entries under `<root>/<mainline|branch>/<name>/entries/<digest>`, and
  `<root>/images/<digest>`, where `<name>` is the branch name, one directory per
  `/` part. `root` resolves against the config file's directory.
- **A publish locks the line** with a `.lock` directory and waits up to 5 s for
  another writer's lock. A wait that ends without the lock is a conflict: it
  uses one of the 8 attempts, and the publish reads the line again. A lock
  older than 60 s is taken over, and 8 waits take 40 s, so behind a dead
  writer's lock less than 20 s old a publish ends with *the line moved under 8
  writes in a row*. Every file is written as a `.part` file and renamed into
  place.
- **A path that resolves outside `root` is refused**, and the message names it.
  Nothing is written outside `root`, and no `.part` file is left.
- **`EACCES`, `EPERM` and `EROFS` are refused**, and any other file-system error
  is a store that did not answer.

### An HTTP endpoint

```json
{
  "share": {
    "kind": "http",
    "endpoint": "https://variance.example.com/share",
    "token": { "env": "VARIANCE_SHARE_TOKEN" },
    "method": "PUT"
  }
}
```

- **The layout** under `endpoint` is the directory's, without `<root>/`.
  `endpoint` is an `http` or `https` URL.
- **`token`** is a string, or `{ "env": "NAME" }`, and is sent as
  `Authorization: Bearer <token>`. The variable is read when the share is used,
  so a job without that secret still loads the config and runs. Every command
  that reads the share reports an unset or empty variable as a miss.
- **`method`** is the verb a write uses: `PUT`, the default, or `POST`.
- **Entries and images are written first, with no condition, and the manifest
  last**, with `If-Match` on the `ETag` it was read with, `If-None-Match: *`
  when the line has none, or no condition when the store sent no `ETag`.
- **Nothing here signs a request**: the CLI speaks no cloud's signing scheme,
  so `endpoint` must accept the request as given.

Your own endpoint answers any 2xx for success, and 404 for a path with nothing
stored. Answer every entry and image write with a 2xx: they are sent with no
condition, so a 409 or 412 there is a miss. To keep two publishers from losing
each other's entries, send an `ETag` with the manifest, and refuse a stale
`If-Match` or an `If-None-Match: *` over an existing manifest with 412 or 409.
Without an `ETag`, the last writer wins.

A request that fails is reported this way. `variance share` exits 0 on each,
and `ask` and `serve` go on to the next line:

| What happened | Reported as | The message |
| --- | --- | --- |
| no answer within 60 s, the body included | unreachable | `<url>: timed out after 60 s` |
| any other network failure | unreachable | `<url>: <message>`, and `: <cause>` when there is one |
| HTTP 404 | nothing published | `nothing is published there` |
| HTTP 409 or 412 on a manifest write | another writer | none: the publish reads the line again, up to 8 attempts |
| HTTP 409 or 412 on an entry or image write | unreachable | `<path>: the store answered an unconditional write with a conflict` |
| any other 4xx except 404, 408 and 429, such as 401, 403 or 422 | refused | `<url>: HTTP <status>` |
| HTTP 408 or 429, a 5xx, or any other status that is not a success | unreachable | `<url>: HTTP <status>` |

When the answer's body is JSON with an `error` string, or plain text, the
message adds it as the store's reason, on one line and at most 1000 characters
long: `<url>: HTTP 422: <reason>`.

### A Tribunal deployment

A Tribunal deployment serves a share at `<deployment>/share`. Set `endpoint` to
that URL, for example `https://variance.example.com/share`.

**Check the deployment's API first.** The share needs `"api": 3` or higher:

```bash
curl -s -H "Authorization: Bearer $VARIANCE_SHARE_TOKEN" https://variance.example.com/version
```

```text
{"service":"variance-authority-tribunal","api":3,"schema":18}
```

An older deployment answers 404 under `/share/`. A lookup then prints *nothing
is published there*, and a publish writes nothing. `variance push` to that
deployment prints the API it serves and that you need to redeploy it, when your
`share.endpoint` is under the deployment's address.

**Set the environment variable your `token` setting names to one of the
deployment's own tokens:**

- **In CI, where a run publishes**, the ingest token: `VARIANCE_TRIBUNAL_INGEST_TOKEN`
  on a Node deployment, the `INGEST_TOKEN` secret on Cloudflare, or
  `ingestToken` in `createTribunal`. It publishes and reads.
- **On a machine that only reads**, such as a laptop running `variance ask`, the
  share token: `VARIANCE_TRIBUNAL_SHARE_TOKEN`, `SHARE_TOKEN` or `shareToken`.
  It reads `/share/` and `GET /version`, and a publish with it answers 403
  before any byte is stored.
- **The review token is refused under `/share/`** with 403.

Share objects are stored under `<project>/share/` in the deployment's bucket,
where `<project>` is the deployment's own: `VARIANCE_TRIBUNAL_PROJECT` on Node,
`PROJECT` on Cloudflare, or `project` in `createTribunal`.
[The HTTP API](../packages/tribunal/README.md#the-http-api) lists every route
and status, and [the Next.js
adapter](../packages/tribunal/README.md#mounting-the-review-surface-in-nextjs)
says what its route file exports for a share.

## GitHub Actions

With `kind: "git"`, a workflow needs write access to its own repository and one
more step:

```yaml
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: write

jobs:
  variance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx storybook build
      - run: npx playwright install --with-deps chromium
      - run: npx variance run
      - run: npx variance share --publish
        if: always()
```

- **`variance run` needs no `--run` or `--commit` here.** It reads
  `GITHUB_RUN_ID` and `GITHUB_SHA`.
- **`if: always()` publishes a run that exits 1** because it found changes, and
  that is the run your checkout most needs to read. A run that exits 2 without
  writing a run report makes the publish step exit 2 too.
- **A pull request from a fork and a merge-queue run publish nothing**, and the
  step prints that and exits 0.
- **`suite-v1/stories` is published only when an earlier step ran the `stories`
  suite** under its [runner
  integration](execution-record.md#one-record-for-each-suite), and only to a
  branch line. This step cannot determine which test files the runner collects,
  so a push to a mainline leaves the suite out and prints that you need to pass
  `--collected`, which [`share --suite`](#a-suite-with-no-run-report) takes.
- **Jobs that run different suites on one line** each keep their own
  `suite-v1/<name>`, while `report-v1` and `suite-index-v1` are one per line,
  from the job that published last.

### A suite with no run report

`share --publish` publishes what a run report names, so a repository that runs
only a unit suite has nothing for it to read. `share --suite <name>` takes the
suite and the share from the root `variance.config.json` instead, and publishes
that suite's execution record alone:

```json
{
  "suites": { "unit": { "kind": "unit", "carry": "share" } },
  "share": { "kind": "git", "mainlines": ["main"] }
}
```

Two jobs keep the token that can write away from the code under test. The
test job runs the suite on every event and, on a push, passes its record on as
an artifact. The publish job runs only on a push to your mainline, and it is
the only job with `contents: write`:

```yaml
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          filter: tree:0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx vitest run
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() && github.event_name == 'push' }}
        with:
          name: variance-record-unit
          path: node_modules/.cache/variance-authority/test-selection
          include-hidden-files: true
          retention-days: 1

  publish:
    needs: test
    if: ${{ !cancelled() && github.event_name == 'push' && github.ref == 'refs/heads/main' }}
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          name: variance-record-unit
          path: node_modules/.cache/variance-authority/test-selection
      - run: npx vitest list --filesOnly > "$RUNNER_TEMP/collected.txt"
      - name: publish the record
        env:
          TOKEN: ${{ github.token }}
        run: |
          auth="$(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')"
          echo "::add-mask::$auth"
          export GIT_CONFIG_COUNT=1
          export GIT_CONFIG_KEY_0="http.$GITHUB_SERVER_URL/.extraheader"
          export GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $auth"
          npx variance share --suite unit --publish --collected "$RUNNER_TEMP/collected.txt"
```

```text
wrote suite-v1/unit to mainline main in refs/variance on origin.
```

- **The artifact path is the [cache](cache.md)'s default location.** The
  record's directory inside it is named for the checkout's absolute path, and
  that path is the same on every runner of one workflow, so the publish job
  finds the record where the test job wrote it. Download it after `npm ci`,
  which removes `node_modules`. When you set `cacheRoot`, use that directory
  instead.
- **`persist-credentials: false` keeps the token out of the clone.** The
  publish step gives it to git through `GIT_CONFIG_*` variables, for that step
  alone, so the install and the build never run beside it.
- **`--collected` is the runner's list of the test files it collects**, one
  path per line, relative to the repository root or absolute. With Jest it is
  `npx jest --listTests`.

It publishes to the line the run belongs to, as `--publish` does, and leaves
the record out when it was recorded at a commit other than `HEAD`:

```text
nothing published: suite-v1/unit is left out: its record at <path> was recorded at 5d0c…, not at 3f1c….
```

Every checkout measures from the mainline's record, so a mainline takes only a
record of the whole suite. The runs record beside the execution record is
published with it, and it has to show that every test file the runner collects
ran at `HEAD`. A file the record still lists but the runner no longer collects
does not count. A push that ran a selection is left out, the line keeps the
record it had, and the command exits 2:

```text
nothing published: suite-v1/unit is left out: its record at <path> is not a whole run: 3 test file(s) the suite collects last ran before 3f1c…, test/cart.test.ts among them.
```

Without `--collected` nothing records which files are the suite's tests, so a
mainline publish is refused:

```text
nothing published: suite-v1/unit is left out: its record at <path> is not a whole run: the runner was not asked which test files it collects, so nothing says the run covered all of them: pass `--collected`.
```

A branch line takes the record whatever ran, because nothing measures from it
but that branch.

Without `--publish` it reads the mainline's record the way `select` does, and
prints the [`record of "unit":` line](#a-suite-your-checkout-has-not-recorded).
`--suite` takes no `--config`, `--mainline` or report, because those name the
other form's inputs.

## S3 and Google Cloud Storage

A bucket in S3 or Google Cloud Storage needs signed requests, and an `http`
share signs nothing. Put a service that takes a bearer token and signs for the
bucket in front of it, use a Tribunal deployment in place of the bucket, or sync
a directory share with it:

```yaml
      - run: aws s3 sync s3://example-variance/share .variance-share
      - run: npx variance run
      - run: npx variance share --publish
        if: always()
      - run: aws s3 sync .variance-share s3://example-variance/share
        if: always()
```

The config says `{ "kind": "directory", "root": ".variance-share" }`, and the
credentials stay out of it. For Google Cloud Storage, the two steps are
`gcloud storage rsync --recursive` in each direction.

- **The sync fits one publishing job per line at a time.** Each job locks only
  its own copy, and the last upload's `manifest.json` wins, so a matrix that
  publishes to one line needs `git`, or an `http` store with conditional
  writes.
- **On a runner that starts empty, every sync downloads everything under the
  prefix**, which grows with every branch: nothing deletes, and a bucket
  lifecycle rule is the collector.
- **A mainline publish queries git about descent**, so the job needs fetch
  access to `share.remote`, which git gets as it does [for a `git`
  share](#the-repositorys-own-refs). Without it, the publish prints *replaced …
  git could not answer*.

## Locally

A lookup on your checkout needs only the config CI uses:

- **With `kind: "git"`**, it fetches from the remote you already push to.
- **With a directory**, `root` is the same `.variance-share`: run the
  `aws s3 sync` download step before you ask, or make `.variance-share` a link
  to a mount your team shares.
- **With `kind: "http"`**, set the environment variable your `token` setting
  names to a token that reads.

`npx variance share --publish` from a branch writes that branch's line, and a
colleague's `variance ask` on the same branch reads it when their checkout has
no run report of its own. Off CI, the run report needs a commit:

```bash
npx variance run --run local-1 --commit "$(git rev-parse HEAD)"
npx variance share --publish
```
