# Ask a run from the command line

The CLI gives an agent a shell entrance to five subjects. Each command calls the
same analyzer its MCP counterpart calls, but needs no client configuration.

- `variance ask` reads a completed visual report.
- `variance ask --at` reads a suite still executing from its watcher.
- `variance ask search` and its siblings read the source tree.
- `variance ask costs` reads how long each subject took, from the times the
  mainline's last build published.
- `variance distill` reads portable [Eyes](eyes.md) and
  [Sense](../packages/sense) evidence for one test.

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
takes, for the same sharded runs. When the configured report is not on disk,
`ask` answers from the report CI published for your branch or mainline, and
the answer opens with the line and commit it read; the CLI's page says
[which record that is](../packages/cli/README.md#a-checkout-with-no-run-of-its-own).

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
was read from is recorded beside that report as `asked.json`. It is
replaced after every successful answer and never after a refusal, which is what
lets a re-run be compared against what was actually read.

## Ask a suite that has not finished

A completed run leaves a file any process can open whenever it likes. A suite in
flight leaves nothing, and the only copy of what its tests announce is in the
memory of whatever was listening at the time — so start the listener first:

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
it for the suite needs nothing extra. Ask `self` first: it reports where the
watcher is listening and what it has received, which is what separates a suite
that reported to a different address from one that has not started.
`ask diff --at` compares against the reading the watcher handed out last — that
state lives in the watcher rather than in a file, because these questions write
nothing down and the run lives in memory that ends with the watcher.

The suite reports to the watcher only if it extends `varianceFixtures`. That
instrumentation, the ordering rule, and what the answers may be read to mean are
one boundary, whichever transport carries the question: [inspect a live
run](agent-live-run.md).

## Find where the suite's time goes

```bash
variance ask costs
variance ask costs --limit 20
variance ask costs --from packages/checkout,src/card.stories.tsx
variance ask costs .variance/report.json
```

Every run times each subject from its first collection to its verdict, and the
next run places its shards on those times. `costs` reads the same numbers back:
the files that took longest in total, each with its subject count, and then the
slowest subjects, each with the file that declares it. Ask it before you narrow
a local loop, split a file of stories, or wonder why one shard finishes last.

With no report named, it reads the times the mainline's last build published
with `variance share --publish`. Those cover the whole suite, whereas the run on
your machine is usually the slice a change selected. The first line names the
commit the times belong to and how far your checkout is from it. When the
mainline has published none, the command prints that and does not fall back to
your last local run. Name a report to read that run's own times instead.

`--from` narrows the answer to the subjects declared in the files you name, or
in files under the directories you name. The first line then gives both totals,
the scope's and the whole run's, so you can see what share of the suite the
scope costs. A scope that holds no timed subject is answered with the
directories that hold the most time, not with an empty table.

A subject the run could not time is left out of the list, never counted as zero.
A subject whose collector names no file is listed with the subjects and counted
under the file table's heading. A path scope cannot hold such a subject, so a
scoped answer counts it in the first line instead.

## Ask the code, when the name is not in the run

`locate` finds a subject by the names a run saw. When the thing you can only
describe is a function, a type or a package rather than a rendered state, the
names are in the source, and the same command reads them:

```bash
variance ask search --query viewport
variance ask search --query viewport --from packages/app/
variance ask symbol --name Viewport
variance ask uses --name collect --from packages/cli/src/index.ts
variance ask packages
variance ask entrypoint --package @acme/ui
```

`search` tells you what a thing is called, where it is written, and how to
import it. You ask for one of two reasons. To use it, you need an import line:
the specifier a manifest publishes, or a deep import of the file that declares
it. `--from` keeps the names the code at your path already depends on. To
change it, you need the declaration's `file:line` and the code that depends on
it. `--to` keeps the names in that code.

It answers in two sections: the names a manifest publishes, ranked by how
many packages import them, then the names the source exports without
publishing. A third follows only when your words match a name that does not
contain them, labelled as the looser reading it is.

Every other question needs something to ask about: a word, a name or a
specifier. `packages` is the one that needs nothing, so ask it when you have
none of those. It counts and lists no import site. An answer looks like this,
abridged:

```text
@acme/ui — 12 names, 9 imported elsewhere, 7 documented
@acme/ui/button — 3 names, 3 imported elsewhere, 1 documented

1 package that declares no entry is imported by path, most names first:
  @acme/legacy — 14 names from 3 of its files

Narrower questions:
  variance ask entrypoint --package @acme/ui
  variance ask entrypoint --package @acme/legacy
```

Each row in the first block is a specifier, what one import line names. Pass it
whole to list the names it opens, most imported first:
`variance ask entrypoint --package @acme/ui/button`. Each indented row is a
package other packages import files of. Under a package that declares no entry,
such as `@acme/legacy`, the import names a file, such as
`@acme/legacy/src/format`, because there is no entry to name, and it is an
import by path. Under a package that declares an entry, the import reaches past
that entry, and it is a deep import.

Pass the package's name to count those imports per file, the file the most
files import first: `variance ask entrypoint --package @acme/legacy`. Each row
of that answer is a specifier. Pass it to count the imports written as that
specifier per name, each name with how many files import it, and
`variance ask uses --name <name> --package <specifier>` lists the importer's
file and line for one name. A package with ten thousand importers answers in
one row per file, and a specifier in one row per name, never one line per
import. Asked by the name of a package that declares an entry, `entrypoint`
lists the names its main entry opens and then counts the imports past it the
same way. A package whose `exports` opens only subpaths has no main entry, so
asked by its name it lists the specifiers it opens instead. The answer ends
with the narrower questions it has.

`symbol` prints one name's import line, declaration, signature, documentation
and consumers; `uses` prints every import site, ordered by how much path it
shares with `--from`; `gaps` lists the published names anybody imports that
nothing documents.

To read the answer as data, add `--format json`:

```bash
variance ask search --query viewport --from packages/app/ --format json
```

Each section has a `total`, which counts every match, and `shown`, which holds
the rows the text would print. A published row carries `specifier`, `at`, the
first paragraph of its documentation as `summary`, and `inArea` when you gave a
start point. An exported row carries `at` and `line`. A section that was not run
is missing: `loose` is present only when the other two are empty, and a refused
start point returns `refused` with no sections. Only `search` answers in JSON.

These questions read the checkout under the working directory and nothing else:
no report has to exist and `variance.config.json` is not opened. `--from` and
`--to` mean what they mean on `locate` — a path in the source tree, answered
from what it reaches or what reaches it. Carry the path into `search` when the
ticket, editor or stack trace already supplied one: the words find candidate
names and the import graph removes candidates outside that relation. Then ask
`symbol` and `uses` only for the name that remains. The graph is at file and
module level; it does not record function calls. The reading, its caches and
what an answer does and does not show are one boundary, whichever transport
carries the question: [inspect the workspace public
API](agent-workspace-api.md).

## Distill one completed test

```bash
variance distill --file test/checkout.spec.ts --test submits
```

This command does not read `variance.config.json` beyond its declared suites. It
reads one case out of the checkout's record, the declared suite's that `--suite`
names, or the one `--execution` names, and combines the case's authored AAA
attention, React update initiators and covered source for every attempt the
record keeps. `--test` takes the case's id, its exact title or a part of the
title, and `--file` a part of the test file's path; more than one fitting case
is refused with their ids. A record without Eyes journals still gives the
covered source; the absent attention is not replaced by an empty one. The deterministic
reading and the skill's counterfactual verification loop are described in
[distill a test](distill.md).

## Point an agent at it

`@variance-authority/cli` ships one skill, `variance-authority`, at
`node_modules/@variance-authority/cli/skills/variance-authority`. It covers
reports, watchers and connections, choosing which tests to run, and what a
workspace publishes, and opens a reference file for each only when the question
needs it. Installing the package puts it on disk; your agent reads it only from
its own skills directory, in the project or your home directory. Claude Code
reads `.claude/skills`; most other agents read `.agents/skills`. Link it into
both rather than copying it, so it follows every update:

```bash
mkdir -p .agents/skills && ln -s ../../node_modules/@variance-authority/cli/skills/variance-authority .agents/skills/variance-authority
mkdir -p .claude/skills && ln -s ../../.agents/skills/variance-authority .claude/skills/variance-authority
```

An agent opens a skill only when its description matches the task, and it reads
`AGENTS.md` every session. The lines that send it to `variance ask` before it
searches the code are in [finding code through the workspace index](agent-workspace-api.md#point-an-agent-at-it).

`variance doctor` lists which skills your agent can find, reports whether each
is a link or a copy that has fallen behind, and prints the link for any it
cannot find. It never writes the link for you.

An MCP connection serves the same report questions as `variance_*` tools, and
`variance-authority-mcp --watch` is the watcher above over stdio. A connection
additionally serves domains kept by the integration that produced them, which is
the one thing a report file cannot answer: [question retained evidence over
MCP](agent-mcp.md). The command contracts are in the
[`@variance-authority/cli` package reference](../packages/cli/README.md).
