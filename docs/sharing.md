# Reuse what mainline already worked out

Mainline worked out what your suite contains an hour ago, on a runner that no
longer exists, and the branch build is about to work it out again from scratch.
This page is for whoever owns the pipeline: it sets up a **share**, a place one
run leaves what it derived about the suite so the next machine reads it instead
of deriving it again.

New here? Start with [your first run](start.md).

A run that compares a branch against mainline needs two different things about
mainline. One is the baselines: the images, which only a baseline store can
answer for and which nothing here touches. The other is everything the run
*derived* about the suite itself — which components exist, which subjects show
them, and every name the run wrote down for all of it. A **subject** is one
named UI state you asked for and can ask for again, under an id you choose such
as `cart/empty`. That second half is a fact about a
commit, not about a run: it costs a source scan, a browser and a
[composition](composition.md) pass, and it is identical on every machine that
starts from the same tree.

So the second machine should not pay for it again. Mainline computed it an hour
ago, on a runner that no longer exists. A share is where those bytes were left
when that run finished.

The CLI is a devDependency, and every command below is run through it:

```bash
npm install --save-dev @variance-authority/cli
```

## What travels

One binary file per commit, the [suite index](lexicon.md#where-it-is-kept),
with four things in it:

| In the file | What it is |
| --- | --- |
| the census | which component was mounted in how many subjects, and which subject shows each one with the fewest other components around it |
| the subject denominator | the ids of the subjects that contributed a capture, which the census's shares are counted against |
| the [lexicon](lexicon.md) | per subject, the names that subject answered to: component names, ARIA roles, accessible names, visible text, declaring files, and the CSS custom properties it resolved through |
| the commit | the revision all of the above was read at |

Equal facts encode to equal bytes, so two machines composing the same suite
write the same file byte for byte — which is what lets a content-addressed
transport skip the upload and a reader recognise what it already has.

No images are in it, and nothing a single run decided is: what changed, what
each comparison concluded, and what a person still has to review all stay in
that run's report, because a reading of one commit's captures is not true
anywhere else.

### What it exposes

Read the third row before you choose a bucket. The lexicon records accessible
names and visible text as the run read them off your rendered UI — `Clear
completed`, `--va-space-2`, `src/todo/TodoFooter.tsx` — alongside your component
names and file paths. A share is as sensitive as your source plus whatever
your test states put on screen. Give it the audience you give the repository,
not a wider one.

Text an [ignore](ignores.md) declared volatile — a clock, a feed, an order
number — is the exception: it is digested before the lexicon is written, so it
never lands in the file as words.

## The rule that makes it safe

> **A share never fails a run.**

A miss, an outage, an expired token, a bucket nobody has permission for, bytes
from a writer this version does not understand — every one of them lands as the
same outcome as having configured no share at all. The run derives its own index
and continues.

The cost of that is on you to watch: a broken share looks exactly like a cold
one, so CI gets slow and never gets red. The signal is the number
`npx variance share` prints — *how far behind* the hit was. A share answering
from forty commits back is a share nothing has written to since.

A share is configured separately from `baselines`, and it has no default. Losing
a baseline loses the comparison; losing a share costs a rebuild.

## Publishing

Every `npx variance run` writes its suite index to [your cache](cache.md) on
this machine, under the commit the report names, and offers it to the share when one is configured:

```text
report: .variance/report.json
suite index: <cache>/suite/web/3f1c…bd.bin (published)
```

A run whose report names no commit publishes nothing — a laptop mid-edit is such
a run. Pass `--commit <sha>` to `npx variance run` when you want the run to
publish; without it the index is still written to this machine, only not
addressed to anything the next machine could ask for.

To publish from a report that is already on disk, or to check the wiring:

```bash
npx variance share --publish
```

## Looking up

```bash
npx variance share
```

walks the commits this checkout descends from, newest first, from the merge base
with the mainline ref. It asks this machine's own cache for each one before it
asks the share, since a commit's index is the same bytes wherever it is read.

```text
mainline evaluation at 3f1c9a2…, 2 commit(s) behind the newest this tree descends from, from the share.
412 subject(s), 168 component(s), lexicon over 9 field(s) of 412 subject(s)
at <cache>/suite/web/3f1c9a2….bin
```

What it found is kept on disk under that commit, so nothing on this machine asks
twice — and because the address is a commit rather than a branch, a checkout
that switches between branches accumulates both evaluations instead of
overwriting one with the other.

The lineage walk is bounded by `depth`, fifty commits by default. A branch that
has fallen further behind mainline than that gets no hit and derives its own
index, which is the right answer: mainline's names have changed since.

## Configuring one

A share is one `share` section in `variance.config.json`, beside the keys that
file already has. The blocks below show that section on its own; drop it
into the config you already have:

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
  "report": ".variance/report.json",
  "share": { "kind": "directory", "root": ".variance-share" }
}
```

Paths resolve against this file's own directory, and unknown keys are refused by
name.

There are two kinds, because every transport is one of two things.

**A directory** — which is what `actions/cache` restores, what `aws s3 sync`
mirrors, what an NFS mount is, and what a laptop has:

```json
{
  "share": {
    "kind": "directory",
    "root": ".variance-share",
    "mainline": "origin/main",
    "depth": 50
  }
}
```

**A base URL** — which is what a bucket with object access is, what a presigned
base is, and what a review deployment is:

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

`token` is read from the environment and sent as `Authorization: Bearer …`;
`method` is the verb a write uses — `PUT` for a bucket, `POST` for a deployment
that routes on it. A presigned base needs neither. Nothing here signs a request,
so `endpoint` must be a URL that already works as given: sign it, or presign it,
wherever the credentials live.

`mainline` takes a ref rather than a branch name, since a runner's checkout
often has no local branches at all. A ref that changes between two runs
costs nothing: the lookup reports the commit it found. Override it for one
command with `npx variance share --ref <ref>`.

## GitHub Actions

The expected arrangement, and the one to use first: a cache step around the
directory the index is kept in, before the run. That directory is
`<cache>/suite`, which is `~/.cache/variance-authority/suite` unless your
repository names another [cache](cache.md):

```yaml
      - name: Restore the mainline evaluation
        uses: actions/cache@v4
        with:
          path: ~/.cache/variance-authority/suite
          key: variance-suite-${{ github.sha }}
          restore-keys: |
            variance-suite-
      - run: npx variance run --commit ${{ github.sha }} --run ${{ github.run_id }}
