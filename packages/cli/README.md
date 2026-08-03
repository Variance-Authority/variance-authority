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
```

`run` produces the verdict and the exit code; `report` re-reads what it wrote;
`accept` promotes a candidate image to baseline; `doctor` says what this machine
can observe before a run rather than after one. `serve` exposes the report the
last run wrote to an MCP client — an agent asks it what changed, which component
and which file, over stdio, without re-running anything; the tools are
[`@variance-authority/mcp`](../mcp)'s.

`--intent <text>` declares what the change was *meant* to do, overriding the
config's `intent`. A run that matches its declared intent is adjudicated
differently from one that does not: the claim is what lets a verdict say *this is
the change you said you were making* instead of only *this changed*.

Those five are the whole surface. There is no command that posts to a pull
request; the exit code and the report are what a CI job has to work with.

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
import { run, loadConfig, exitFor, EXIT_REVIEW } from '@variance-authority/cli';

const config = await loadConfig('variance.config.json');
const report = await run(config, { profile: 'chromium' });

const code = exitFor(report);
if (code === EXIT_REVIEW) console.log('changes need review');
process.exitCode = code;
```

The injection seams are types on the options: `Collector`, `RunDeps`,
`CandidateReader`, `DoctorProbes`. A test supplies a fake renderer and a real
store, or the reverse, and neither needs a browser.

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
  "subjects": { "kind": "storybook", "index": "storybook-static/index.json" },
  "baselines": { "kind": "directory", "root": "baselines" },
  "fonts": ["Inter/400/normal/sha256-abc"],
  "report": "out/report.json"
}
```

`subjects` is either `{ kind: "list", ids, collector }` or
`{ kind: "storybook", index }`; `baselines` is `directory`, `lfs` or `remote`.
`retention: "ephemeral"` needs no baselines at all — both images are produced by
this run.

## Known gap

**`accept --all` does not distinguish a new baseline from a changed one.** In
that mode the CI gate becomes a recorder, which is the one thing the exit codes
above are built to prevent. Name the subjects explicitly — `variance accept
story:card--populated …` — anywhere the difference matters, and keep `--all` out
of anything that runs unattended.

## Reading

- [spec 0003](../../docs/specs/0003-cli.md) — what the CLI had to answer
- [spec 0005](../../docs/specs/0005-ci-integration.md) — the CI story around it
