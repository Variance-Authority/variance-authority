# Reuse what mainline already worked out

A **share** is where CI leaves what it derived about your suite, so your
checkout can read what mainline and your branch look like without running the
suite. It stores the latest record of each mainline and of each branch — nothing
older — in a directory, behind a URL, or as refs in the repository that already
hosts your code.

New here? Start with [your first run](start.md).

A run that compares a branch against mainline needs two different things about
mainline:

- **The baselines.** These are the images, which only a baseline store can
  answer for and which a share does not replace.
- **Everything the run *derived* about the suite itself.** This is which
  components exist, which subjects show them, and every name the run wrote down
  for all of it. A **subject** is one named UI state you asked for and can ask
  for again, under an id you choose such as `cart/empty`. This second half is a
  fact about a commit, not about a run: it costs a source scan, a browser and a
  [composition](composition.md) pass, and it is identical on every machine that
  starts from the same tree.

Mainline computed the second half an hour ago, on a runner that no longer
exists. A share is where that run left those bytes when it finished.

The CLI is a devDependency, and every command below is run through it:

```bash
npm install --save-dev @variance-authority/cli
```

## What a share stores

A record is a set of entries. Each entry names the commit it was derived at, and
its name states its format version, so a reader that does not know a later
format says so instead of parsing bytes it would reject.

