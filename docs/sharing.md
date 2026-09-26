# Read CI's latest run from your checkout

A **share** is a store where CI publishes what each run found. With one
configured, `variance ask` and `variance serve` answer from CI's run report when
your checkout has no run of its own, and `variance share` tells you how many
commits mainline's record is from your checkout. A share keeps the latest record
of each mainline and of each branch, and nothing older: as refs in the
repository that hosts your code, in a directory, or behind an HTTP endpoint such
as a [Tribunal](../packages/tribunal/README.md) deployment.

New here? Start with [your first run](start.md).

The CLI is a devDependency, and every command below is run through it:

```bash
npm install --save-dev @variance-authority/cli
```

A share does not replace [`baselines`](../packages/cli/README.md#configuration).
The baselines are the images a run compares against, and `baselines.carry`
refuses `"share"`. Everything a share stores was derived from the commit it
names, so losing a share costs you a run of the suite, and losing a baseline
costs you the comparison.

## The words this page uses

- **Line** — one place in a share that keeps the latest record of one branch.
- **Mainline** — a branch your other branches start from and merge into, such
  as `main`. Its line is `mainline/<name>`.
  [Which branches are mainlines](#which-branches-are-mainlines) says how the CLI
  decides.
- **Branch line** — the line of any other branch, `branch/<name>`.
- **Entry** — one file a run publishes to a line. Its name states its format
  version, such as `suite-index-v1`, and it names the commit it was derived at.
- **Record** — the entries a line keeps.
- **Manifest** — the file of a line that lists its entries: each entry's name,
  commit and digest.
- **Run report** — the JSON file `variance run` writes at the path `report`
  names in `variance.config.json`, `.variance/report.json` by default.
- **Subject** — one named UI state you asked for and can ask for again, under an
  id you choose, such as `cart/empty`.
- **Suite** — a set of tests you declare in the `variance.config.json` at the
  repository root, with an [execution record of its
  own](execution-record.md#one-record-for-each-suite).

## What a share stores

| Entry | What it is | Published when |
| --- | --- | --- |
| `suite-index-v1` | the [suite index](lexicon.md#where-it-is-kept) of the run | the run report has a [composition](composition.md) section and names a commit |
| `report-v1` | the run report byte for byte, and a table from each image path it names to that image's digest | `report.carry` is `"share"` |
| `suite-v1/<suite>` | that suite's execution record, as this machine recorded it | the suite's `carry` is `"share"`, and its execution record here was recorded at the run report's commit |

Every publish includes `suite-index-v1`, and the other two entries are published
only beside it. A run report with no composition section — from a raster-only
capture, a run under `"retention": "ephemeral"`, or shards merged with
`variance report a.json b.json` — gives no suite index, and a publish of it
writes nothing.

An image is stored once per share, under `images/<digest>`, and every record
names it by digest.

`report.carry` and a suite's `carry` are set in `variance.config.json`:

```json
{
  "report": { "path": ".variance/report.json", "carry": "share" },
  "suites": { "stories": { "kind": "visual", "carry": "share" } },
  "share": { "kind": "git" }
}
```

- **A run report or execution record with no `carry` stays on the machine that
  wrote it.**
- **A `share` carrier needs a `share` section in the same file.** A config that
  names one without it is refused, and the message names the key.
- **A suite's execution record is the one this machine has**, at
  `<cache>/test-selection/<repository>/suites/<name>/coverage.bin`. When it was
  recorded at another commit, names no commit, or does not read, the publish
  leaves that suite out, publishes the rest of the run, and says why:

  ```text
  left out suite-v1/stories: its record at <path> was recorded at 5d0c…, not at 3f1c….
  ```

  A suite this machine has no execution record of is not published, and
  nothing is printed for it: each job publishes the suites it ran.

The suite index is one binary file with four things in it:

| In the file | What it is |
| --- | --- |
| the census | which component was mounted in how many subjects, and which subject shows each one with the fewest other components around it |
| the subject denominator | the ids of the subjects that contributed a capture, which the census's shares are counted against |
| the [lexicon](lexicon.md) | per subject, the names that subject answered to, in the nine fields [the lexicon lists](lexicon.md#what-the-run-writes-down), among them accessible names, visible text, component names, file paths, ARIA roles and the CSS custom properties it resolved through |
| the commit | the revision all of the above was read at |

Equal facts encode to equal bytes, so two machines composing the same suite
write the same file byte for byte.

### What it exposes

Read the lexicon row before you choose where a share lives. The lexicon records
accessible names and visible text as the run read them off your rendered UI —
`Clear completed`, `--va-space-2`, `src/todo/TodoFooter.tsx` — alongside your
component names and file paths. A published run report adds its images. A share
is as sensitive as your source plus whatever your test states put on screen.
Give it the audience you give the repository, not a wider one.

Text an [ignore](ignores.md) declared volatile — a clock, a feed, an order
number — is the exception: it is digested before the lexicon is written, so it
is never in the file as words.

## One record per line, the latest one

A share has three kinds of path, whatever it is stored in:

```text
mainline/<name>/    the latest record of each mainline
branch/<name>/      the latest record of each branch
images/<digest>     every image a record names, stored once
```

There is no history. Your branches start from a mainline and are brought up to
date with it before they merge, by a merge queue, a required up-to-date branch
or a rebase. The question your checkout asks is not *what was mainline at the
commit I started from*. It is *what is mainline now, and how far am I from it*,
and every lookup prints the second half.

**A publish replaces only the entries it offers.** Two jobs that publish
different suites at one commit leave both on the line. For an entry the line
already has:

- **On a mainline, the line keeps its entry when that entry's commit strictly
  descends from the offered one.** That is a slow run of an older commit
  finishing last:

  ```text
  kept suite-index-v1: the line holds it at 9ab2…, which descends from this run's commit.
  ```

  Git answers from `share.remote`, fetched into the share's own repository in
  your cache, whatever kind the share is. When git cannot answer, the offered
  entry replaces the held one and the publish says so:

  ```text
  replaced suite-index-v1 without knowing whether the held commit was newer: git could not answer.
  ```

  After a force-push nothing descends, and the next publish replaces the entry.
- **On a branch line, the offered entry always replaces the held one.** A rebase
  leaves no descent to test.
- **On any line, an entry in a newer format is kept**, so an older CLI does not
  replace it:

  ```text
  kept suite-index-v2: the line holds it in a newer format, at 9ab2….
  ```

Two jobs that publish to one line at once do not lose each other's entries. Each
one writes the manifest against the version it read. The one that loses reads
the line again, decides again and writes again, up to 8 times, and then reports
`the line moved under 8 writes in a row; nothing was published`.

**Line names are folded.** In each `/`-separated part of a branch name, every
run of characters outside `A-Z`, `a-z`, `0-9`, `.`, `_` and `-` becomes one `-`,
and leading and trailing `-` and `.` are removed. An empty part is dropped, and
a name with nothing left is `unnamed`. Case is kept.

- **Two names that fold to one are one line.** `feat/cart page` and
  `feat/cart-page` both write `branch/feat/cart-page`, and the last publish
  replaces the other's entries. A reader on either branch reads the record and
  is told it is *another run of* its branch when its `HEAD` does not contain the
  record's commit.
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
  Cloudflare R2 or on a case-sensitive volume, keep two lines.

One share serves one `variance.config.json`. Point two projects in one
repository at different roots, endpoints or namespaces.

## Which branches are mainlines

`share.mainlines` lists them, in order of priority:

```json
{ "share": { "kind": "git", "mainlines": ["main", "release/2.0"] } }
```

When you leave it out, the first of these that answers names the one mainline:

1. `refs/remotes/<remote>/HEAD` in your clone.
2. On GitHub Actions, the event's `repository.default_branch`.

`main` is never assumed. `"mainlines": []` is refused with *must name at least
one branch; leave it out to let git answer*.

When nothing answers — no `share.mainlines`, no remote `HEAD` and no event:

- **A publish still writes the run's branch line**, and prints after its first
  line:

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
asks about are all read from it.

## Publishing

Every `npx variance run` keeps its suite index in [your cache](cache.md), under
the commit the run report names, and prints where:

```text
suite index: <cache>/suite/web/3f1c…bd.bin
```

It prints this line only when the run report has a composition section and
names a commit. A run does not publish, and it does not read the share. You
publish after the run, from each job whose entries the line should include:

```bash
npx variance share --publish
```

It reads the run report `report` names, or the path you give as the last
argument. `--config <path>` names a config other than `variance.config.json`.

**The commit comes from the run report.** `variance run` takes it from the CI
environment, and reads each pair whole:

| CI | Run id | Commit |
| --- | --- | --- |
| GitHub Actions | `GITHUB_RUN_ID` | `GITHUB_SHA` |
| GitLab CI | `CI_PIPELINE_ID` | `CI_COMMIT_SHA` |
| Bitbucket Pipelines | `BITBUCKET_BUILD_NUMBER` | `BITBUCKET_COMMIT` |

Anywhere else, pass both `--run <id>` and `--commit <sha>` to `variance run`.
`--commit` without `--run` names no commit. A run report that names no commit
publishes nothing and prints `nothing published: this report names no commit.`
A run report with no composition section prints the same line.

**The line depends on where the publish runs.** On GitHub Actions
(`GITHUB_ACTIONS=true`):

| The run | What it writes |
| --- | --- |
| a push to a mainline | `mainline/<name>` |
| a push, or any other event, on a branch that is not a mainline | `branch/<name>` |
| a `pull_request` or `pull_request_target` from this repository | `branch/<head branch>`, with the pull request's head commit beside the commit the run checked out |
| a pull request from a fork | nothing: *a pull request from a fork publishes nothing; its token is read-only* |
| a merge queue: a `merge_group` event, or a `gh-readonly-queue/` branch | nothing: *a merge-queue run publishes nothing; its branch is temporary* |
| any other event on a mainline, such as `schedule` | nothing: *only a push to main publishes its record, and this run is a schedule* |
| a tag, or any other ref that is not a branch | nothing: *this run is not on a branch* |

Anywhere else, the publish reads your checkout:

| The checkout | What it writes |
| --- | --- |
| on a branch that is not a mainline | `branch/<name>` |
| on a mainline | nothing: *only a push to main publishes its record, and this run is not on CI* |
| detached | nothing: *this checkout is not on a branch* |

**GitHub Actions is the only CI the CLI recognises.** Its event is the only
source of the default branch and of a pull request's base. On GitLab CI and
Bitbucket Pipelines, a publish reads the job's checkout the way it reads yours:

- a detached checkout, which is what both check out by default, publishes
  nothing;
- a job that checks out a branch that is not a mainline by name, for example
  with `git checkout -B "$CI_COMMIT_REF_NAME"`, writes `branch/<name>`;
- a job on a mainline writes nothing, as your checkout of a mainline does, so no
  publish writes a mainline's line.

The publish prints what it did, and where:

```text
wrote suite-index-v1, report-v1 to mainline main in refs/variance on origin.
```

The store is named as `<namespace> on <remote>` for a `git` share, `the
directory <root>`, or `the endpoint <url>`. A publish the store did not take
says why, with the same reasons a lookup gives:

```text
nothing published to branch feat/cart in the endpoint https://variance.example.com/share: https://variance.example.com/share/branch/feat/cart/manifest.json: HTTP 403.
```

With `report.carry` set to `"share"`, an image the run report names that this
machine could not read is left out, and the run report is still published:

```text
left out 2 image(s) the report names and this machine could not read, the first at /home/runner/work/web/.variance/renders/cart-empty.png.
```

## Looking up mainline's record

```bash
npx variance share
```

reads the suite index of the mainline your checkout is measured against:

- **On a pull request**, the base branch that `GITHUB_BASE_REF` names, when it is
  one of your mainlines.
- **Otherwise**, the mainline whose merge base with `HEAD` is the fewest commits
  from `HEAD`. A tie, or a clone that cannot count, picks the first one listed.
- **`--mainline <branch>`** names one yourself.

```text
mainline main evaluated at 3f1c9a2…, 2 commit(s) behind the merge base with this checkout, read from the share.
412 subject(s), 168 component(s), lexicon over 9 field(s) of 412 subject(s)
at <cache>/suite/web/3f1c9a2….bin
```

The manifest names the commit, and the suite index this machine has at that
commit is read before the share's, because a commit's index is the same bytes
wherever it is read. The first line then ends in `read from this machine`. What
the share returns is written under that commit, so the next command reads it
from disk.

**The distance is counted from `HEAD`'s merge base with
`refs/remotes/<remote>/<mainline>`**, so run `git fetch` first:

- `at the merge base with this checkout`
- `N commit(s) behind the merge base with this checkout` — the record is older
  than your merge base.
- `N commit(s) past the merge base with this checkout` — the record is newer.
- `at a distance this clone cannot count` — your clone has no
  `refs/remotes/<remote>/<mainline>`, does not have the record's commit (a
  shallow clone often does not), or neither commit descends from the other. The
  lookup still answers.

A large distance tells you to update your branch.

**A lookup that finds nothing says why**, as `mainline <name>: <why>.`, because
each reason needs a different action:

| The message says | What to do |
| --- | --- |
| `nothing is published there` | publish from a push to that mainline |
| `it holds only report-v1` | the line has entries, but not the one asked for: check what the config CI publishes with sets |
| `it holds suite-index-v2, a format this version does not read` | upgrade the CLI |
| `no share is configured` | add a `share` section |
| `nothing answered from config, remote-head, event` | set `share.mainlines`, or run `git remote set-head origin --auto` |
| HTTP 401 or 403, git's authentication error, or a token variable that is not set | check the credential on this machine |
| another HTTP 4xx, with the store's reason after it | act on the store's reason |
| a timeout, an address, a connection error, HTTP 408 or 429, or a 5xx | check the store is reachable from this machine, and its own log for that request |
| a reason the bytes do not decode | the line has an entry its manifest does not describe |

With an `http` share whose token variable is unset or empty, for example:

```text
mainline main: variance.config.json: `share.token` names the environment variable "VARIANCE_SHARE_TOKEN", and it is not set. The config is right and the value is missing, so nothing was substituted here.
```

## A checkout with no run of its own

When `variance ask` or `variance serve` needs the run report and there is no
file at the path `report` names, it reads a run report from the share. That
needs `report.carry` set to `"share"` in the config CI publishes with. The order
is:

1. **Your own run report.** Only a missing file falls through to the share. A
   run report this process cannot open is still yours, and the error says why.
2. **Your branch's line.** The branch is `GITHUB_HEAD_REF` on a pull request,
   `GITHUB_REF_NAME` on a GitHub Actions branch run, or your checkout's branch.
   It is not asked on a mainline, on a detached checkout, or on a pull request
   from a fork, because a branch line of the same name is a branch of the base
   repository.
3. **The mainline your checkout is measured against**, chosen as in [Looking
   up](#looking-up-mainlines-record).

A run report you name on the command line is read, or refused, and the share
is not asked.

Every answer from a line opens with a `report:` line that says where it came
from. From a branch line:

```text
report: read from branch feat/cart, evaluated at 51ab09e… for pull request head 9c4e1d2…, 2 commit(s) before HEAD; kept at <cache>/report/<digest>/.variance/report.json.
```

The record's commit is compared with your `HEAD`, the pull request head first
when there is one:

- **`which is HEAD`**, or **`N commit(s) before HEAD`** — the record is from
  your history.
- **`which this checkout does not contain: another run of feat/cart, not this
  checkout's`** — the record is from a commit your history does not have: a
  run before a rebase, a colleague's run of the same branch, or a branch whose
  name folds to the same line. It still answers.
- **`which this clone does not hold: read as another run of feat/cart, not this
  checkout's`** — your clone does not have the commit, so it cannot tell.

From the mainline, with the [distance](#looking-up-mainlines-record) a lookup
prints. When your branch line was asked and did not answer, the reason follows
on its own line, because a refused credential there is something to fix:

```text
report: read from mainline main, evaluated at 3f1c9a2…, 2 commit(s) behind the merge base with this checkout; kept at <cache>/report/<digest>/.variance/report.json.
branch feat/cart: https://variance.example.com/share/branch/feat/cart/manifest.json: HTTP 403.
```

**The configured `report` path is never written.** The run report is kept in
[your cache](cache.md) at `<cache>/report/<digest>/`, where `<digest>` is the
entry's digest, at the same path relative to the repository root as your
configured report, or as `run.json` when that report is outside the repository.
The image table is `<cache>/report/<digest>.images.json`. A second question
reads the line's manifest again, finds the same digest, and opens the kept files
without fetching the run report again.

**`variance ask` fetches images for the subjects a question names.** `ask
describe --subject cart/empty` fetches that subject's images, by digest, to the
paths the run report names them by, relative to the kept run report, and checks
each one against its digest. Images of other subjects are not fetched. An image
that is not fetched adds a line to the answer:

```text
image renders/cart-empty.png: it was not published with the report.
image ../../x.png: it names a path outside <cache>/report/<digest>, so it is not fetched.
image renders/cart-empty.png: the bytes the line holds do not match their digest.
```

**Your own run takes over when it exists.** After `variance run` writes your run
report, `ask` and `serve` read it. In `variance serve`, the first
`variance_diff` after that opens with the report it compares with:

```text
report: this checkout's own run, compared with the report the previous answer read from branch feat/cart at 51ab09e….
```

**When no line answers, `ask` exits 2 and `serve` does not start.** Both list
each line asked, with what it answered:

```text
there is no run report at /work/web/.variance/report.json, which is where `report` in your configuration points, and the share holds none for this checkout:
  branch feat/cart: nothing is published there
  mainline main: it holds only suite-index-v1
```

Without a `share` section, the same message ends with *`variance run` writes it
there, and no share is configured to read CI's from*.

`variance report`, `adjudicate`, `comment` and `push` do not read the share.
They gate a run, and your checkout made none.

## A suite your checkout has not recorded

`variance select` and `variance review` measure a change from a suite's
execution record. For a suite whose `carry` is `"share"`, when your checkout has
no execution record of its own, they read the `suite-v1/<suite>` entry the
mainline published. They never read a branch line's, because a record of your
own branch would measure the change against itself.

- **`select`** reads it when your checkout has no execution record of the suite.
- **`review`** reads it when the suite ran in your checkout with no execution
  record to start from, and `--since` names no base.

Your checkout's own execution record always comes first. The mainline's is kept
at `<cache>/share/read/<suite>/<commit>/coverage.bin`, apart from every record a
run writes, so it is never read as your checkout's own. The answer says which
one it read:

```text
record of "stories": read from mainline main, published at 3f1c9a2…, 2 commit(s) behind the merge base with this checkout; kept at <cache>/share/read/stories/3f1c9a2…/coverage.bin
```

A record that names no commit, or was recorded at a commit other than the one it
was published at, is not used, and the note says why. When no record is read,
`review` asks you to name a base with `--since`.

## When a share fails

**A share never fails a run.** `variance run` does not read or write the share,
so nothing a run decides depends on it.

**`variance share` exits 0 on every miss**, for a lookup and for a publish, and
prints which one it met:

- a store that did not answer, or timed out;
- a credential or a request the store refused;
- a token variable that is not set, or is empty;
- an entry in a format this version does not read;
- bytes that do not decode;
- a line with nothing published on it.

`variance ask` and `variance serve` go on to the next line on each of these.

**These are command errors, and exit 2:**

- `variance share --publish` with no run report at the path, or one that does
  not parse;
- a run report whose commit is not a commit id, for example
  `cannot publish suite-index-v1: "HEAD" is not a commit`;
- a config the CLI refuses, such as `"mainlines": []`, a `share` carrier with no
  `share` section, a `method` other than `PUT` or `POST`, or a `namespace`
  outside `refs/`;
- `variance ask` when no line has a run report for your checkout, and
  `variance serve`, which does not start.

Because a miss exits 0, a publish that stopped working does not turn CI red.
Watch the distance `npx variance share` prints: a mainline record forty commits
behind your merge base is a mainline nothing has published to since.

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
  "share": { "kind": "git", "mainlines": ["main"] }
}
```

Paths resolve against this file's own directory, and unknown keys are refused by
name. Every kind takes `mainlines` and `remote`. There are three kinds.

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
  fetches commits and trees, and fetches an image only when something opens it.
  A publish over a record that names a thousand images downloads none of them,
  and sends only the images the remote does not have. A publish pushes with
  `--force-with-lease`.
- **It authenticates with your global and system git configuration**, and with
  the `http.extraheader` your clone has for that remote, which is where
  `actions/checkout` writes its token. A credential helper set only in your
  clone's `.git/config` is not used. Git never prompts, and each git command
  has 60 s.
- **A lookup reuses a fetched line for 60 s**, so ten lookups in a minute fetch
  once.
- **A missing remote, or a name git cannot make a ref of, is a miss.** A clone
  with no such remote prints *this clone has no remote named origin*, and a
  name git refuses prints *`<name>`: git cannot name a ref `<ref>`*.

Anyone with write access to the repository can replace a record under
`refs/variance/`, because branch protection covers branches and tags only. A
wrong mainline record costs a branch a wrong evaluation until the next push to
that mainline replaces it. On GitHub Actions the job needs `contents: write`. A
pull request from this repository gets it, and one from a fork does not.

### A directory

```json
{ "share": { "kind": "directory", "root": ".variance-share" } }
```

A directory is what `actions/cache` restores, what `aws s3 sync` writes, what
an NFS mount is, and what a laptop has.

- **The layout** is `<root>/<kind>/<name>/manifest.json`, the entries under
  `<root>/<kind>/<name>/entries/<digest>`, and `<root>/images/<digest>`. `root`
  resolves against the config file's directory.
- **A publish locks the line** with a `.lock` directory, waits up to 5 s for
  another writer's lock, and takes over a lock older than 60 s. Every file is
  written as a `.part` file and renamed into place.
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

- **The layout** under `endpoint` is `<kind>/<name>/manifest.json`, the entries
  under `<kind>/<name>/entries/<digest>`, and `images/<digest>`. `endpoint` is
  an `http` or `https` URL.
- **`token`** is a string, or `{ "env": "NAME" }`, and is sent as
  `Authorization: Bearer <token>`. The variable is read when the share is used,
  not when the config loads, so a job without that secret still loads the
  config and runs. `variance share`, `ask` and `serve` report an unset or empty
  variable as a miss.
- **`method`** is the verb a write uses: `PUT`, the default, or `POST`.
- **Entries and images are written first, and the manifest last.** The manifest
  is written with `If-Match` on the `ETag` it was read with, or with
  `If-None-Match: *` when the line has none. A 412 or 409 answer is another
  writer, and the publish reads the line again.
- **Nothing here signs a request**, so `endpoint` must accept the request as
  given.

A request that fails is reported this way:

| What happened | Reported as | The message |
| --- | --- | --- |
| no answer within 60 s, the body included | unreachable | `<url>: timed out after 60 s` |
| any other network failure | unreachable | `<url>: <message>: <cause>` |
| HTTP 404 | nothing published | `nothing is published there` |
| any other 4xx except 408 and 429, such as 401, 403 or 422 | refused | `<url>: HTTP <status>` |
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
deployment says so when your `share.endpoint` is under the deployment's address.

**The token decides what a machine can do.** Set the variable `token` names:

- **In CI, where a run publishes**, to the ingest token:
  `VARIANCE_TRIBUNAL_INGEST_TOKEN` on a Node deployment, the `INGEST_TOKEN`
  secret on Cloudflare. It publishes and reads.
- **On a machine that only reads**, such as a laptop running `variance ask`, to
  the share token: `VARIANCE_TRIBUNAL_SHARE_TOKEN` on a Node deployment, the
  `SHARE_TOKEN` secret on Cloudflare, or `shareToken` in `createTribunal`. It
  reads `/share/` and `GET /version`. A publish with it answers 403 before any
  byte is stored, every other route answers 403, and a path the deployment does
  not serve answers 404.
- **The review token is refused under `/share/`** with 403. It belongs to people
  and to the review page.

Share objects are stored under `<project>/share/` in the deployment's bucket,
and `POST /review/sweep` leaves them in place. Behind the Next.js adapter with
`basePath: '/variance'`, the endpoint is `https://example.com/variance/share`,
and the route file must export `PUT`.
[The HTTP API](../packages/tribunal/README.md#the-http-api) lists every route
and status.

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
  that is the run your checkout most wants to read. A run that exits 2 without
  writing a run report makes the publish step exit 2 too.
- **A pull request from a fork and a merge-queue run publish nothing**, and the
  step says so and exits 0.
- **Jobs that run different suites each publish their own entries** to the same
  line.

## S3 and Google Cloud Storage

An `http` share sends a bearer token and signs nothing, and a bucket in S3 or
Google Cloud Storage needs signed requests. Put a service that takes a bearer
token in front of the bucket, such as a Tribunal deployment, or sync a
directory share with the bucket:

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

- **The sync is not conditional.** Two jobs that sync at once can lose each
  other's entries. Give the job a `concurrency` group so two workflow runs do
  not sync at once; GitHub keeps one job pending in a group and cancels an
  older pending one.
- **The first sync downloads every line and every image in the bucket.** Each
  later sync downloads what changed.
- **A mainline publish asks git about descent**, so the job needs fetch access
  to `share.remote`. Without it, the publish prints *replaced … git could not
  answer*.

## Locally

A lookup on your checkout needs only the config CI uses:

- **With `kind: "git"`**, it fetches from the remote you already push to.
- **With a directory**, point `root` at something your team already syncs, such
  as a shared mount, or run the `aws s3 sync` download step before you ask:

  ```json
  { "share": { "kind": "directory", "root": "/Volumes/team/variance-share" } }
  ```

- **With `kind: "http"`**, set the variable `token` names to a token that reads.

`npx variance share --publish` from a branch writes that branch's line, and a
colleague's `variance ask` on the same branch reads it when their checkout has
no run report of its own. Off CI, the run report needs a commit:

```bash
npx variance run --run local-1 --commit "$(git rev-parse HEAD)"
npx variance share --publish
```
