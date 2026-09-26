# ADR-0077 — the config says where an artifact lives, and the host only carries it

**Status:** accepted
**Date:** 2026-09-26
**Relates to:** [ADR-0069](0069-every-answer-has-an-owner.md) (the configuration
owns what a setting means),
[ADR-0076](0076-a-suite-is-declared-and-records-alone.md) (a suite records
alone),
[ADR-0016](0016-where-a-baseline-is-kept-decides-nothing.md),
[spec 0074](../../specs/0074-what-ci-derived-is-reachable-from-a-checkout.md)
(the `git` carrier, which a checkout can reach),
[`packages/cli/src/config-share.ts`](../../../packages/cli/src/config-share.ts),
[`.github/actions/variance/locate-artifacts.mjs`](../../../.github/actions/variance/locate-artifacts.mjs)

## Context

Five artifacts outlive a run. The config says where two of them live on disk,
and says nothing about how any of them reaches the next machine. The workflows
fill the gap with literals:

| Artifact | The config says | The workflow says |
|---|---|---|
| Baselines | `baselines.root` | the same path again, and the key `variance-baselines-playwright-v1.62.1-noble-<sha>[-<run>-<attempt>]`, in `variance.yml`, `variance-shards.yml` and `variance-sweep.yml` |
| Recording, per suite | nothing (`cacheRoot` at most) | a Node one-liner calling `repositoryLayers(cwd).top`, the key `variance-<os>-<arch>-<sha>`, and the `.run-*` exclusion, in `check.yml` |
| The base's cases | nothing | a `cp` of `coverage.bin.cases.bin` into `$RUNNER_TEMP/variance-base/` before the suite overwrites it, and `--against` pointed at the copy |
| Report and images | `report`, `images` | the directory `cases/storybook-case/.variance/` minus `baselines/`, uploaded as an artifact |
| Review output | nothing | `--out $RUNNER_TEMP/variance-review` |

Each literal is a second owner, and the workflow comments admit it: "the one
place in this file that names a path the config also names … nothing checks
that it does". A config that moves `baselines.root` restores into a directory
the run never reads, and every subject comes back `new` with no error.

The baseline key goes further. It restates the renderer from the container
image tag, so a Playwright bump that forgets the key restores old-renderer
pixels, and one that remembers it restores nothing. Restoring nothing is the
worse of the two outcomes. The baseline store answers *we have seen this, on a
machine you are not* rather than *we have never seen this*, and the store
already partitions by identity digest. The key throws that answer away.

ADR-0076 raises the stakes. Suites run in different jobs: the visual suite in
the VR job and the unit suite in `check`. Each job would need its own
restore/save pair with its own hand-built path. The editor's question, *what
saw this code*, is only as good as the suites that made it back.

`locate-artifacts.mjs` is the one piece that already reads the config instead
of repeating it. Its header says it is a locator and must not become a parser,
and a key needs defaults, the base commit and the layer digest, which is parsing.

## Decision

**Every artifact that outlives a run is placed by the config, and a `variance`
command hands the host the path and the key. A workflow names no path and
builds no key.**

- **Placement is declared per artifact**, with `carry` naming the carrier:

  ```json
  {
    "baselines": { "kind": "directory", "root": ".variance/baselines", "carry": "actions-cache" },
    "suites": {
      "unit": { "kind": "unit", "carry": "actions-cache" },
      "stories": { "kind": "visual", "carry": "share" }
    },
    "report": { "path": ".variance/report.json", "carry": "share" }
  }
  ```

  `carry` is a closed list of two, split by who moves the bytes:
  - `actions-cache`: the host moves them, and they reach only another job.
  - `share`: `variance` moves them itself, through the kind the `share`
    section names: `directory` and `http` as they ship, and `git` from
    [spec 0074](../../specs/0074-what-ci-derived-is-reachable-from-a-checkout.md),
    over `refs/variance/`. A tribunal deployment is an `http` share. The
    endpoint and credentials are written once, in `share`, and not per
    artifact. A share holds one record per mainline and per branch, and
    nothing older. The record is a set of entries: `report-v1`, and one
    `suite-v1` per carried suite, each naming the commit it was derived at. A
    `suite-v1` holds the coverage record and its per-case index and no names
    table, because both name files repository-relative and the table only
    numbers what the next instrumented build emits
    ([`share-entries.ts`](../../../packages/cli/src/share-entries.ts)). Images sit beside the record, once each, by pixel
    digest. So `carry: "share"` on a suite or on the report makes it an entry
    in the record, and a publish replaces only the entries it carries. No
    entry holds the layer digest below, because a reader on another machine
    sits at another path.

  `report` takes the object form `{ "path", "carry" }` to declare a carrier.
  The string form stays, and means a report that is not carried. The report's
  images go where the report goes, because the report names them.

  An artifact a local reader must reach declares `share`. An artifact without
  `carry` stays on the machine that wrote it, which is today's behaviour for
  every config that does not change. `lfs` and `remote` baselines take no
  `carry`, because git and the service already carry them.