| Entry | What it is | Published |
| --- | --- | --- |
| `suite-index-v1` | the [suite index](lexicon.md#where-it-is-kept) this run derived | always |
| `report-v1` | the run report, and every image it names | when `report.carry` is `"share"` |
| `suite-v1/<suite>` | that suite's [execution record](execution-record.md) | when that suite's `carry` is `"share"` |

`report.carry` and a suite's `carry` are in your `variance.config.json`. An
artifact with no `carry` stays on the machine that wrote it.

The suite index is one binary file with four things in it:

| In the file | What it is |
| --- | --- |
| the census | which component was mounted in how many subjects, and which subject shows each one with the fewest other components around it |
| the subject denominator | the ids of the subjects that contributed a capture, which the census's shares are counted against |
| the [lexicon](lexicon.md) | per subject, the names that subject answered to: component names, ARIA roles, accessible names, visible text, declaring files, and the CSS custom properties it resolved through |
| the commit | the revision all of the above was read at |

Equal facts encode to equal bytes, so two machines composing the same suite
write the same file byte for byte.

### What it exposes

Read the lexicon row before you choose where a share lives. The lexicon records
accessible names and visible text as the run read them off your rendered UI —
`Clear completed`, `--va-space-2`, `src/todo/TodoFooter.tsx` — alongside your
component names and file paths. A published report adds its images. A share is
as sensitive as your source plus whatever your test states put on screen. Give
it the audience you give the repository, not a wider one.

Text an [ignore](ignores.md) declared volatile — a clock, a feed, an order
number — is the exception: it is digested before the lexicon is written, so it
never lands in the file as words.

## One record per line, the latest one

A share keeps three kinds of path, whatever it is stored in:

```text
mainline/<name>/    the latest record of each mainline
branch/<name>/      the latest run of each branch
images/<digest>     every image any record names, stored once
```

There is no history. Your branches start from a mainline and are brought up to
date with it before they merge — a merge queue, a required up-to-date branch or
a rebase does that. So the question a checkout asks is not *what was mainline
at the commit I started from*. It is *what is mainline now, and how far am I
from it*. The answer to the second half is printed with every lookup.

What may replace what:

- **A mainline entry is replaced**, unless the entry already there was derived
  at a commit that strictly descends from the one offered. That is a slow run of
  an older commit finishing last, and git answers it. After a force-push there
  is no descent, and the next publish replaces the entry.
- **A branch entry is always replaced.** A rebase leaves no descent to test.
- **A publish replaces only the entries it offers.** Two jobs that publish
  different suites at one commit leave both in the record.

One share serves one `variance.config.json`. Point two projects in one
repository at different roots, endpoints or namespaces.

## Which branches are mainlines

`share.mainlines` lists them, in order of priority:

```json
{ "share": { "kind": "git", "mainlines": ["main", "release/2.0"] } }
```

When you leave it out, git answers: the branch that `refs/remotes/origin/HEAD`
names. A CI checkout often has no such ref, and there the CI event's own default
branch answers. When none of the three answers, nothing is published, and the
message names the three answers that were missing. `main` is never assumed.

`share.remote` names the remote the mainlines live on, `origin` unless you set
it.

## The rule that makes it safe

> **A share never fails a run.**

A miss, an outage, an expired token, a bucket nobody has permission for, bytes
from a writer this version does not read — `variance share` prints which one it
was and exits 0. A run does not read the share, so nothing a run decides depends
on it.

So a broken share never turns CI red, and a publish that stopped working is
quiet. The signal to watch is the distance `npx variance share` prints. A
mainline record forty commits behind your merge base is a mainline nothing has
published since.

A share is configured separately from `baselines`, and it has no default. Losing
a baseline loses the comparison; losing a share costs running the suite
again.

## Publishing

Every `npx variance run` keeps its suite index in [your cache](cache.md), under
the commit the report names, and prints where:

```text
report: .variance/report.json
suite index: <cache>/suite/web/3f1c…bd.bin
```

A run does not publish. You publish after the run, from each job whose output
the record should include:

```bash
npx variance share --publish
```

It reads `report` from the config, or the report you name after `--publish`.
Which line it writes depends on where it runs:

| Where the publish runs | What it writes |
| --- | --- |
| a push to a mainline, on CI | `mainline/<that branch>` |
| a pull request from this repository | `branch/<head branch>`, with the head commit the pull request pointed at beside the merge commit CI ran on |
| any other branch, on CI | `branch/<that branch>` |
| your checkout, on a branch that is not a mainline | `branch/<that branch>` |
| a merge queue | nothing: its branch is deleted when the queue moves on |
| a pull request from a fork | nothing: its token is read-only |
| any other event on a mainline, or your checkout of a mainline | nothing: only a push to a mainline describes it |

It prints what it did:

```text
wrote suite-index-v1, report-v1 to mainline main in refs/variance on origin.
```

```text
kept suite-index-v1: the line holds it at 9ab2…, which descends from this run's commit.
```

A report that names no commit publishes nothing. Pass `--commit <sha>` to
`npx variance run` when you want its output published.

## Looking up

```bash
npx variance share
```

reads the mainline your checkout is measured against. On a pull request that is
the base branch, when it is one of your mainlines. Otherwise it is the mainline
with the nearest merge base to `HEAD`, and a tie goes to the first one listed.
`--mainline <branch>` names one yourself.

```text
mainline main evaluated at 3f1c9a2…, 2 commit(s) behind the merge base with this checkout, read from the share.
412 subject(s), 168 component(s), lexicon over 9 field(s) of 412 subject(s)
at <cache>/suite/web/3f1c9a2….bin
```

The record names its commit, and this machine's copy at that commit is read
before the share's, because a commit's index is the same bytes wherever it is
read. What the share returns is kept under that commit, so the next command
reads it from disk.

The distance is counted from `HEAD`'s merge base with that mainline. `behind`
means the record is older than your merge base, and `past` means it is newer. A
shallow clone that cannot count prints *at a distance this clone cannot count*
and still answers. A large distance is the instruction to update your branch.

A lookup that finds nothing says which of these it met, because each needs a
different action:

| The message says | What to do |
| --- | --- |
| nothing is published there | publish from that mainline |
| it holds `suite-index-v2`, a format this version does not read | upgrade the CLI |
| HTTP 403, or git's authentication error | check the credentials |
| an address, a timeout or a connection error | check the store is reachable |
| bytes that do not decode | the share holds an entry its manifest does not describe |

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

**The repository's own refs** — no service, and no credentials beyond the ones
your clone already uses:

```json
{ "share": { "kind": "git", "namespace": "refs/variance" } }
```

Each line is one commit under `refs/variance/mainline/<name>` or
`refs/variance/branch/<name>`, whose tree holds the record and the images it
names. Nothing is under `refs/heads/`, so a clone does not fetch these refs and
your branch list does not show them. `namespace` moves the prefix, for a
repository that already uses `refs/variance/`.

Every fetch and push runs in a bare repository of its own under `<cache>/share/`,
never in your clone. It fetches commits and trees, and fetches an image only
when something opens it. So a publish over a record that names a thousand images
downloads none of them, and sends only the images the remote does not have. It
authenticates with what your clone uses for that remote: your credential helper,
or the header `actions/checkout` writes into the clone's configuration.

Anyone with write access to the repository can replace a record under
`refs/variance/`, because branch protection covers branches and tags only. A
wrong mainline record costs a branch a wrong evaluation until the next push to
that mainline replaces it.

**A directory** — which is what `actions/cache` restores, what `aws s3 sync`
mirrors, what an NFS mount is, and what a laptop has:

```json
{ "share": { "kind": "directory", "root": ".variance-share" } }
```

**A base URL** — which is what a bucket with object access is, and what a
presigned base is:

```json
{
  "share": {
    "kind": "http",
    "endpoint": "https://objects.example.com/variance",
    "token": { "env": "VARIANCE_SHARE_TOKEN" },
    "method": "PUT"
  }
}
```

`token` is read from the environment and sent as `Authorization: Bearer …`.
`method` is the verb a write uses: `PUT` for a bucket, `POST` for a deployment
that routes on it. A presigned base needs neither. Nothing here signs a request,
so `endpoint` must be a URL that already works as given.

Under the endpoint, a line is `<kind>/<name>/manifest.json` with its entries
under `<kind>/<name>/entries/`, and an image is `images/<digest>`. The manifest
is written with `If-Match` on the `ETag` it was read with, which S3, GCS and R2
all honour, so two jobs publishing at once keep both entries.

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
        with:
          fetch-depth: 0
      - run: npx variance run --commit ${{ github.sha }} --run ${{ github.run_id }}
      - run: npx variance share --publish
        if: always()
```

`if: always()` publishes a red run too, which is the run your checkout most
wants to read. `fetch-depth: 0` is what lets the lookup count the distance; with
the default depth of one, it answers without it.

A matrix of shards publishes once, from the job that merges the shards. Jobs
that run different suites each publish their own entries into the same record.

## S3

Either kind works, and they differ in who does the talking.

With the AWS CLI, which is the arrangement to prefer when the runner already has
credentials: sync the share's root before the run and after the publish.

```yaml
      - run: aws s3 sync s3://example-variance/share .variance-share
      - run: npx variance run --commit ${{ github.sha }}
      - run: npx variance share --publish
      - run: aws s3 sync .variance-share s3://example-variance/share
```

The config says `{ "kind": "directory", "root": ".variance-share" }`, and the
credentials never go into it. Two jobs that sync at once can lose each other's
entries, because the sync is not conditional; publish from one job.

With `kind: "http"`, when the runner has no AWS tooling: point `endpoint` at a
bucket that accepts `PUT` under a token, or at a presigned base. The manifest's
conditional write then keeps concurrent publishes safe.

## Locally

A lookup on your checkout needs only the config CI uses. With `kind: "git"` it
fetches from the remote you already push to. With a directory, point `root` at
anything the team already synchronises — a shared mount, a checkout of an
artifacts repository:

```json
{ "share": { "kind": "directory", "root": "/Volumes/team/variance-share" } }
```

With `kind: "git"`, a fetched line is reused for a minute, so ten lookups in
that minute fetch once. `npx variance share --publish` from a branch writes that
branch's line, which is how a colleague reads your run without running it.
