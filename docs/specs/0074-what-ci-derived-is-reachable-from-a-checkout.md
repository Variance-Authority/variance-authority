# Spec 0074 — what CI derived is reachable from a checkout

**Missing:** a way for a local reader to get what CI found. `variance ask`, the
MCP tools, `variance serve` and both editors read the local filesystem only.
None of them takes a commit, a branch or a URL. So when a laptop has no run
report, no images and no coverage record, the answer is *nothing here*, even
though CI derived all three minutes ago.
**Built on:** `SharedCache` and `shareKey` in `packages/core/src/share/index.ts`,
the `directory` and `http` share kinds in `packages/cli/src/config-share.ts`,
the mainline lookup in `packages/cli/src/commands/share.ts`, and the image ref
that the composite action pushes and the `images-cleanup` job deletes. ADR-0077
decides that placement is declared per artifact in the config, and it cites
this spec for the share's layout.

## Purpose

What you can reach depends on where your baselines live, and each placement
falls short in its own way:

| Placement | What CI derived lives in | What a checkout can fetch today |
|---|---|---|
| `git` / `lfs` | Baselines: committed. Report and records: the job's work tree. | The baselines. The report and records go when the job ends. |
| `cache` | The Actions cache and a run artifact. | Only the changed before/after images on `refs/variance/<branch>`, and only while the pull request is open. |
| `tribunal` | The service: builds, images, decisions. | Nothing through the CLI. No route returns a raw report or a record. |

A checkout does not need history. Work branches off a mainline and is brought up
to date with it before it merges: that is what a merge queue, a required
up-to-date branch or a rebase is for. So the question a checkout asks is never
*what was mainline at the commit I left from*. It is *what is mainline now*, and
how far this checkout is from it. We store the latest, and we rely on engineers
keeping their branches current.

## What would discharge it

**1. One record per mainline, the latest one.** `share.mainlines` lists branch
names in order of priority, such as `["main", "release/2.0"]`, on the remote
`share.remote` names, `origin` by default. Unset, it is the one branch that
`refs/remotes/<remote>/HEAD` names, because git owns the default branch. A CI
checkout often has no such ref, and there the event's own default branch
answers. With neither, nothing is published or saved, and the log says which
answer was missing. It replaces `share.mainline`, which
named one ref whose lineage a lookup walked, and `share.depth`, which bounded
that walk. Both are deleted, not aliased, and the lineage lookup goes with them
for every share kind. A reader takes the mainline that a pull request names as
its base when it knows one. Otherwise it takes the one with the nearest merge
base, and a tie goes to the first listed.

**2. One layout, whatever the carrier.** Every share kind holds the same paths:

- `mainline/<name>/`, the latest record of each mainline;
- `branch/<name>/`, the latest run of each branch;
- `images/<digest>`, every image any record names.

Under the `git` kind, `{ "kind": "git" }`, the two record prefixes are refs,
`refs/variance/mainline/<name>` and `refs/variance/branch/<name>`, and each
ref's tree holds that record and the images it names. The cleanup job deletes
under `branch/` only, so a pull request from a release branch into `main`
cannot remove the release record. `namespace` moves the whole prefix for a
repository that already uses `refs/variance/`. Nothing sits under
`refs/heads/`, so a clone does not fetch these refs and the branch list does
not show them.

**3. A record is entries, and each entry names its commit.** A record holds the
run report and its verdict, and one entry per carried suite, each with its
record and names table. The names are repo-relative already. Each entry is
versioned, `report-v1` and `suite-v1`, and names the commit it was derived at.
For a pull request that commit is the merge commit CI ran on, and the head
commit the pull request pointed at is recorded beside it. No entry contains the
digest that keys a local cache layer, because that digest is of one machine's
absolute path. The entry's format decides its size, and the carrier compresses
nothing.

**4. Who publishes, and what may replace what.**

- A mainline record is published only by a run on a push to that mainline. A
  merge-queue run, whose branch is temporary, publishes nothing.
- A publish replaces the entries it carries and keeps the others, so suites
  from different jobs or runners land in one record. A matrix of shards
  publishes once, from the job that merges the shards.
- A mainline entry is kept only when the held entry's commit strictly descends
  from the run's commit, which is a slow run of an older commit finishing last.
  In every other case the entry is replaced, including after a force-push or an
  ejected queue group. The publisher fetches the mainline's commits alone
  (`--filter=tree:0`) to answer that. When it cannot answer, it replaces and
  logs why.