```

No `share` section is needed for this. The run writes its index into that
directory, `actions/cache` saves it under this commit's key, and the next job —
a pull request built from the same trunk — restores it under `restore-keys` and
finds an index for a commit it descends from. The lookup is a lineage walk
rather than an exact match, which is exactly the property that makes a partial
restore useful.

Two things to know about the cache this rides on. Branch scoping is GitHub's:
a pull-request job reads caches written by its base branch, which is the
direction that matters and is the reason mainline is worth publishing at all. And
a cache entry is immutable, so the key names the commit rather than being a
constant; a constant key writes once and then silently serves the same stale
entry forever.

When CI already has a share configured, keep the cache step anyway. The two are
the same lookup at different distances — disk, then network — and the disk is
free.

## S3

Either kind works, and they differ in who does the talking.

With the CLI, which is the arrangement to prefer when the runner already has
credentials: sync `<cache>/suite` before and after the run.

```yaml
      - run: aws s3 sync s3://example-variance/suite ~/.cache/variance-authority/suite
      - run: npx variance run --commit ${{ github.sha }}
      - run: aws s3 sync ~/.cache/variance-authority/suite s3://example-variance/suite
```

Nothing is configured in `variance.config.json` for this, and the credentials
never go into it. The bucket is a directory as far as the run is concerned.

With `kind: "http"`, when the runner has no AWS tooling: point `endpoint` at a
bucket that accepts `PUT` under a token, or at a presigned base. It writes one
object per commit, at this key under the endpoint:

```text
<project>/suite-index-v1/<commit>.bin
```

`<project>` is the `project` name from your `variance.config.json` — the
required top-level key shown in the complete config above, which also names
this suite everywhere else. It is a namespace rather than a secret, and it is
what keeps two suites in one monorepo from writing over each other in one
bucket. Anything outside
`A-Za-z0-9._-` is replaced with `-` before the key is built, so pick a name that
already reads as one path segment. `suite-index-v1` states the file format's
version, so a reader that does not understand a later format asks for a key that
format was never written to rather than parsing bytes it would reject. Both
segments are stable prefixes an S3 lifecycle rule can expire on its own terms.

## A review deployment

If your team already sends its runs to a
[`@variance-authority/tribunal`](https://variance-authority.dev/reference/packages/tribunal)
deployment — the hosted service that stores runs for review — that deployment
can keep the shares too. It is `kind: "http"` against a route that stores what
it is given:

```json
{
  "share": {
    "kind": "http",
    "endpoint": "https://tribunal.example.com/share",
    "token": { "env": "TRIBUNAL_TOKEN" },
    "method": "POST"
  }
}
```

`POST` rather than `PUT` because a deployment usually routes on the verb. The
same never-fails rule applies, and it matters most here: a review service that
is down slows the pipeline and never stops it.

## Locally

Optional, and worth it on a suite large enough that composing it is felt. The
same config points at any directory the team already synchronises — a shared
mount, a Dropbox folder, a checkout of an artifacts repository — or at the same
endpoint CI uses, read-only:

```json
{ "share": { "kind": "directory", "root": "/Volumes/team/variance-share" } }
```

A developer who has run the suite once on the current trunk has the index on
disk already, and every later command reads it from there. The share is what
answers on the first run after a `git pull`.
