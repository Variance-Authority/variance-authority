# @variance-authority/cli

**Requires:** a project config plus the runtime resources it selects: a browser
binary for Chromium, writable storage for directory baselines, `git` for LFS,
or reachable services for remote rendering and storage.

Run the complete Variance Authority workflow from a project-owned config:
collect subjects, settle cheap comparisons, render what remains, write one
report, and return a CI-safe exit code.

Use this package when you want an executable integration rather than a custom
library composition. `variance doctor` checks the selected prerequisites before
the first expensive run.

## Integrate the CLI

### 1. Choose how subjects enter

The CLI deliberately does not guess how your application mounts. Point
`subjects.collector` at one of the shipped adapters or at a collector module
owned by your project:

- [`@variance-authority/storybook-collector`](../storybook-collector) for a
  built or served Storybook;
- [`@variance-authority/route-collector`](../route-collector) for served routes,
  a sitemap, or a static build;
- [`@variance-authority/playwright-test`](../playwright-test) instead of this
  CLI when navigation and readiness already live in Playwright tests.

### 2. Add `variance.config.json`

The config declares the observation profile, viewport, subject source,
retention, baseline backend, renderer identity inputs, and report location.
Start from the [configuration example](#configuration), then use the selected
collector README for its subject-specific module.

Unknown keys are refused. A misspelled option must not leave the operator
reading one configuration while the run follows another.

### 3. Diagnose the environment

```bash
variance doctor --config variance.config.json
```

Run this in the same machine or CI image that will execute `variance run`.
Doctor reports what can be checked locally and labels remote renderer checks as
not performed rather than pretending a network endpoint is healthy.

### 4. Run, review, accept, rerun

```bash
variance run --config variance.config.json
variance report --config variance.config.json --format html > .variance/report.html
variance accept --config variance.config.json story:checkout--empty
variance run --config variance.config.json
```

The first successful durable run exits `1` because its subjects are `new`.
Review the generated candidates, accept the intended subject ids explicitly,
then rerun. An unchanged run exits `0`; a configuration, browser, collector, or
store failure exits `2`.

Keep `accept --all` out of unattended workflows. It currently cannot
distinguish a never-reviewed baseline from a changed one, so explicit subject
ids are the safe default after initial setup.

## Commands

```bash
variance run     [--config <path>] [--profile jsdom|chromium] [--subjects <glob>] [--intent <text>] [--run <id> --commit <sha>] [--since <ref>] [--flakes] [--exit-zero-on-changes]
variance report  [--config <path>] [--format text|json|html] [--subject <id>] [--exit-zero-on-changes] [<report>...]
variance accept  [--config <path>] <subject>... | --all | --shape <fingerprint>[,...]
variance serve   [--config <path>]              # MCP over stdio
variance doctor  [--config <path>]
variance comment [--config <path>] [--body-file <path>] [--run-url <url>] [<report>...] | --marker
```

`run` produces the verdict and the exit code; `report` re-reads what it wrote;
`accept` promotes a candidate image to baseline — by subject, by `--all`, or by
`--shape`, which accepts a difference *shape* wherever it is the whole change and
refuses by name any subject where something else moved too; `doctor` says what this machine
can observe before a run rather than after one. `serve` exposes the report the
last run wrote to an MCP client — an agent asks it what changed, which component
and which file, over stdio, without re-running anything; the tools are
[`@variance-authority/mcp`](../mcp)'s.

### `--format html`: the diff as one page, with no service behind it

```bash
variance report --format html > out/report.html
```

One file, written beside `report.json`, uploaded by whatever already uploads your
CI artifacts. No account, no upload step, no retention policy, nothing to keep
running — the cheapest rung of presentation infrastructure there is.

It renders the same docket the pull-request body does: causes first with
`file:line`, collateral counted rather than listed, an entry the semantic tier
did not name marked as *largest region, not a named cause*, and coverage failures
above the findings so the page cannot look complete when it is not. A fourth
renderer must never produce a fourth answer, so `docket.ts` folds and the
renderers only draw.

Two constraints worth knowing. **Image paths are relative to the report**, so the
page belongs beside it — a report written elsewhere shows broken images rather
than wrong ones. And the page fetches nothing: no script, no stylesheet, no font,
because a page that loads anything renders differently for the reviewer than it
did in CI. `--subject` is refused here rather than honoured: a page narrowed to
one subject says nothing about coverage while looking like a whole run.

### Finding a flake before it costs a build: `run --flakes`

Every run reads a *changed* subject a second time before believing its verdict.
`--flakes` reads **every** subject twice, whatever the verdict, which is a
different question: not *is this change real* but *which of these subjects would
flake tomorrow*.

```bash
variance run --flakes
```

A subject that agrees with its baseline and disagrees with itself is a flake one
run before anybody has to look at a red build, and it is unreachable from a
verdict — a green suite settles on its digests and never builds a comparison at
all. The answer names the component, the file and the frequency band:

```
[unstable] story:case-surface--ticking: … Clock src/ds.jsx:118 read differently
  (geometry, token, content)
```

It costs one collection per subject and never a render, so a sweep of 300
subjects is 300 cheap collections — the shape that pays for itself nightly rather
than on every pull request. The `alone.limit` budget does not apply: an operator
who asked about the suite must not be handed the first twenty subjects under a
whole-suite heading. `alone.limit: 0` still turns it off, because one number
cannot mean *do not re-collect anything* on Tuesday and something else on
Wednesday.

Unstable subjects exit **1** even when every verdict is green — a sweep that
found six and exited 0 would have told CI nothing it could act on.

Stability is demanded only inside the boundary a subject declares. A route with
`sensitivity.level: layout` has said it does not assert on what the page is
painted with, so a clock ticking inside it is listed under *not asserted on*,
does not gate, and is not refused by `accept`. `strict` absorbs nothing.

### Reporting without gating

`--exit-zero-on-changes` turns exit 1 into exit 0 on `run` and `report`, for a
job that reports rather than blocks the merge — which is how most of this
category is actually run.

The reason it is a flag and not a line of shell: `|| true` swallows exit **2** as
well. A job whose browser never launched observed nothing and therefore found
nothing, and `|| true` posts a green tick over it. This suppresses exit 1 only,
leaves operator errors at 2, and writes one line to stderr saying the code was
suppressed — a run whose exit was quietly rewritten is otherwise indistinguishable
in a log from a run that found nothing.

### Sharding: `report` takes more than one file

A suite big enough to split across CI jobs runs `variance run --subjects <glob>`
once per job and ends with one artifact each. Name them all and `report` answers
about the suite rather than about a slice — one exit code, one body for
`comment`:

```bash
variance report shard-1.json shard-2.json shard-3.json
```

`comment` takes them the same way, so the pull request gets one body rather than
one per job:

```bash
variance comment --body-file body.md shard-1.json shard-2.json shard-3.json
```

Naming any report replaces the configured one rather than adding to it, because
a shard writes where its job told it to and merging in a file nobody asked for is
not a thing a reader can undo.

The merge refuses more than it accepts, and both halves are the point. Shards
whose renderer identity, retention or `--intent` differ were not one run, and are
refused naming both files — carrying one of the two answers under a single
heading is how half a report gets attributed to a machine that never saw it. Two
shards observing the same subject means the globs overlapped, which only the
operator can resolve.

What it does accept is the arithmetic nobody wants to do by hand. Each shard
records every subject outside its slice as `excluded`, so three shards report
each subject as excluded twice and observed once; the merge resolves those
against what was actually observed. **A subject that every shard filtered out is
promoted to `failed` and turns the merged run red** — each shard exits `0`
because each did exactly what it was told, and the suite is missing a component.
That is the case sharding introduces and nothing else can see.

`comment` renders the same report as a pull-request body: causes first,
collateral counted rather than listed, and **nothing when the check is green** —
an empty body, because a bot that comments on every clean pull request teaches
the team to filter it out, and the filter does not distinguish the clean ones.
It writes to `--body-file` when given one and to stdout otherwise, and it posts
nothing itself. `--marker` prints the HTML comment the poster searches for to
find and rewrite its own previous docket; it is asked separately because it is
needed in exactly the case where there is no body to read it out of. Exit `0`
means *this rendered*, never *the run was clean* — the verdict belongs to `run`,
which already said it.

`--intent <text>` declares what the change was *meant* to do, overriding the
config's `intent`. A run that matches its declared intent is adjudicated
differently from one that does not: the claim is what lets a verdict say *this is
the change you said you were making* instead of only *this changed*.

Those six are the whole surface. **No command posts anything anywhere.**
`comment` produces the body; sending it is
[`.github/actions/variance`](../../.github/actions/variance)'s job, with the
operator's own token, and the exit code and the report remain what a CI job
actually gates on.

## Exit codes, and why they are the interface

```
0  nothing needs review
1  changes need review
2  operator error
```

**A verdict and a crash never share a code.** A red build that could mean either
"a component changed" or "the store was unreachable" is a red build nobody
investigates, and the second case is the one where continuing destroys a
baseline. `variance doctor` exists so the second is diagnosable before a run
rather than after one.

## The library half is deliberate

Everything the `bin` does is exported as an ordinary function. A CLI whose logic
is reachable only by spawning a process can be tested only by spawning one, so
the questions that actually matter — *does this exit code mean what CI thinks it
means*, *is this skip reported* — become integration tests with a browser in
them, which is to say they stop being asked.

```ts
import {
  EXIT_REVIEW,
  collectorPath,
  exitFor,
  loadCollector,
  loadConfig,
  rendererFor,
  run,
  storeFor,
  writeArtifactToDisk,
  writeCliRunReport,
} from '@variance-authority/cli';

const config = await loadConfig('variance.config.json');

const report = await run({
  config,
  // Everything the run touches, handed to it. This is what the `bin` assembles.
  deps: {
    collector: await loadCollector(collectorPath(config.subjects), { config }),
    store: await storeFor(config),
    // `rendererFor`, not `createPlaywrightRenderer`: it is the one expression that
    // reads `browser` and `renderer` out of the config, so a composition cannot
    // quietly launch a local Chromium for a run configured to paint elsewhere.
    renderer: () => rendererFor(config),
    now: () => new Date().toISOString(),
    writeArtifact: writeArtifactToDisk,
    writeReport: writeCliRunReport,
  },
});

const code = exitFor(report);
if (code === EXIT_REVIEW) console.log('changes need review');
process.exitCode = code;
```

**`deps` is the whole argument, and it is why the example is this long.** The
injection seams are types on it — `Collector`, `RunDeps`, `CandidateReader`,
`DoctorProbes` — so a test supplies a fake renderer and a real store, or the
reverse, and neither needs a browser. `now` is in there for the same reason: a
report carries a timestamp, and a test that cannot fix the clock cannot assert
the artifact it produced.

## The order it runs in, and why

1. **Collect** — subjects from a list or from a Storybook index.
2. **Settle what the cheap tiers can settle.** A subject whose document digests
   to what the baseline was painted from cannot differ, and is answered by 32 hex
   characters rather than by an image.
3. **Render only the residue.**
4. **Write a report that accounts for every subject** — including the ones it did
   not observe.

That last one is the failure this whole system exists to make impossible. A
summary that says "nothing to review" because eleven subjects failed to render is
worse than no summary at all.

## `accept` never produces an image

It promotes one the run already produced. A command that could re-render on
acceptance is a command that can record something nobody looked at.

## Configuration

A file the operator wrote. Nothing is inferred from the network and nothing is
downloaded, so the run's inputs are the ones in the repository.

```jsonc
// variance.config.json
{
  "project": "todomvc",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": {
    "kind": "storybook",
    "index": "storybook-static/index.json",
    "collector": "variance/collector.mjs"
  },
  "baselines": { "kind": "directory", "root": "baselines" },
  "fonts": ["Inter/400/normal/sha256-abc"],
  "browser": "chromium",
  "report": "out/report.json",

  // What is not the subject. Every rule needs an id and a reason, and every rule
  // must name a `select` or a `fingerprints` — a rule scoped only by band would
  // be a tolerance. See ../../docs/ignores.md.
  "ignore": [
    { "id": "clock", "reason": "renders wall time", "select": "header time" }
  ]
}
```

`subjects` is either `{ kind: "list", ids, collector }` or
`{ kind: "storybook", index, collector }` — **both need a collector**, and for
Storybook that collector is now
[`@variance-authority/storybook-collector`](../storybook-collector) and five
lines. For anything else, neither a list of ids nor a story index says how to
mount, and the mounting half is code you write. `baselines` is `directory`, `lfs`
or `remote`.

`renderer` points the run at a machine that is not this one:
`{ "endpoint": "http://pinned-runner:7777" }`, served by `serveRenderer` from
[`@variance-authority/remote`](../remote). It carries no token because
`serveRenderer` has no authentication — a field accepting a credential nobody
transmits would read as the endpoint being protected. It is refused together with
`browser`, since the engine belongs to whichever machine paints. `variance doctor`
reports a remote renderer as **not checked** rather than unavailable, and exits
clean: doctor makes no network calls, and an unasked question is not a failed one.

`ignore` is the one setting that makes a run *less* observant, so it is the one
with the most rules attached. Each entry excludes a subtree (`select`) or a
difference shape (`fingerprints`, copied out of a previous run's regions), may be
narrowed by `subjects`, and may carry an `until` date after which it
stops absorbing. A subject whose only differences were absorbed reports
**`ignored`**, never `unchanged`, and every run prints a ledger naming the rules
that absorbed nothing — the two states that make a masked suite rot. Full
treatment with a case per situation in [`docs/ignores.md`](../../docs/ignores.md).

`browser` is `chromium` (the default), `firefox` or `webkit`. **One word, not a
matrix**, and that is a property of what a run is rather than a missing feature:
the engine is part of the identity a baseline is stored under, so two engines are
two runs with two sets of baselines. Switching it is safe by construction — a run
under a new engine finds nothing under its key and reports every subject `new`,
loudly, instead of diffing two engines and blaming a component for a font stack.
`retention: "ephemeral"` needs no baselines at all — both images are produced by
this run.

## Bitbucket Pipelines, and what carries to any CI

There is a composite action for GitHub Actions
([`.github/actions/variance`](../../.github/actions/variance)). There is no
second integration to install, and there does not need to be: **the exit code
above is the whole interface**, so a CI that can run a command already has the
gate. What a platform integration adds is the comment, and that is the only part
worth writing down twice.

```yaml
# bitbucket-pipelines.yml
image: mcr.microsoft.com/playwright:v1.62.1-noble

pipelines:
  pull-requests:
    '**':
      - step:
          name: variance
          script:
            - corepack enable && yarn install --immutable
            - yarn build
            # The gate. Nothing parses this output; the exit code is the verdict,
            # and `set -e` is what turns 1 into a failed step.
            - node packages/cli/dist/bin.js run --config variance.config.json --profile chromium
          after-script:
            # `after-script` runs whether or not the step passed, which is the
            # point: the run that failed is the run whose docket is worth posting.
            - node packages/cli/dist/bin.js comment --config variance.config.json --body-file body.md
            - bash ./bitbucket-comment.sh body.md
          artifacts:
            - .variance/**
```

The poster is the platform-specific half, and it needs one thing from this CLI:

```bash
variance comment --marker
```

That prints the invisible marker the rendered body carries, and nothing else.
Finding a previous comment by it and updating that comment — rather than adding
one per run — is the whole of the "one comment, updated in place" rule; on
Bitbucket that is a `GET` of
`/2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments`, a search for
the marker in `content.raw`, and a `PUT` to the one that has it or a `POST` if
none does. `.github/actions/variance/post-comment.mjs` is the same three steps
against GitHub's API and is the file to read while writing the other.

**Never run.** Neither this nor the GitHub workflow has executed on a real pull
request, and this section does not change that — see
[ADR-0019](../../docs/context/adr/0019-one-comment-that-leads-with-causes.md),
which decides what a comment does and records that none has ever been posted.
Treat the YAML as a starting point somebody still has to prove.

## Known gap

**`accept --all` does not distinguish a new baseline from a changed one.** In
that mode the CI gate becomes a recorder, which is the one thing the exit codes
above are built to prevent. Name the subjects explicitly — `variance accept
story:card--populated …` — anywhere the difference matters, and keep `--all` out
of anything that runs unattended.

## Integration troubleshooting

| Symptom | What it means | Next check |
| --- | --- | --- |
| Exit `2` before any docket | The run failed operationally rather than finding a reviewable change. | Run `variance doctor` in the same environment; then inspect browser, collector, renderer, and store diagnostics. Do not suppress this with `|| true`. |
| Every subject is `new` after changing browser or renderer settings | The environment identity changed, so old and new images are intentionally partitioned. | Confirm the engine, viewport scale, fonts, and stabilization inputs. Establish new baselines only when the identity change was intended. |
| A planned subject is absent from the report | Coverage accounting failed; a complete run must account for observed, excluded, or failed subjects. | Inspect collector failures and, for shards, verify the subject globs cover the whole plan without overlap. |
| HTML report images are broken | Image paths are relative to the JSON report. | Upload or move the HTML report together with its report and image directory. |
| A ready selector times out | The collector reached the subject but its project-owned completion marker never appeared. | Check the collector module's id-to-selector map; do not replace the marker with an arbitrary sleep. |
| A clean pull request has no comment body | This is expected. `variance comment` emits an empty body for a clean report. | Keep the CI gate on `variance run`; let the posting integration delete or skip its prior comment. |
| A merged shard report is refused | The shards did not describe one compatible run or observed the same subject twice. | Align renderer identity, retention, and intent, then make the subject globs disjoint. |
| A change is green but reported as `ignored` | Differences existed and declarations absorbed all of them. | Read the ignore and sensitivity registers; `ignored` is intentionally distinct from `unchanged`. |

## Reading

- [ADR-0017](../../docs/context/adr/0017-the-exit-code-is-the-interface.md) — why the exit code carries the verdict and the config is a file
- [ADR-0019](../../docs/context/adr/0019-one-comment-that-leads-with-causes.md) — the CI story around it
