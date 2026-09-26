# Spec 0074 — what CI derived is reachable from a checkout

**Missing:** a way for a local reader to get what CI found. `variance ask`, the
MCP tools, `variance serve` and both editors read the local filesystem only.
None of them takes a commit, a branch or a URL. So when a laptop has no run
report, no images and no coverage record, the answer is *nothing here*, even
though CI derived all three minutes ago.
**Built on:** `SharedCache` and `shareKey` in `packages/core/src/share/index.ts`,
the `directory` and `http` share kinds in `packages/cli/src/config-share.ts`,
the image ref `refs/variance/<branch>` that the composite action pushes, and the
local cache layers `yarn test:since` already reads over a recording made at
another commit. ADR-0077 decides that placement is declared per artifact in the
config, and it cites this spec for the git carrier.

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
*what was mainline at the commit I left from*. It is *what is mainline now*,
plus the local difference, which the cache layers already answer. We store the
latest, and we rely on engineers keeping their branches current.

## What would discharge it

**1. One record per mainline, the latest one.** `share.mainline` names one
mainline or a few, such as `main` and a release branch. Each has a store at
`refs/variance/<mainline>` holding what the newest published run on that
mainline derived, and nothing older. There is no window, no delta and no lookup
along a lineage. A branch reads the mainline it left from, the one with the
nearest merge base. The share kind is `{ "kind": "git" }`, and `namespace`
changes the prefix for a repository that already uses `refs/variance/`.

**2. A publish replaces, and never goes backwards.** Every publish writes one
parentless commit and force-pushes it with a lease. It replaces the held record
only when the run's commit descends from the held record's commit, so a slow
run of an older commit cannot overwrite a newer one. A publish that loses the
lease reads the ref again and decides again, once. Nothing sits under
`refs/heads/`, so a clone does not fetch these refs and the branch list does
not show them.

**3. Metadata and images follow different rules.**

- **Metadata** is one bundle per publish: the run report, the verdict it
  reached, the coverage record with paths rewritten repo-relative at publish,
  and its names table. Its artifact name carries a version, `bundle-v1`. It is
  fetched whole, because it is one record. Its size is the encoding's job, and
  no key or blob may contain the digest that keys the local cache layer, which
  is this machine's absolute path.
- **Images** are already compressed, so the only savings are storing each once
  and fetching only what is looked at. The bundle names each image by its pixel
  digest. The images sit under that digest, beside the bundle, so one that did
  not change costs nothing on the next publish. A reader fetches one image when
  it opens it, into its own git directory under the cache and never through the
  user's clone. Approved baselines stay where the review flow puts them.

**4. A branch's own run goes on the branch's ref.** A branch run publishes its
bundle and its changed images to `refs/variance/<branch>` on every run, not only
a red one, keyed by the pull request's head commit, never by the merge commit
CI checks out. The ref is still deleted when the pull request closes. A pull
request from a fork holds a read-only token and publishes nothing, which is a
position: its reader still gets the mainline.

**5. A reader says what it read, against what.** When a command finds no local
report, it fetches the branch's ref, then the mainline's, before it answers
*nothing here*. This covers `variance ask`, the report-reading MCP tools, and
`variance serve`: they ask what CI found on this branch. A command that reads a
**base** reads the mainline's ref and never the branch's. That covers `variance
review`, `variance select` and a run with `--since`. A base taken from the
branch would measure the change against itself. The branch's record stays
readable as what ran this code on the branch, and it is never a base. A hit names its commit, and where that commit sits relative to
the checkout: the branch head itself, or so many commits before or after the
merge base. The local difference is read the way the cache layers read it
today. A bundle far from the merge base is still an answer, and the distance is
the instruction to update the branch. A miss says which of these it is, because
they need different actions:

- nothing published on that ref;
- a bundle in a newer format, so upgrade the CLI;
- no credentials for the store;
- no merge base with any mainline, as in a shallow clone.

**6. `tribunal` serves the same records.** `GET` and `PUT /share/<key>` on the
worker, for the bundle of each mainline and branch and for images by digest,
backed by the bucket it already owns. An `http` share pointed at a deployment
then works unchanged. The ingest token writes. A read-only share token, read
from the environment, reads. The review token grants approval and is not the
key to reading.

**7. Who can write is a stated position.** GitHub rulesets cover branches and
tags, so nothing protects `refs/variance/*`: anyone with write access can
replace a mainline record. The damage is bounded because selection is advisory
off the mainline. A poisoned record costs a branch a wrong selection, and the
mainline's own run records afresh. That position goes in `docs/placement.md`
when this lands.

## Acceptance

1. On a pull request under `cache`, CI goes red. Then, in a fresh clone of that
   branch with no `.variance/`, `variance ask` names the changed subjects and the
   head commit CI ran at.
2. On a branch with no run of its own, the same command answers from the
   mainline record and says how far its commit is from the branch's merge base.
3. After a hundred merges, each mainline ref is one commit holding one bundle,
   and an image unchanged across all of them was pushed once.
4. A run of an older mainline commit that finishes last leaves the newer record
   in place.
5. A coverage record published by CI and fetched into a checkout at a different
   absolute path selects the same tests as it does in CI.
6. A ref holding only `bundle-v2` is reported as a newer format, not as nothing
   published.
7. On a branch whose own ref holds a bundle, `variance review` and `variance
   select` take their base from the mainline record, and say so.
8. Pointing the same reader at a tribunal deployment returns the same bytes as
   the git ref. It is refused without the share token, and a review token does
   not open it.