- A branch record is replaced on every publish, because a rebase leaves no
  descent to test. The reader checks whether the record still belongs, as
  item 5 says.
- A publish builds on the held tree, fetched without blobs, and pushes with
  `--force-with-lease=<ref>:<held commit>`. An image already there is not sent
  again. A lost lease reads the ref again and applies the same entries again,
  until the lease holds or a held entry is newer.
- `variance` publishes, and the action calls it. The pull-request comment links
  images at their digest paths in the branch ref's commit.
- A pull request from a fork holds a read-only token and publishes nothing.
  Its reader still gets the mainline.

**5. A reader says what it read, against what.** Every reader fetches from the
remote that hosts the mainlines, into its own git directory under the cache,
never through the user's clone. A fetched record goes into a read layer of its
own, beneath anything this checkout recorded, and never over `config.report`.
Fetches run without a terminal prompt and under a timeout. A fetched ref is
reused for a short while, so one editor session asking ten questions fetches
once.

- **What CI found here:** `variance ask`, the report-reading MCP tools,
  `variance serve` and the editors. With no local report, they read the branch
  record, then the mainline record. A branch record whose commit `HEAD` does not
  contain is reported as another branch's run, or an earlier version of this
  branch, with its commit. It is never reported as this checkout's run.
- **A base:** `variance review`, `variance select` and a run with `--since`.
  They read the mainline record and never the branch's. A base taken from the
  branch would measure the change against itself. A local recording still wins
  over the fetched one, and the answer names which of the two it read.

A hit names its commit and how many commits separate it from `HEAD`'s merge
base with that mainline. A shallow clone that cannot count leaves the distance
absent rather than zero, and still answers. A large distance is the
instruction to update the branch. An image is fetched when it is opened: the
tree names its blob, and a partial fetch brings that blob alone. A miss says
which of these it is, because each needs a different action:

- nothing published under that name;
- an entry in a newer format, so upgrade the CLI;
- refused, so check the credentials;
- the store could not be reached, or did not answer in time.

**6. The share tells a miss from a refusal, and refuses a stale write.** A
reader of this layout needs what `SharedCache` rules out on purpose:

- a `get` that says *absent*, *refused* or *unreachable* rather than `null` for
  all three;
- a listing, so a newer format is visible rather than absent;
- a conditional `put`, `If-Match` on the held version, so the replacement rule
  in item 4 holds on `http` as it does on `git`.

The derivation cache keeps its never-fails wrapper. It is the reader that gains
the distinction.

**7. `tribunal` serves the same layout.** `GET`, `PUT` and a listing under
`/share/`, backed by the bucket the worker already owns. `PUT` takes `If-Match`.
An `http` share pointed at a deployment then works unchanged. The ingest token
reads and writes, since a publish reads before it writes. A share token, a
third secret beside ingest and review, only reads. The review token grants
approval and does not open the share.

**8. Who can write is a stated position.** GitHub rulesets cover branches and
tags, so nothing protects `refs/variance/*`, and anyone with write access can
replace a mainline record. A poisoned record costs a branch a wrong selection
until the mainline's next publish replaces it, which item 4 lets it do. That
position goes in `docs/placement.md` when this lands.

## Acceptance

1. On a pull request with baselines under `cache` and a `git` share, CI goes
   red. Then, in a fresh clone of that branch with no `.variance/`,
   `variance ask` names the changed subjects and the head commit the pull
   request pointed at.
2. On a branch with no run of its own, the same command answers from the
   mainline record and says how far its commit is from the branch's merge base.
   In a clone with `--depth 1` it answers too, and says the distance is unknown.
3. After a hundred merges, each mainline ref is one commit, and an image
   unchanged across all of them was pushed once.
4. A run of an older mainline commit that finishes last leaves the newer record
   in place. After a force-push to the mainline, the next run replaces the
   record.
5. Two jobs publishing different suites at one commit leave both suites in the
   record.
6. A pull request from `release/2.0` into `main` publishes under `branch/`, and
   closing it leaves `mainline/release/2.0` in place.
7. A coverage record published by CI and fetched into a checkout at a different
   absolute path selects the same tests as it does in CI.
8. A record holding only `suite-v2` is reported as a newer format. A missing
   token is reported as refused. Neither is reported as nothing published.
9. On a branch whose own ref holds a record, `variance review` and `variance
   select` take their base from the mainline record, and say so.
10. Pointing the same reader at a tribunal deployment returns the same bytes as
    the git refs. It is refused without the share token, and a review token does
    not open it.
