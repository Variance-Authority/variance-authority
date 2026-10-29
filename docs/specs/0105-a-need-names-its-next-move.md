# Spec 0105 — a need names its next move

**Missing:** one table that says, for each thing an agent needs while it works
on a change, which command answers it and which need that answer opens next.
Today that knowledge is spread over prose: the skill's "Open the reference for
the question" table, `orient`'s `Narrower questions`, and a "choose the next
question" section in four pages of `docs/`, each written apart and none
checked against the commands. Only `orient`, `packages` and `entrypoint`
end with a footer of next commands; the rest name one in passing, if at all.
Nothing tells a need with no command apart from a command no need calls.
**Built on:** the `variance ask` catalogue, which reads each question's facts
off its tool's definition; the top-level command table; the next moves
`orient`, `packages` and `entrypoint` already build from their reading and
print through `narrower`; the skill in `packages/cli/skills/variance-authority/`;
and the answer object of [0104](0104-the-four-code-questions.md).
**Held by:** the compiler, for a command with no need; a test that every need
an answer opens is some command's need or a marked gap; a check that the
generated skill matches its source; a decision test per follow-up builder; and
one acceptance test, on `ask-acceptance.fixture.ts`, per tracer command.

## Purpose

An agent does not ask questions for their own sake. It holds an intent — fix
this, add that, review this branch — and each intent breaks into needs: find
the code, know what a name is, know who breaks, run what already exercises it,
re-run what the change reached. A need is answered by one command, and the
answer is what makes the next need askable: `symbol` hands over the name and
package `uses` takes.

So the CLI is a table automaton. A row is keyed by the need, the situation; its
behaviour is the command, bound to values from the answer before it; its
impact is the need the answer opens. Three things read the one table:

- **every answer** ends with its next moves: the row's impact as commands,
  filled in from the answer's reading. An `ask` answer carries them on the
  command line and over MCP alike; a top-level command prints them;
- **the skill** is generated from it, so the routing an agent reads is the
  routing the CLI prints;
- **the compiler and the tests**: a command with no need does not compile,
  and the tests hold every need to a row or a marked gap and every printed next
  move to its row.

