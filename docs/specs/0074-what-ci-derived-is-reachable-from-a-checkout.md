# Spec 0074 — what CI derived is reachable from a checkout

**Missing:** a way for a local reader to get what CI found. `variance ask`, the
MCP tools, `variance serve` and both editors read the local filesystem only.
None of them takes a commit, a branch or a URL. So when a laptop has no run
report, no images and no coverage record, the answer is *nothing here*, even
though CI derived all three minutes ago.
**Built on:** `SharedCache`, `shareKey` and `firstShared` in
`packages/core/src/share/index.ts`, which give a key per commit, a lookup along
a lineage, and `behind`. Also `lineageOf` in `packages/cli/src/commands/share.ts`,
the `directory` and `http` share kinds in `packages/cli/src/config-share.ts`, and
the image ref `refs/variance/<branch>` that the composite action pushes.
ADR-0077 decides that placement is declared per artifact in the config, and it
cites this spec for the git carrier.

## Purpose

What you can reach depends on where your baselines live, and each placement
falls short in its own way:

| Placement | What CI derived lives in | What a checkout can fetch today |
|---|---|---|
| `git` / `lfs` | Baselines: committed. Report and records: the job's work tree. | The baselines. The report and records go when the job ends. |
| `cache` | The Actions cache and a run artifact. | Only the changed before/after images on `refs/variance/<branch>`, and only while the pull request is open. The cache is unreachable outside a job, and the artifact expires. |
| `tribunal` | The service: builds, images, decisions. | Nothing through the CLI. `GET /review/builds` has no commit or branch filter, and no route returns a raw report. |

The share kinds already solve the lookup: a key per commit, and the newest one
found along the lineage. What is missing is a carrier every placement can
reach. The repository itself is one: every checkout already has credentials for
it and already runs `git fetch`.

## What would discharge it

**1. `refs/variance/` is ours, one ref per branch.** A branch's derived state
lives at `refs/variance/<branch>`, and the default branch's ref is the mainline
store. There is one namespace, one rule, and no second name to configure. The
share kind is `{ "kind": "git" }`, and `namespace` changes the prefix for a
repository that already uses `refs/variance/`. The default branch is the one
`share.mainline` names. The image ref's cleanup job never deletes it: that job
deletes a pull request's ref, and the default branch is not a pull request's
branch. The kind implements `SharedCache`:

- `get` fetches the ref once per lookup and reads `git cat-file blob
  <fetched>:<key>`.
- `put` writes the blob, the tree and the commit with plumbing, and pushes.

Keys are `shareKey`'s, so a lookup through `firstShared` is the same over
`git`, `directory` and `http`.

**2. No ref grows.** Every publish writes one parentless commit and
force-pushes it with a lease. A branch's ref holds its newest run, as the image
ref does today. The mainline ref holds the keys for the newest `share.depth`
commits of the default branch and nothing older. So a ref is always one commit,
a fetch costs one tree, and nothing accumulates, which honours *never store
pixels in anything that accumulates*. A publish that loses the lease reads the
ref again and retries once. After that it is a miss, as every share failure is.
Runs on the default branch queue instead of cancelling, so the retry is rare.
Nothing sits under `refs/heads/`, so a clone does not fetch these refs, the
branch list does not show them, and *records are not part of git* holds for
anyone who does not ask.

**3. Three artifacts, each with its own version.** `run-report-v1`, `images-v1`
and `coverage-v1`, next to the existing `suite-index-v1`. A reader that cannot
decode a version treats it as a miss and keeps walking. The coverage record
travels as one blob with its names table. The alternative is rewriting every
path to be repo-relative at publish. Either way, no key and no blob may contain
the digest that keys the local cache layer, because that digest is this
machine's absolute path.

**4. Who publishes what, and where a lookup starts.**

- Only the default branch publishes records and the suite index. A branch's
  coverage describes code that may never merge.
- A record lookup starts at the merge base, which is what `lineageOf` already
  does.
- The report and the images also start at the branch head. A branch run
  publishes them to its own ref on every run, not only on a red one, and the
  ref is still deleted when the pull request closes.
- A lookup reads the branch's ref first, then the default branch's ref.

**5. `tribunal` serves the same keys.** `GET` and `PUT /share/<key>` on the
worker, backed by the bucket it already owns, so an `http` share pointed at a
deployment works unchanged. The ingest token writes. Reading needs a token of
its own, a read-only share token. The review token grants approval, and a
laptop that only reads should not hold that. `ReviewConfig` holds the ingest
token alone, so the share token is read from the environment, like the rest.

**6. Readers ask the share when the disk has nothing.** When a command finds no
local report, it runs the lookup before it answers *nothing here*. This covers
`variance ask`, the report-reading MCP tools, and `variance serve`. A hit is
written to the local cache, as `mainlineIndex` already does for the suite
index. Every answer from a hit names the commit it came from and `behind`. A
miss names the ref and the depth it walked, so *not published* and *not found
within 50 commits* are two different sentences. A miss is never an empty
report.

## Acceptance

1. On a pull request under `cache`, CI goes red. Then, in a fresh clone of that
   branch with no `.variance/`, `variance ask` names the changed subjects, the
   commit CI ran at, and `behind: 0`.
2. The same on a branch whose last three commits were never run: the answer
   names the run's commit and `behind: 3`.
3. After a hundred merges to the default branch, the mainline ref is still one
   commit, and its tree holds exactly `share.depth` commits' keys.
4. A coverage record published by CI and fetched into a checkout at a different
   absolute path selects the same tests as it does in CI.
5. A share holding only `run-report-v2` is reported as not found. The reader
   does not fail to parse it.
6. Pointing the same lookup at a tribunal deployment returns the same bytes as
   the git ref. It is refused without the share token, and a review token does
   not open it.
