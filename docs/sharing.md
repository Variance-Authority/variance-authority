# Not deriving what another machine already derived

A run that compares a branch against mainline needs two different things about
mainline. One is the baselines: the images, which only a baseline store can
answer for and which nothing here touches. The other is everything the run
*derived* about the suite itself — which components exist, which subjects hold
them, which subject is the narrow example of each, and every name the run wrote
down for all of it. That second half is a fact about a commit, not about a run.
It costs a source scan, a browser and a composition pass, and it is identical on
every machine that starts from the same tree.

So the second machine should not pay for it again. Mainline computed it an hour
ago, on a runner that no longer exists. A **share** is where those bytes were
left on the way out.

## What travels

The [suite index](lexicon.md#where-it-is-kept): the census, the subject
denominator it is counted against, the [lexicon](lexicon.md), and the commit
they were read at. Binary, interned, and stable — two machines composing the
same suite write the same file, byte for byte, which is what lets a content-
addressed transport skip the upload and a reader recognise what it already has.

Nothing that is a finding about one run is in it. `movements`, `divergences`,
`echoes` and every verdict stay in the report, because a reading of one commit's
snapshots is not true anywhere else and a shared one would be a lie in the shape
of a baseline.

## The rule that makes it safe

> **A share never fails a run.**

A miss, an outage, an expired token, a bucket nobody has permission for, bytes
from a writer this version does not understand — every one of them is the same
outcome as having configured no share at all, which is the outcome the product
had before shares existed and is still a correct one. The run derives its own
index and carries on.

What that costs, stated rather than hidden: a broken share looks exactly like a
cold one. CI gets slow and never gets red. The signal is the number `variance
share` prints — *how far behind* the hit was — because a share answering from
forty commits back is a share nothing has written to since.

This is why a share is configured separately from `baselines` and why it has no
default. Losing a baseline loses the comparison; losing a share costs a rebuild.
Two things that fail that differently do not belong behind one setting.

## Publishing

Every `variance run` writes its suite index to this machine, under the commit
the report names, and offers it to the share when one is configured:

```text
report: .variance/report.json
suite index: ~/.cache/variance-authority/suite/web/3f1c…bd.bin (published)
```

A run whose report names no commit publishes nothing. A laptop mid-edit is such
a run, and there is nothing wrong with it — but an evaluation addressed by a
guess is worse than no evaluation, because the next machine believes it.

To publish from a report that is already on disk, or to check the wiring:

```bash
variance share --publish
```

## Looking up

```bash
variance share
```

walks the commits this checkout descends from, newest first, from the merge base
with the mainline ref. It asks this machine's own cache for each one before it
asks the share, since a commit's index is the same bytes wherever it is read.

```text
mainline evaluation at 3f1c9a2…, 2 commit(s) behind the newest this tree descends from, from the share.
412 subject(s), 168 component(s), lexicon over 9 field(s) of 412 subject(s)
at ~/.cache/variance-authority/suite/web/3f1c9a2….bin
```

What it found is kept on disk under that commit, so nothing on this machine asks
twice — and because the address is a commit rather than a branch, a checkout
that moves between branches accumulates both evaluations instead of overwriting
one with the other.

The lineage walk is bounded (`depth`, fifty by default). A branch open long
enough to exhaust it is a branch whose mainline evaluation is wrong in every
interesting way, and three hundred round trips to discover that is worse than
deriving it.

## Configuring one

Two kinds, because every transport is one of two things.

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
base is, and what a [tribunal](../packages/tribunal/README.md) deployment is:

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
which is deliberate: request signing belongs to whatever holds the credentials,
and what reaches this is a URL that already works.

`mainline` is a ref rather than a branch name, because a runner's checkout often
has no local branches at all. What is actually asked for is the commits, so a
ref that moves between two runs costs nothing — the lookup names the commit it
found.

## GitHub Actions

The expected arrangement, and the one to reach for first: a cache step around
the directory the index is kept in, before the run.

```yaml
      - name: Restore the mainline evaluation
        uses: actions/cache@v4
        with:
          path: ~/.cache/variance-authority/suite
          key: variance-suite-${{ github.sha }}
          restore-keys: |
            variance-suite-
      - run: variance run --commit ${{ github.sha }} --run ${{ github.run_id }}
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
a cache entry is immutable, so the key carries the commit rather than being a
constant; a constant key writes once and then silently holds the same stale
entry forever.

When CI already has a share configured, keep the cache step anyway. The two are
the same lookup at different distances — disk, then network — and the disk is
free.

## S3

Either kind works, and they differ in who does the talking.

With the CLI, which is the arrangement to prefer when the runner already has
credentials: sync a directory before and after the run.

```yaml
      - run: aws s3 sync s3://example-variance/suite ~/.cache/variance-authority/suite
      - run: variance run --commit ${{ github.sha }}
      - run: aws s3 sync ~/.cache/variance-authority/suite s3://example-variance/suite
```

Nothing is configured in `variance.config.json` for this, and the credentials
never enter it. The bucket is a directory as far as the run is concerned.

With `kind: "http"`, when the runner has no AWS tooling: point `endpoint` at a
bucket that accepts `PUT` under a token, or at a presigned base. One object per
commit, under `<project>/suite-index-v1/<commit>.bin`, which is a prefix a
lifecycle rule can expire on its own terms.

## Tribunal

A [tribunal](../packages/tribunal/README.md) deployment is already the place a
team's runs are sent for review, and a share over it is `kind: "http"` against a
route that stores what it is given:

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
same never-fails rule applies, and it applies most usefully here: a review
surface that is down must slow a pipeline and never stop one.

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