A next move is a fact about the answer — *this name has importers outside its
package*, so `uses` is the next question — and never a procedure. Prescribing
a workflow made agents worse where stating the facts of the change cut
regressions ([TDAD](../context/prior-art.md#codebase-orientation-for-agents)); the table names what can be asked next,
not what must be.

## The table

Each row: the need, the commands that answer it, and the needs its answer
opens. A need is the row's key: every entry under Opens is the Need of another
row, word for word, and the test holds that. A move is filled in from values the
answer's reading holds; a move it cannot fill is not printed.

### Before the edit

| Need | Command | Opens |
|---|---|---|
| find the code a task talks about | `ask search --query <words>`, `ask grep --query <pattern>`, `ask discover --text <pattern>`, each with `[--from <path>]` | know what a name is before touching it |
| find the part of the repository a task is in, with no word for it yet | `ask orient`, `ask orient --area <id>` | find the code a task talks about; know what a package publishes and who takes it |
| know what a package publishes and who takes it | `ask packages`, `ask entrypoint --package <name>` | know what a name is before touching it |
| know what a name is before touching it | `ask symbol --name <name>` | know who breaks if it changes |
| know who breaks if it changes | `ask uses --name <name>` | run something that already exercises this code; find the files that take a name from outside the workspace |
| find the files that take a name from outside the workspace | `ask discover --imports <module#name>` | run something that already exercises this code |
| know what rests on a file at any depth | `ask discover --to <path>` | run something that already exercises this code |
| find the files several questions agree on | `ask intersection '<question>' '<question>'`, `ask discover` with several filters | know what a name is before touching it |
| know what a file may already use, and how | `ask stack --from <path>` | — |
| know whether an import I am about to write is allowed | `restrictions`, `layers` | — |
| know how much of a part of the repository tests reach | `coverage --from <dir>`, `coverage --packages` | run something that already exercises this code |
| run something that already exercises this code | `covering --file <path> [--function <f>]`, `ask journey-map --file <path>` | see what a test actually did here |
| see what a test actually did here | `story --file <test> --name <case>`, `distill --test <id>` | know what a test is made of; know what a name is before touching it |
| know what a test is made of | `ask test-composition --file <test>` | run something that already exercises this code |
| know why a case passes on one run and throws on another | `story --compare outcome` | know what a name is before touching it |
| know why a test fails | **gap** | — |
| know how big a change will be before making it | **gap** | — |

`ask stack` names the package's skill to read; that is a document, not a row.

### After the edit

| Need | Command | Opens |
|---|---|---|
| know which tests my change must re-run | `select --since <ref>` | know what my change reached that no test checks |
| know what my change reached, by file and line | `reach --since <ref>`, `covering --since <ref>` | know which tests my change must re-run |
| know what my change reached that no test checks | `review --since <ref> --coverage` | run something that already exercises this code |
| know what my change did to what users see | `ask summary` over the report of a `run` | know the distinct changes behind what moved |
| know the distinct changes behind what moved | `ask changes` | know everything about one subject; know whether the edit did what I meant |
| know everything about one subject | `ask describe --subject <id>` | know why a verdict may not be a code problem |
| know why a verdict may not be a code problem | `ask explain-verdict --subject <id>` | — |
| know where a component appears and what it moved | `ask trace-component`, `ask composition` | know everything about one subject |
| know what a flag or theme arm changes | `ask variations` | — |
| know which subject a description names | `ask locate --query <words>` | know everything about one subject |
| know whether the edit did what I meant | `adjudicate`, `ask adjudicate --claims <path>` | know everything about one subject |
| know what renders get wrong with no baseline | `ask findings` | — |
| settle a change | `changelog`, `ask changelog`, and `accept` on the shapes they name | — |
| know what reviewers decided or suspect | `ask decisions`, `ask concerns` | settle a change |

### While a suite runs

| Need | Command | Opens |
|---|---|---|
| know whether this is the watcher the suite reports to | `watch`, `ask self` | know what the suite is doing now |
| know what the suite is doing now | `ask run-signals`, `ask waiting` | know what one running test said |
| know what one running test said | `ask test-signals --test <id>` | — |

### Cost

| Need | Command | Opens |
|---|---|---|
| know where the suite spends its time | `ask costs`, `ask slowest-tests` | know what a test is made of |
| split the run | `shards` | — |

### Any need

| Need | Command | Opens |
|---|---|---|
| the answer needs a record that is missing | the producer the answer names: `index`, a recorded `run`, `journeys`, `collect`, `carry restore` | the need whose answer named the producer |

## Options, not a route

A row offers every command that answers its need, and the agent picks. Two
commands in one row are two ways in, not a duplicate to fold: `ask search`,
`ask grep` and `ask discover --text`; `ask intersection` and `ask discover`
with several filters; `ask costs` and `ask slowest-tests`; `reach` and
`covering --since`; `changelog` and `ask changelog`. The table constrains
nothing beyond what a row's command takes. It does not order the rows, require
a row before another, or refuse a command no row names. Where a row names one
command's answer as another's input — `ask summary` reads a `run`'s report,
`accept` takes the shapes a changelog names — that is the input, not an order.

A command whose answer serves no step of a change is still an option, listed
under the need it does serve, a row like any other:

| Need | Command | Opens |
|---|---|---|
| know which published names have no documentation | `ask gaps` | — |
| know what changed since I last asked | `ask diff` | — |
| answer over MCP | `serve` | — |
| check the setup, or clear the cache | `doctor`, `prune` | — |
| deliver a run: a report, a comment, the mainline's record | `report`, `comment`, `push`, `share` | — |

## The gaps

- **A change's size before the edit.** Every reach question takes `--since`,
  so nothing estimates what an edit to a name or a file would select before the
  edit exists. The answer is `select` asked of a name, not of a diff.
- **Why a test fails.** Answered as why its passing twins pass: the passing
  cases that entered the same region, and where the failing one left them.
  `story --compare outcome` sets one case's passing readings against its
  throwing ones, so it answers a case that fails on some runs, not a case that
  fails on every run; the cross-case half is [0103](0103-a-behaviour-names-the-cases-that-witnessed-it.md)'s
  passed-or-failed operand.

## What is left

The table has no second home: it lives on the definition that already
declares the command, as a list of needs. One command can answer several —
`ask discover` by `--text`, `--imports`, `--to` or several filters, `covering`
by `--file` or `--since`, `story` by `--name` or `--compare` — so each entry is
keyed by the flags that ask it and holds its `need` and its `opens`. The tables above are what those
fields hold.

1. The needs list as a required, non-empty field on each `ask` tool's
   definition, read by the catalogue the way it reads a tool's name and flags,
   and on a record beside the top-level command table. A command with no need
   does not compile.
2. The test over them: every need under `opens` is some command's need, or a
   gap marked with `it.todo`.
3. Next moves on `symbol`, `uses`, `covering` and `select`, the tracer: each
   tool's follow-up builder takes the entry the asked flags select and turns
   its `opens` into commands filled in from its
   reading, as `orient`'s `followUps` does today, and `narrower` in
   `packages/help/src/tools/format.ts` prints them. For `covering` and
   `select`, top-level commands, the builder sits beside the command's own
   formatter in `packages/cli`. A decision test per
   builder, and one acceptance test per command, failing first. `symbol`'s
   sentence naming `uses` gives way to the move.
4. The skill's routing table generated from the fields, with a `--write` mode
   and a check that fails when the committed skill drifts from them. A row keeps
   the reference file it routes to today; the generated column is the command.
   The "choose the next question" sections of `docs/` link to the skill's table
   instead of repeating it.
5. The remaining commands, then the gaps above, each a need of its own.
