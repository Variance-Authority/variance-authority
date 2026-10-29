# Spec 0105 — a need names its next move

**Missing:** two things that today live only in prose. The first is a
catalogue: for each thing an agent needs while it works on a change, the
commands that answer it and the needs its answer can open. The second is the
binding: how one answer's facts become the arguments of the next question. The
routing is written apart in the skill's "Open the reference for the question"
table, in `orient`'s `Narrower questions`, and in a "choose the next question"
section in four pages of `docs/`. None of it is checked against the commands.
Next questions are spelled in three ways. `orient`, `packages` and
`entrypoint` end with a footer built from their reading. `discover`, `grep`,
`intersection`, `slowest-tests` and `symbol` name one through `spellingOf`.
`covering`'s evidence gap names the run that closes it. Every other answer names
none, and nothing says which of these a need should get. Nothing tells a need with no command apart from a command no need calls.
**Built on:** the `variance ask` catalogue, which reads each question's facts
off its tool's definition, the `Tool` of `packages/mcp/src/tools/tool.ts`; the
top-level command table; `spelling.ts` in the same directory, the one place an
answer spells what to ask next for the surface it was asked on; the `followUps`
that `orient`, `packages` and `entrypoint` build from their reading; the
evidence gap of `evidence-gap.ts`; the skill
in `packages/cli/skills/variance-authority/`; and the answer object of
[0104](0104-the-four-code-questions.md).
**Held by:** the compiler, for a command or MCP tool with no entry and, once 0104's answer
object is a type, for a move whose argument has no source field; a test that every need an entry opens is some
entry's need or a marked gap; a check that the generated skill matches its
source; and, per tracer command, a decision test of its builder and an
acceptance test that asks each printed move and reads its answer.

## Purpose

An agent does not ask questions for their own sake. It holds an intent — fix
this, add that, review this branch — and each intent breaks into needs: find
the code, know what a name is, know who breaks, run what already exercises it,
know what the change reached. A need is answered by a command, and the answer is
what makes the next need askable: `symbol` finds the name and the package
that declares it, and `uses` takes both.

So the CLI is a table automaton with two layers. The catalogue is static: a row
is keyed by the need; its behaviour is a command; its edges are the needs the
answer can open, each with the answer fields that fill the next command's
arguments. The answer is dynamic: it holds the declarations, files, cases,
subjects and missing evidence it found. A **move** is one edge instantiated by
one answer: the edge's command with every argument filled from a field of that
answer. The catalogue says what can follow. Only the answer says what does.

- **Every answer** carries its moves as data: a move is a declared tool and its
  input, spelled by `spellingOf` for the surface the answer was asked on, a
  verb with flags in a shell and a tool name with arguments over MCP. `narrower`
  only lays the spelled lines out. There is one list and one speller.
- **The skill** is generated from the catalogue. It says which questions exist
  and what each takes. It holds no arguments, since it cannot know a future
  answer.
- **The compiler and the tests** hold the catalogue closed and every move
  executable, as Held by says.

