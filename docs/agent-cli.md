# Ask about the code and its runs from the command line

`variance ask` answers an agent's questions from a shell, with no client
configuration. Questions about the code read the checkout and need nothing
else: with no run yet, start with `variance ask packages`, which lists what each
package publishes and how much of it other packages import. Questions about a
run read the report it wrote, or the report CI published for your branch or
mainline when none is on disk: start with `variance ask summary`. Other
questions read a suite that is still running, or how long each part of the suite
took on the mainline's last build, and `variance distill` reads one finished
test's [Eyes](eyes.md) and [Sense](../packages/sense) evidence. Each command
calls the same analyzer its MCP counterpart calls.

## Find out what may be asked

```bash
variance ask
```

The listing names each question, the arguments it takes, and what it answers.
It reads no configuration, so it is available before a run exists.

## Start with the code: no run needed

```bash
variance ask packages
```

Every other question about the code needs something to ask about: a word, a
name or a specifier. `packages` is the one that needs nothing, so ask it first
when you have none of those. It reads the checkout under the working directory
and nothing else: no report has to exist and `variance.config.json` is not
opened. For each specifier, it counts the names that at least one other package
imports. It does not list where those imports are written: `uses` gives the file
and line of each. An answer looks like this, abridged:

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
that entry, and it is a deep import. A package whose declared entry the reading
could not follow to a source file, such as a `main` naming a build output the
checkout does not hold, opens no names; the imports that name that entry are
counted apart, and only an import past every entry it declares is deep.

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

## Find a name in the source

When you can describe what you need, a function, a type or a package, but do
not know its name, the name is in the source:

```bash
variance ask search --query viewport
variance ask search --query viewport --from packages/app/
variance ask symbol --name Viewport
variance ask uses --name collect --from packages/cli/src/index.ts
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

These questions read the checkout the same way `packages` does. `--from` and
`--to` are a path in the source tree, answered from what it reaches or what
reaches it. `locate` is the run question that finds a subject by the names the
run saw, and its `--from` and `--to` mean the same thing. Carry the path into
`search` when the ticket, editor or stack trace already supplied one: the words
find candidate names and the import graph removes candidates outside that
relation. Then ask `symbol` and `uses` only for the name that remains. The graph
is at file and module level; it does not record function calls. The reading,
its caches and what an answer does and does not show are one boundary,
whichever transport carries the question: [inspect the workspace public
API](agent-workspace-api.md).

## Ask a finished run, from the summary outward

The examples below are one run of three subjects, `card/summary`,
`card/compact` and `badge/standalone`, after an edit meant to give `Button` and
`Badge` a new accent colour and to tighten `Card`.

### Read the summary

```bash
variance ask summary
```

```text
3 subject(s) observed, ephemeral run at 2026-10-09T07:22:06.033Z
rendered by playwright-chromium (chromium@151.0.7922.34, darwin/arm64, 1x)
3 changed
names of 3 subject(s) written down over 8 field(s); `variance_locate {query}` finds a subject from a description

[changed] card/summary — Button: 3,402 pixels differ across 2 regions in Button, Avatar
[changed] card/compact — Button: 2,825 pixels differ across 1 region in Button
[changed] badge/standalone — Badge: 1,017 pixels differ across 1 region in Badge

coverage: every planned subject was observed.
findings: none in 3 inspected subject(s).
```

Start here. The summary counts planned subjects that were not observed as well
as the observations that produced a verdict, so silence cannot be mistaken for
a clean run. Each line in brackets is one subject: its verdict, then its id.
The id is whatever your stories or collector named the subject, and you pass it
whole to every question that takes a subject: `--subject card/summary`. The
component names after the id are what `--component` takes.

The report is the configured one unless report paths follow the question, in
which case those are read and merged — the same selection `variance report`
takes, for the same sharded runs. When the configured report is not on disk,
`ask` answers from the report CI published for your branch or mainline, and
the answer opens with the line and commit it read; the CLI's page says
[which record that is](../packages/cli/README.md#a-checkout-with-no-run-of-its-own).

### Check the run against what you meant to change

If you made the edit, you write the claims file yourself, from what you meant
to change. No command writes it: it records your intent, and the run cannot
know that. Write it from your intent, not from the summary: a file built from
the component names the run printed scores the run against itself. The file for
the edit above names each component it meant to change, as your source names it:

```json
{
  "claims": [
    { "root": "component:Button", "reason": "new brand accent on the primary action", "maxSubjects": 2 },
    { "root": "component:Badge", "reason": "new brand accent on the status pill" },
    { "root": "component:Card", "reason": "tighten the gap between the avatar and the action" }
  ]
}
```

```bash
variance ask adjudicate --claims claims.json
```

```text
An edit you declared did not take. Fix that before reading anything else.
3 claim(s): 2 delivered, 1 undelivered, 0 over-reaching, 0 unchecked. 1 unclaimed change(s).

  [undelivered] component:Card
      declared (tighten the gap between the avatar and the action) and `Card` rendered in 2 subject(s) — card/summary, card/compact — and did not change. The edit did not take: wrong file, a dead branch, a rule something else overrides, or a stale build.

  [delivered] component:Button
      declared (new brand accent on the primary action) and delivered: component:Button changed in 2 subject(s): card/summary, card/compact.
      examples/agent-claim/src/system.js:28

  [delivered] component:Badge
      declared (new brand accent on the status pill) and delivered: component:Badge changed in 1 subject(s): badge/standalone.
      examples/agent-claim/src/system.js:38

  [unclaimed] Avatar
      Avatar moved and no claim covers it — 1 subject(s), 577 pixel(s), nothing it can settle on its own
      examples/agent-claim/src/system.js:48
```

`Card` is the answer no comparison of images gives: you declared it, it
rendered in two subjects, and it did not change, so the edit to it never
landed. Fix that first and run the suite again. `variance adjudicate` runs the
same check and exits `1` when something needs review. Each claim word is defined in
[verdicts](information.md#verdicts), and the claims file's other forms are in
the `variance-authority` skill the CLI ships, described
[below](#point-an-agent-at-it).

### Group what changed, then narrow

If the summary names changes, ask `changes` before opening an individual
subject: it groups subjects under the distinct changes behind them, so a token
edit that touched forty stories is one decision rather than forty. Each change
names its component, the `file:line` that declares it, and, where one exists,
the `variance accept --shape` digest that settles it.

Narrow to `describe`, `explain-verdict`, `trace-component`, `findings`,
`composition` or `variations` once a subject or a component is in question, for
example `variance ask describe --subject card/summary`. Ask `changelog` last,
before proposing an `accept`: it takes the same `--shape` digest and previews
what acceptance would write into the baseline record.

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