- **`variance carry` answers what the host moves**:

  ```bash
  variance carry restore --format github >> "$GITHUB_OUTPUT"
  variance carry save --format github >> "$GITHUB_OUTPUT"
  ```

  For each carried artifact it prints a path, a key and restore keys. It
  prints the same for the files a reviewer downloads (the report, images, and
  review output), with no key, because upload is not a lookup. Without
  `--format github` it prints the same facts as prose.

- **An Actions cache key is
  `variance-<project>-<artifact>[-<suite>]-<mainline>-<layer>-<sha>`**, and a
  save appends the run. This key is the `actions-cache` carrier's alone.
  - `<mainline>` is the branch the run's base belongs to, so a pull request
    into `release/2.0` restores `release/2.0`'s recording and not `main`'s.
  - `<layer>` is the digest `repositoryLayers` already keys the recording
    directory by. Job to job, the recording is restored to the same absolute
    path, which is why `os` and `arch` are dropped from the key.
  - **The renderer leaves the key.** The store partitions by identity digest
    and answers `incomparable` across it, which is the answer the chart's
    baseline-store boundary asks for.
  - Restore keys are the base commit, then the newest entry under the
    prefix. The commit is in the key only because an Actions cache key cannot
    be overwritten, so a save needs a new one; what a restore wants is the
    latest, the same rule the share keeps.

- **The base's cases are the CLI's to keep.**
  - When `carry restore` finds a recording made at the base, `variance` sets
    that suite's cases aside in its own layer before the suite overwrites
    them.
  - `review --since <base>` reads the set-aside cases without `--against`.
    `--against` remains for a caller who holds a file.

- **Review output defaults under the report's directory**, so `--out` is
  optional and the upload path comes from `carry`.

- **Only a push to a mainline saves a recording.** The mainlines are the
  first of these that answers, the same order spec 0074 reads:
  1. `share.mainlines`;
  2. the branch `<remote>/HEAD` names, since git owns that answer;
  3. the event's default branch, `repository.default_branch` in the file
     `GITHUB_EVENT_PATH` names, because `actions/checkout` usually creates no
     `<remote>/HEAD`;
  4. none. Nothing is saved, and `carry` says which answers were missing. It
     is never `main` by assumption.

  A pull request that saved its own would
  restore it on its next push and review the change against itself.
  `carry save` prints nothing for the recording anywhere else, so the
  workflow's `if:` on the branch goes away.

- **The shipped action uses the command.** `.github/actions/variance` restores
  before `variance run` and saves after an accept, from `carry`'s outputs.
  `locate-artifacts.mjs` is deleted.
  - A workflow that uses the action names the config and nothing else.
  - A workflow that runs steps itself (`check.yml`, the shard and sweep jobs)
    keeps `uses: actions/cache/restore@v4` and `save@v4`, with every `with:`
    value taken from a `carry` output.

## Alternatives

- **The CLI speaks the Actions cache protocol itself.** GitHub hands
  `ACTIONS_RUNTIME_TOKEN` and the results URL to JavaScript actions only, not
  to `run:` steps. Reaching the cache from `variance run` needs a JavaScript
  action to export them, and it needs a client for a service API GitHub does
  not document for third parties. That is inventing a protocol nobody
  forwards, and it breaks the day GitHub moves the service, as it did from v1
  to v2. `actions/cache` is what GitHub maintains, so the host carries and we
  name.
- **Extend `locate-artifacts.mjs`.** This is the second, more forgiving reader
  of the config that its own header forbids.
- **`share` for everything, and no `actions-cache`.** The share is what a
  checkout reads, and it keeps only the latest per mainline. Baselines are
  keyed by subject, label and identity, not by a run, and approved ones stay
  where the review flow puts them. Between two jobs of one workflow the
  Actions cache is local to the runner's region and costs no credentials, so
  it stays as the job-to-job carrier.

## Open

- **Suites carried apart share one names table.** `names.bin` numbers paths
  counting up from its own size (`cache-layers.ts:253`), and a suite's record
  is written in those numbers. Two jobs that restore the same base and each
  record one suite write two tables that disagree past the base. Restoring
  both into one layer then reads one suite's rows under the other's names.
  - Until the table is carried by content, `carry` saves the whole layer
    under each suite's key.
  - A restore takes one suite's layer, plus the other suites' directories
    only when their names table is a prefix of the one restored.
  - Anything else is reported as a suite that did not come back, never read.
- **Old identity partitions stay in the baseline cache.** Without the renderer
  in the key, a renderer bump keeps the old partition inside every later save
  until something prunes it.

## Cost

- Every workflow in this repository is rewritten. The repository's own root
  gains a `variance.config.json` that declares its suites.
- A new `carry` key per artifact, an object form for `report`, and a new
  command.
- The first save under the new key starts cold, because no old key matches
  the new prefix.