A move is a fact about the answer: *this name has importers in two other
packages*, so `uses` is a question worth asking. It is never a procedure.
Prescribing a workflow made agents worse where stating the facts of the change
cut regressions ([TDAD](../context/prior-art.md#codebase-orientation-for-agents)).
The catalogue names what can be asked next, not what must be.

## A move

An edge names its destination need, the command that answers it — the declared
tool itself, never its name written out, so deleting the tool fails the build as
it does for a hint today — and, for each argument the command takes, the answer
field that supplies it. Checking a binding against a field needs a type to
check it against: `Tool.run` returns text today, so this check rides 0104's
answer object becoming the tool's answer type, and until then a binding is held
by the builder's decision test.

A field is a value the answer holds, or an input it was asked with and
echoes, such as the ref `--since` named. A field names one thing of a stated kind: a declaration, as a name and the
package that declares it; a file; a test case, as a file and a case name; a
subject id; a ref. The kind of the edge's arguments is the kind of thing the
move asks about.

| The answer holds | The move |
|---|---|
| the field the edge needs, once | one move |
| it for several things | one move per thing, in the answer's order, up to the answer's own limit, the rest counted |
| several things the command's arguments cannot tell apart | one move that asks about all of them, saying so |
| no value for the field | no move |
| a value, but no fact the destination would read | no move |

So `symbol` that finds `Coverage` declared in two packages prints two `uses`
moves, each with its `--package`. A move never picks one of several
candidates for the agent. The last row is the condition: `symbol` that finds no
declaration opens no `uses`, and `changes` with nothing changed opens no
`describe`. An edge is printed only when the answer holds a fact the next
answer reads. An edge into other evidence, from the source index to a
recording, is printed when its field is present, since whether a record exists
is not the source answer's to know; the destination answers an absent record
with its own gap.

The catalogue may hold cycles, such as `covering` to `story` to
`ask test-composition` and back to `covering`. A move needs a fact of its own answer, so an agent
following moves stops where the answers stop finding anything.

### What a move is not

- **An evidence gap.** When an answer cannot be given because a record is
  absent, stale or too coarse, `evidence-gap.ts` owns what follows: the question
  left open, why, the run that closes it and what it costs. A gap is not a move
  to another need. It is the same need, asked again once its evidence exists.
  An answer carries its moves and at most one gap, and the catalogue routes
  neither of them through the other.
- **Usage.** When a command is asked without an argument it requires,
  `asking.ts` says what it takes. That is the command's own usage, not a move.

## The catalogue

Each row: the need, the commands that answer it, and the needs its answer can
open. A need is the row's key: every entry under Opens is the Need of another
row, word for word, and the test holds that. A command marked *operation*
writes a record or a file. Every other command only reads.

### Before the edit

| Need | Command | Opens |
|---|---|---|
| find the code a task talks about | `ask search --query <words>`, `ask grep --query <pattern>`, `ask discover --text <pattern>`, each with `[--from <path>]` | know what a name is before touching it |
| find the part of the repository a task is in, with no word for it yet | `ask orient`, `ask orient --area <id>`, `ask orient --files <path>` | find the code a task talks about; know what a package publishes and who takes it |
| know what a package publishes and who takes it | `ask packages`, `ask entrypoint --package <name>` | know what a name is before touching it |
| know what a name is before touching it | `ask symbol --name <name> [--package <name>]` | know who breaks if it changes |
| know who breaks if it changes | `ask uses --name <name> [--package <name>]` | run something that already exercises this code; find the files that take a name from outside the workspace |
| find the files that take a name from outside the workspace | `ask discover --imports <module#name>` | run something that already exercises this code |
| know what rests on a file at any depth | `ask discover --to <path>` | run something that already exercises this code |
| find the files several questions agree on | `ask intersection '<question>' '<question>'`, `ask discover` with several filters | know what a name is before touching it |
| know what a file may already use, and how | `ask stack --from <path>` | — |
| know whether an import I am about to write is allowed | `restrictions`, `layers` | — |
| know how much of a part of the repository tests reach | `coverage --from <dir>`, `coverage --packages` | run something that already exercises this code |
| run something that already exercises this code | `covering --file <path> [--function <f>]`, its MCP twin `variance_source_tests`, `ask journey-map --file <path>` | see what a test actually did here |
| see what a test actually did here | `story --file <test> --name <case>`, `distill --test <id>`; over MCP `variance_distill`, `variance_test_attention`, `variance_scenarios`, `variance_presentations` | know what a test is made of; know what a name is before touching it |
| know what a test is made of | `ask test-composition --file <test>` | run something that already exercises this code |
| know why a case passes on one run and throws on another | `story --compare outcome` | know what a name is before touching it |
| know why a test fails | **gap** | — |
| know how many tests an edit to a name would reach, before making it | **gap** | — |

`ask stack` names the package's skill to read. A skill is a document, so it
is a field of the answer, not a move.

### After the edit

The three questions about a change ask different things of different evidence,
and none stands in for another:

| Need | Command | Opens |
|---|---|---|
| know which recorded tests my change lets me skip | `select --since <ref>` | know what my change reached that no test checks |
| know what my change could reach through the source graph | `reach --since <ref>` | know which recorded tests entered what my change touched |
| know which recorded tests entered what my change touched | `covering --since <ref>`, its MCP twin `variance_changed_tests` over a diff | see what a test actually did here |
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
| know what reviewers decided or suspect | `ask decisions`, `ask concerns` | settle a change |
| know how the report reads since I last asked | `ask diff` over the report | know the distinct changes behind what moved |
| settle a change | `changelog`, `ask changelog`; `accept` on the shapes they name, an *operation* | — |

`select` answers with a skip list, never a run list. A test the recording has
never seen is absent from it and still runs, so a list of tests to re-run would
drop exactly the tests nothing has recorded yet.

### While a suite runs

| Need | Command | Opens |
|---|---|---|
| know whether this is the watcher the suite reports to | `watch`, `ask self` | know what the suite is doing now |
| know what the suite is doing now | `ask run-signals`, `ask waiting` | know what one running test said |
| know what one running test said | `ask test-signals --test <id>` | — |
| let a test stopped at `variance.observe()` go on | `variance_continue` over MCP, an *operation* | know what the suite is doing now |
| know how the suite's signals read since I last asked | `ask diff` over the watcher | know what one running test said |

### Cost

| Need | Command | Opens |
|---|---|---|
| know which subjects the suite spends its time on | `ask costs` | know everything about one subject |
| know which tests the suite spends its time on | `ask slowest-tests` | know what a test is made of |
| split the run | `shards`, an *operation* | — |

### Other needs

A command whose answer serves no step of a change is still listed, under the
need it does serve:

| Need | Command | Opens |
|---|---|---|
| know which published names have no documentation | `ask gaps` | — |
| answer over MCP | `serve` | — |
| know which observability evidence this connection was given | `variance_observability` over MCP | see what a test actually did here |
| check the setup, or clear the cache | `doctor`, `prune`, an *operation* | — |
| deliver a run: a report, a comment, the mainline's record | `report`, `comment`, `push`, `share`, each an *operation* | — |

| make the record a question reads | `index`; `run`, which also writes the report `ask summary` reads; `review --from-run`; `journeys` with `inspect`, `finalize`, `stitch` and `combine`; `collect`; `carry save`, `carry restore` — each an *operation* | — |

An evidence gap names its own remedy, a recorded run of named test files or a
`story` of named cases, as `evidence-gap.ts` does today. The row above is for
an agent that sets a record up on purpose. Every command has an entry, a
producer as much as a question.

## Options, not a route

A row offers every command that answers its need, and the agent picks. Two
commands in one row answer the same need with different answers. They are not a
duplicate to fold:

- `ask grep` returns matching lines, nearest by import distance, and
  `ask discover --text` returns the set of files, ready to intersect.
- `ask intersection` combines any questions, and `ask discover` combines its own
  filters.
- `changelog` and `ask changelog` are one answer read on two surfaces.

Commands that answer different needs from neighbouring evidence get separate
rows: `select`, `reach` and `covering --since`; `ask costs` and
`ask slowest-tests`.

The catalogue constrains nothing beyond what a command takes. It does not
order the rows, require one row before another, or refuse a command no row
names. When a row names one command's answer as another's input — `ask summary`
reads a `run`'s report, `accept` takes the shapes a changelog names — that is an
input, not an order.

## The gaps

- **The reach of an edit before it is made.** Every reach question takes
  `--since`, so nothing estimates what an edit to a name would reach before the
  edit exists. `select` reads a diff and answers with a skip list. An answer
  before the edit has neither. It needs its own contract.
  - The input is a name and the kind of edit. A body, a signature, the module's
    imports and the package's exports reach different tests through the same
    name.
  - The answer is a source-graph estimate. It names the evidence it stands on
    and the uncertainty it carries.
- **Why a test fails.** Answered as why its passing twins pass: the passing
  cases that entered the same region, and where the failing one left them.
  `story --compare outcome` sets one case's passing readings against its
  throwing ones. So it answers a case that fails on some runs, not one that
  fails on every run. The cross-case half is
  [0103](0103-a-behaviour-names-the-cases-that-witnessed-it.md)'s
  passed-or-failed operand.

## What is left

The catalogue has no second home. It lives on the definitions that already
declare the commands. An `ask` question's entries sit on its `Tool`, declared in
`packages/mcp/src/tools/tool.ts` for every tool set, the ones `packages/mcp`
holds and the ones `packages/help` holds, all read by `variance ask` and
`serve`. So a move reaches the CLI and MCP alike, as 0104's answer object
requires. A top-level command's
entries sit on a record beside the command table in `packages/cli`. These
commands are not `ask` tools. Where one has an MCP twin, as `covering` has
`variance_source_tests` and `variance_changed_tests`, the twin's `Tool` carries
the same entry and the same builder, so both surfaces print the same moves.

One command can answer several needs: `ask discover` by `--text`, `--imports`,
`--to` or several filters; `covering` by `--file` or `--since`; `story` by
`--name` or `--compare`. So each entry is keyed by the flags that ask it. It
holds its `need`; whether it is an operation; the skill
reference the need routes to, where it has one; and its edges, each with its
destination need, its tool and its argument bindings. The tables above are what those
entries hold.

1. The entries as a required, non-empty field on each `ask` tool's definition,
   read by the catalogue the way it reads a tool's name and flags, and on the
   record beside the top-level command table. A command with no entry does
   not compile.
2. The test over them: every need an edge opens is some entry's need, or a gap
   marked with `it.todo`.
3. Moves on `symbol`, `uses`, `covering` and `select`, the tracer, after 0104's
   answer object gives each its answer type, since a move binds to its fields. Each one's
   builder takes the entry the asked flags select and instantiates its edges
   from the answer, by the rules under A move, into tools and inputs.
   - Every move is spelled by `spellingOf` and laid out by `narrower`, which
     moves beside it in `@variance-authority/mcp/tools` so `packages/cli`
     reaches it. For `covering` and `select`, only the builder sits beside the
     command's formatter in `packages/cli`, next to the evidence gap it leaves
     alone. `select`'s stdout is substituted into a runner's arguments and
     carries skip data alone, so its moves go to stderr beside its notes and
     into a field of its `json` format, never to stdout.
   - `orient`'s `followUps`, which write `variance ask …` by hand on every
     surface, and the hints `discover`, `grep`, `intersection` and
     `slowest-tests` spell today move onto the same path, after the tracer.
   - Each builder gets a decision test, written to fail first, with cases
     written apart from the edges: one declaration, two packages declaring one
     name, an answer with no importer, an answer with no field.
   - Each command gets an acceptance test that asks every move it prints and
     reads the answer. The move is parsed by `asking.ts`'s own parser and asked
     in process; one case per surface spawns the CLI. The move's command must
     answer cleanly, and about the thing the move names.
   - The source moves run on `ask-acceptance.fixture.ts`. `covering` and
     `select` run on the recorded checkouts their own tests already build.
   - `symbol`'s sentence naming `uses` gives way to the move.
4. The skill's routing table generated from the entries, with a `--write` mode
   and a check that fails when the committed skill's routing drifts from them.
   A row is keyed by the reference an entry names, as the table is today, and
   the generated column is the commands of the needs that route there.
   `tools/docs-cli.check.ts` already holds every command the skill spells
   against `usage.ts`, so the new check holds only the routing. The "choose the next question" sections of `docs/` link to the
   skill's table instead of repeating it.
5. The remaining commands, each with a fixture that holds the evidence its
   answer reads. Then the gaps above, each a need with its own contract.
