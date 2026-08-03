# @variance-authority/cli

**Requires:** a config file, plus whatever that config selects — a browser for
`profile: chromium`, a writable directory for `baselines.kind: directory`, `git`
for `lfs`, a reachable service for `remote`. `variance doctor` reports which of
those this machine actually has.

Every other package is a tool. This is the composition an operator actually runs,
and it is the only one allowed to know what order things happen in and what a
project's configuration file looks like — which is why it is also the only one
whose requirements are decided by a file rather than by its own code.

## Commands

```bash
variance run     [--config <path>] [--profile jsdom|chromium] [--subjects <glob>] [--intent <text>]
variance report  [--config <path>] [--format text|json] [--subject <id>]
variance accept  [--config <path>] <subject>... | --all
variance serve   [--config <path>]              # MCP over stdio
variance doctor  [--config <path>]
variance comment [--config <path>] [--body-file <path>] [--run-url <url>] | --marker
```

`run` produces the verdict and the exit code; `report` re-reads what it wrote;
`accept` promotes a candidate image to baseline; `doctor` says what this machine
can observe before a run rather than after one. `serve` exposes the report the
last run wrote to an MCP client — an agent asks it what changed, which component
and which file, over stdio, without re-running anything; the tools are
[`@variance-authority/mcp`](../mcp)'s.

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
  exitFor,
  loadCollector,
  loadConfig,
  run,
  storeFor,
  writeArtifactToDisk,
  writeCliRunReport,
} from '@variance-authority/cli';
import { createPlaywrightRenderer } from '@variance-authority/playwright';

const config = await loadConfig('variance.config.json');

const report = await run({
  config,
  // Everything the run touches, handed to it. This is what the `bin` assembles.
  deps: {
    collector: await loadCollector(config.subjects.collector, { config }),
    store: await storeFor(config),
    renderer: () => createPlaywrightRenderer(),
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
  "report": "out/report.json"
}
```

`subjects` is either `{ kind: "list", ids, collector }` or
`{ kind: "storybook", index, collector }` — **both need a collector**, because
neither a list of ids nor a story index says how to mount anything, and the
mounting half of a run is code you write. `baselines` is `directory`, `lfs` or
`remote`.
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
image: mcr.microsoft.com/playwright:v1.49.0-noble

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
request — [spec 0005](../../docs/specs/0005-ci-integration.md) is `built, never
run` and this section does not change that. It is written down because the
contract said a documented equivalent would exist and, until 2026-08-03, none
did; treat the YAML as a starting point somebody still has to prove.

## Known gap

**`accept --all` does not distinguish a new baseline from a changed one.** In
that mode the CI gate becomes a recorder, which is the one thing the exit codes
above are built to prevent. Name the subjects explicitly — `variance accept
story:card--populated …` — anywhere the difference matters, and keep `--all` out
of anything that runs unattended.

## Reading

- [spec 0003](../../docs/specs/0003-cli.md) — what the CLI had to answer
- [spec 0005](../../docs/specs/0005-ci-integration.md) — the CI story around it
