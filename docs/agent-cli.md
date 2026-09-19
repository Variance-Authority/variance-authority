# Ask a run from the command line

The CLI gives an agent a shell entrance to four subjects: `variance ask` reads a
completed visual report, `variance ask --at` reads a suite still executing from
its watcher, `variance ask search` and its siblings read the source tree, and
`variance distill` reads portable [Eyes](eyes.md) and [Sense](../packages/sense)
evidence for one test. Each calls the same analyzer its MCP counterpart calls,
but needs no client configuration.

## Find out what may be asked

```bash
variance ask
```

The listing names each question, the arguments it takes, and what it answers.
It reads no configuration, so it is available before a run exists.

## Ask from the run outward

```bash
variance ask summary
```

Start here. The summary accounts for planned subjects that were not observed as
well as the observations that produced a verdict, so silence cannot be mistaken
for a clean run. Every other question takes an identifier it prints.

If the summary names changes, ask `changes` before opening an individual
subject: it groups subjects under the distinct changes behind them, so a token
edit that reached forty stories is one decision rather than forty.

If you made the edit, declare what you meant to change and ask `adjudicate`
before reading the diff. Its third answer — declared, and did not happen — is
how an edit that never landed is found, and no comparison of images produces it.

Narrow to `describe`, `explain-verdict`, `trace-component`, `findings`,
`composition` or `variations` once a subject or a component is in question. Ask
`changelog` last, before proposing an `accept`: it previews what acceptance
would write into the baseline record.

## Arguments are per-question

Each question takes only the arguments its own contract declares. An argument
another question takes is refused by name rather than ignored, because a
question answered about the whole suite when a subject was named reads as
correct and is not.

```bash
variance ask describe --subject story:card
variance ask changes --component Toggle
variance ask findings --rule control-without-name
variance ask changelog --shape v1:8f2c
```

The report is the configured one unless report paths follow the question, in
which case those are read and merged — the same selection `variance report`
takes, for the same sharded runs.

## An answer is not a verdict

Every answer exits `0`, including one that describes changes. Reading a run and
gating on it are separate acts: `variance run`, `variance report` and `variance
adjudicate` exit `1` when something needs review, and an agent working through
several questions would otherwise collect a failure for each one. A crash or an
operator error is `2` in every case.

Asking never renders, never re-runs and never promotes a baseline. Some answers
contain the exact command that would settle a reviewed change; producing that
command is evidence, and running it stays an explicit act by whoever owns the
review loop.

## Compare a run with the one before it

```bash
variance ask diff
```

`diff` compares the current report with the report the previous question was
answered from. An MCP connection keeps that state in memory for as long as it
lasts; a command line is a new process per question, so the report each answer
was read from is recorded beside the configured report as `asked.json`. It is
replaced after every successful answer and never after a refusal, which is what
lets a re-run be compared against what was actually read.

## Ask a suite that has not finished

A completed run leaves a file any process can open whenever it likes. A suite in
flight leaves nothing, and the only copy of what it says is in the memory of
whatever was listening at the time — so start the listener first:

```bash
variance watch
```

It prints the address the suite has to be started with, and stays up:

```
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321
```

Start the suite with that exact assignment in its environment, then ask from
another shell:

```bash
variance ask self --at http://127.0.0.1:54321
variance ask run-signals --at http://127.0.0.1:54321
variance ask test-signals --test 'checkout settles' --at http://127.0.0.1:54321
```

`--at` defaults to `VARIANCE_AUTHORITY_VANTAGE`, so a shell that already exports
it for the suite asks with nothing extra. Ask `self` first: it reports where the
watcher is listening and what it has received, which is what separates a suite
that reported to a different address from one that has not started.
`ask diff --at` compares against the reading the watcher handed out last — that
state lives in the watcher rather than in a file, because these questions write
nothing down and the run lives in memory that ends with the watcher.

The suite reports to the watcher only if it extends `varianceFixtures`. That
instrumentation, the ordering rule, and what the answers may be read to mean are
one boundary whichever transport asks: [inspect a live run](agent-live-run.md).

## Ask the code, when the name is not in the run

`locate` finds a subject by the names a run saw. When the thing you can only
describe is a function, a type or a package rather than a rendered state, the
names are in the source, and the same command reads them:

```bash
variance ask search --query viewport
variance ask symbol --name Viewport
variance ask uses --name collect --from packages/cli/src/index.ts
variance ask packages
```

`search` answers in two sections: the names a manifest publishes, ranked by how
many packages import them, then the names the source exports without
publishing. A third follows only when your words match a name that does not
contain them, labelled as the looser reading it is. Every question takes a
question: a word, a name or a specifier. `packages` is the one that takes none,
and it answers with the specifiers the others take, so it is where a reader who
has none of those starts. `symbol` prints one name's import line, declaration,
signature, documentation and consumers; `uses` prints every call site, ordered
by how much path it shares with `--from`; `entrypoint` lists what one import
specifier opens; `gaps` lists the published names anybody imports that nothing
documents.

These questions read the checkout under the working directory and nothing else:
no report has to exist and `variance.config.json` is not opened. `--from` and
`--to` mean what they mean on `locate` — a path in the source tree, answered
from what it reaches or what reaches it. The reading, its caches and what an
answer may be taken to claim are one boundary whichever transport asks:
[inspect the workspace public API](agent-workspace-api.md).

## Distill one completed test

```bash
variance distill \
  --test 'checkout submits' \
  --eyes .variance/eyes.json \
  --execution .variance/execution.json
```

This command does not read `variance.config.json`. It combines one test's
authored AAA attention, React update initiators and entered source, and returns
the same reading as the MCP tool `variance_distill`. Either evidence path may be
omitted; the absent domain is not replaced by an empty one. The deterministic
reading and the skill's counterfactual verification loop are described in
[distill a test](distill.md).

## Point an agent at it

For Codex, install the `variance-authority` skill from this repository:

```text
$skill-installer install https://github.com/Variance-Authority/variance-authority/tree/main/packages/cli/skill as variance-authority
```

Invoke it as `$variance-authority`, or let Codex select it when a Variance
Authority report, watcher or connection is in scope. Installing
`@variance-authority/cli` supplies the commands and the same skill source, but
does not register the skill with Codex; skill installation is a separate step.

An MCP connection serves the same report questions as `variance_*` tools, and
`variance-authority-mcp --watch` is the watcher above over stdio. A connection
additionally serves domains kept by the integration that produced them, which is
the one thing a report file cannot answer: [question retained evidence over
MCP](agent-mcp.md). The command contracts are in the
[`@variance-authority/cli` package reference](../packages/cli/README.md).
