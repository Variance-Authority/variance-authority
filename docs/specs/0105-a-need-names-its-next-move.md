# Spec 0105 — a need names its next move

**Missing:** two things that today live only in prose. The first is a
catalogue: for each thing an agent needs while it works on a change, the
commands that answer it and the needs its answer can open. The second is the
binding: how one answer's facts become the arguments of the next question. The
routing is written apart in the skill's "Open the reference for the question"
table, in the `Narrower questions` footer `narrower` lays out, and in a
"choose the next question" section in four pages of `docs/`. None of it is
checked against the commands.
Next questions are spelled in four ways, and nothing says which of them a need
should get. `orient`, `packages` and `entrypoint` end with a footer built from
their reading: `orient` names `ask uses`, `ask symbol` and `covering --file`,
and `entrypoint` names `ask uses`, `ask packages` and itself narrowed to one
package. `symbol` and `uses` name each other through `spellingOf`; `uses` names
itself narrowed to one file, and `discover --imports` for a name from outside
the workspace. Many more write one by hand: `search` names `ask orient --files`,
the run report's header `run --since`, the review handover `covering --file`,
the unstable-subject comment and `ask composition` `run --flakes`, `ask changes`
and the report, the comment and the tribunal `accept --shape`, `ask waiting`
`variance_continue`, `ask summary` `variance_locate`, and others, each in the
shell's spelling or the wire's whatever surface reads it. And a remedy for a
missing record — `covering`'s evidence gap, the probes gap, "run
`variance index`" — names the run that closes it. The complete set is what the
spelling check below finds, not a list kept by hand. A hint that asks the same
question wider, `--limit` through `limitOf`, is the answer's own paging, not a
next question. Nothing tells a need with no command apart from a command no need
calls.
**Built on:** the `variance ask` catalogue, which reads each question's facts
off its tool's definition, the `Tool` of `packages/mcp/src/tools/tool.ts`; the
top-level command table; `spelling.ts` in the same directory, the one place an
answer spells what to ask next for the surface it was asked on; the `followUps`
that `orient`, `packages` and `entrypoint` build from their reading; the
evidence gap of `evidence-gap.ts`; and the skill
in `packages/cli/skills/variance-authority/`.
**Held by:** the compiler, for a command or MCP tool with no entry, for an
edge into an entry that does not exist, and for a binding or a condition that
reads a field its entry's answer type does not hold; a check that no answer
spells a question outside `spellingOf`; a check that the generated skill matches
its source; and, per command, a decision test of its builder and an acceptance
test that asks each printed move and reads its answer.

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
packages*, so `uses` is a question worth asking. It is never a procedure. In
one experiment a generic test-first instruction did not stop an agent's
destructive patches, while the tests a change was likely to break went with
much less breakage
([TDAD](../context/prior-art.md#codebase-orientation-for-agents)). Hypermedia
controls and git's `hint:` lines do the same thing for other readers: the
response names what can follow from it. The catalogue names what can be asked
next, not what must be.

## A move

An edge names the entry it opens — the declared entry itself, never its need
written out, so deleting the entry or its command fails the build as it does for
a hint today — and, for each argument the entry's command takes, the answer
field that supplies it. The entry already holds its need and its command, so an
edge states neither again. A move is that command, its input, and the context
the answer was asked in: the report paths, or the watcher address `--at` named.
The context is carried unchanged, since the tool's input does not hold it, in
one optional field of `ToolInvocation` that the host fills and `spellingOf`
alone reads, so a builder never sees it. In a
shell `spellingOf` spells it with the input: a `describe --subject` move from
`ask changes /tmp/run-a.json` asks of `/tmp/run-a.json`, not of the configured
report. Over MCP a server answers of the subject it was started on, so the
context is the server's and the move names none.

The context is the evidence the move asks of, carried as data on every surface;
each surface decides how to address it. A shell spells it, so a move asks of
the report it was printed from wherever it is pasted. Over MCP the tool input
has no place for it: a move asks of the server it is sent to, and a move
printed by one server and sent to another answers of the second's evidence.
That is a position, not an oversight. A move is for the session that printed
it, and refusing it elsewhere would put the scope in every tool's input to
guard a reuse nobody makes.

A binding is checked against a type. `Tool.run` returns text today, so an entry
declares the answer it is computed from: the tool computes a value of its
answer type, and `run` formats that value. An edge is declared over that type,
each binding a function from the answer to the argument it fills, so a binding
that reads a field the answer does not hold fails the build. A command gets its
answer type in the step that gives it an entry, the commands outside
[0104](0104-the-four-code-questions.md) as much as its four; for those four,
0104's answer object is that type.

A field is a value the answer holds, or an input it was asked with and echoes,
such as the ref `--since` named. A field names one thing of a stated kind: a
declaration, as its name, its package and its file; a file; a test case, as a
file and a case name; a subject id; a ref. The kind of the edge's arguments is
the kind of thing the move asks about.

| The answer holds | The move |
|---|---|
| the field the edge needs, once | one move |
| it for several things | one move per thing the answer shows, in its order and within its `limitOf` bound |
| things counted past that bound | no move of their own; the answer's paging asks the same question again with its filters and a wider bound, and that answer prints their moves |
| several things the command's arguments cannot tell apart | one move that asks about all of them, saying so |
| no value for the field | no move |
| a value the edge's condition rejects | no move |

So `symbol` that finds `Coverage` declared in two files prints two `uses`
moves, each with its `--package` and `--file`, whether the files share a
package or not. `uses` that lists fifty importers prints no fifty `covering`
moves: its edge into `covering --file` binds the declaration's file, so it
prints one per declaration. A move never picks one of several
candidates for the agent. Paging is the source question's, not a move's: past
the bound the answer neither names the rest one by one nor asks of them as a
group, and the moves for the rest come with the answer that shows them.

The last row is the edge's condition, a predicate over the answer type declared
with the edge, so two builders cannot read one edge two ways. An edge with none
is printed when its fields are present. `symbol` that finds no declaration opens
no `uses`, since the field is absent; `changes` with nothing changed opens no
`describe`, since its condition is that something changed. An edge into other
evidence, from the source index to a recording, is printed when its field is
present, since whether a record exists is not the source answer's to know; the
destination answers an absent record with its own gap.

An entry may open itself, narrowed: `entrypoint` over every package names
itself with one `--package`, and `uses` over several declarations names itself
with one `--file`. That is an edge like any other, bound to the field that
narrows it.

A move is spelled for the surface it was printed on. When that surface cannot
answer it, as an MCP host refuses `discover` by imports, the move is spelled
for the surface that can and says where it is asked. It is never dropped
silently.

The catalogue may hold cycles, such as `covering` to `story` to
`ask test-composition` and back to `covering`. A move says what can be asked
from this answer, not whether it was asked before, so moves alone do not end a
walk: two answers can open each other with the same facts forever. The agent
that follows a move knows what it has already asked, and the catalogue keeps no
visited state for it.

### What a move is not

- **An evidence gap.** When an answer cannot be given because a record is
  absent, stale or too coarse, `evidence-gap.ts` owns what follows: the question
  left open, why, the run that closes it and what it costs. A gap is not a move
  to another need. It is the same need, asked again once its evidence exists.
  An answer carries its moves and at most one gap, and the catalogue routes
  neither of them through the other. The gap's remedy is still a command, so
  `spellingOf` spells it as it spells a move.
- **Usage.** When a command is asked without an argument it requires,
  `asking.ts` says what it takes. That is the command's own usage, not a move.

## The catalogue

Each row: the need, the commands that answer it, and the needs its answer can
open. Opens lists the needs of the entries the row's edges name, and an entry
opening its own need is a narrowing of itself. A command marked *operation*
writes a record or a file. Every other command only reads. A flag that changes
how an answer is shown or where it is written, not what it answers, such as
`story --around` or `review --out`, falls under its command's row.

### Before the edit

| Need | Command | Opens |
|---|---|---|
| find the code a task talks about | `ask search --query <words>`, `ask grep --query <words>`, `ask discover --text <pattern>`, each with `[--from <path>]` | know what a name is before touching it; find the part of the repository a task is in, with no word for it yet |
| find the part of the repository a task is in, with no word for it yet | `ask orient`, `ask orient --area <id>`, `ask orient --files <path>` | find the code a task talks about; know what a package publishes and who takes it; know what a name is before touching it; know who breaks if it changes; run something that already exercises this code |
| know what a package publishes and who takes it | `ask packages`, `ask entrypoint --package <name>` | know what a package publishes and who takes it; know what a name is before touching it; know who breaks if it changes |
| know what a name is before touching it | `ask symbol --name <name> [--package <name>]` | know who breaks if it changes |
| know who breaks if it changes | `ask uses --name <name> [--package <name>] [--file <path>]` | know who breaks if it changes; run something that already exercises this code; find the files that take a name from outside the workspace |
| find the files that take a name from outside the workspace | `ask discover --imports <module#name>` | run something that already exercises this code |
| know what rests on a file at any depth | `ask discover --to <path>` | run something that already exercises this code |
| find the files several questions agree on | `ask intersection '<question>' '<question>'`, `ask discover` with several filters | know what a name is before touching it |
| know what a file may already use, and how | `ask stack --from <path>` | — |
| know whether an import I am about to write is allowed | `restrictions`, `layers` | — |
| know how much of a part of the repository tests reach | `coverage --from <dir>`, `coverage --packages` | run something that already exercises this code |
| run something that already exercises this code | `covering --file <path> [--function <f>]`, its MCP twin `variance_source_tests`, `ask journey-map --file <path>` | see what a test actually did here |
| see what a test actually did here | `story --file <test> --name <case>`, `distill --test <id>`; over MCP `variance_distill`, `variance_test_attention`, `variance_scenarios`, `variance_presentations` | know what a test is made of; know what a name is before touching it |
| know what a test is made of | `ask test-composition --file <test>` | run something that already exercises this code |
| know why a case passes on one run and throws on another | `story --file <test> --name <case> --compare outcome` | know what a name is before touching it |
| know what a case did differently from its last run, or from another case | `story --file <test> --name <case> --compare last`, `story … --compare <a>,<b>` | know what a name is before touching it |
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
| know whether my change needs a review, and of what | `review --since <ref>` | run something that already exercises this code |
| know what my change could reach through the source graph | `reach --since <ref>` | know which recorded tests entered what my change touched |
| know which recorded tests entered what my change touched | `covering --since <ref>`, its MCP twin `variance_changed_tests` over a diff | see what a test actually did here |
| know what my change reached that no test checks | `review --since <ref> --coverage` | run something that already exercises this code |
| know what my change did to what users see | `ask summary` over the report of a `run` | know the distinct changes behind what moved; know which subject a description names |
| know the distinct changes behind what moved | `ask changes` | know everything about one subject; settle a change |
| know everything about one subject | `ask describe --subject <id>` | know why a verdict may not be a code problem |
| know why a verdict may not be a code problem | `ask explain-verdict --subject <id>` | — |
| know where a component appears and what it moved | `ask trace-component`, `ask composition` | know everything about one subject; know whether a subject reads the same way twice |
| know whether a subject reads the same way twice | `run --flakes`, an *operation* | know the distinct changes behind what moved |
| know what a flag or theme arm changes | `ask variations` | — |
| know which subject a description names | `ask locate --query <words>` | know everything about one subject |
| know whether the edit did what I meant, by claims declared before reading the diff | `adjudicate`, `ask adjudicate --claims <path>` | know everything about one subject |
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
| know what the suite is doing now | `ask run-signals`, `ask waiting` | know what one running test said; let a test stopped at `variance.observe()` go on |
| know what one running test said | `ask test-signals --test <id>` | — |
| let a test stopped at `variance.observe()` go on | `variance_continue` over MCP, an *operation* | know what the suite is doing now |
| know how the suite's signals read since I last asked | `ask diff` over the watcher | know what one running test said |

### Cost

| Need | Command | Opens |
|---|---|---|
| know which subjects the suite spends its time on | `ask costs` | know everything about one subject |
| know which tests the suite spends its time on | `ask slowest-tests` | know what a test is made of |
| split the run | `shards` | — |

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
| know which journeys a recording holds | `journeys`, `journeys inspect` | see what a test actually did here |
| make the record a question reads | `index`; `run`, which also writes the report `ask summary` reads; `review --from-run`; `journeys` with `finalize`, `stitch` and `combine`; `collect`; `carry save`, `carry restore` — each an *operation* | — |

An evidence gap names its own remedy, a recorded run of named test files or a
`story` of named cases, as `evidence-gap.ts` does today, and so does every
other answer to a missing record, as "run `variance index`" does. The row
above is for an agent that sets a record up on purpose. Every command has an
entry, a producer as much as a question.

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
requires.

A top-level command is not an `ask` tool, and `packages/help`, where `symbol`
and `uses` live, cannot import from `packages/cli`, which imports it. So each
top-level command is declared in `@variance-authority/mcp/tools`, beside
`spellingOf`, with its shell verb and, where it has one, its MCP twin, as
`covering` has `variance_source_tests` and `variance_changed_tests`. Its entries
sit on that declaration. `spellingOf` gains one case: a top-level verb is
spelled with no `ask`, and over MCP it is spelled as its twin, or for the shell
with where it is asked when it has none. `packages/cli` keeps its usage lines
and maps each verb of `COMMANDS` to its declaration in a
`Record<(typeof COMMANDS)[number], …>` in `usage.ts`, as `PER_COMMAND` is held,
so the compiler holds that every verb is declared.

One command can answer several needs: `ask discover` by `--text`, `--imports`,
`--to` or several filters; `covering` by `--file` or `--since`; `story` by
`--name` or `--compare`. So each entry is keyed by the flags that ask it. It
holds its `need`; whether it is an operation; the skill reference the need
routes to, where it has one; and its edges, each with the entry it opens and
its argument bindings. The tables above are what those entries will hold;
once an entry exists, it is the source and its row follows it.

A builder sits beside the formatter of the command it builds for and carries
that file's `// compass:` coordinate. The speller and the layout stay at
`variance-authority.report.agent-surface`.

Each step lands a move an agent sees before the next one starts:

1. `symbol` to `uses`, end to end. Entries as an optional field on those two
   tools, the answer types `run` formats, their builders, and the moves they
   print, so the compiler holds the two edges' bindings from the first step.
   - `narrower` moves beside `spellingOf` in `@variance-authority/mcp/tools`,
     so `packages/cli` reaches it, and lays the moves out.
   - `symbol`'s sentence naming `uses`, and `uses`' narrowing to one file and
     its `discover --imports` line, give way to the moves.
   - Each builder gets a decision test, written to fail first, with cases
     written apart from the edges: one declaration, two files declaring one
     name in one package, two packages declaring it, an answer with no
     importer, an answer with no field, and an answer past its bound, whose
     paging answer prints the moves of the rest.
   - Each command gets an acceptance test on `ask-acceptance.fixture.ts` that
     asks every move it prints and reads the answer. The move is parsed by
     `asking.ts`'s own parser and asked in process; one case per surface spawns
     the CLI. The move's command must answer cleanly, and about the thing the
     move names.
   - The steps after this one wait on the owner's read of real cycles: an
     agent asking a printed move where it would have reread the skill, and
     what the moves cost per answer in tokens.
2. `covering` and `select`, with the top-level declarations they need. Their
   builders sit beside their formatters in `packages/cli`, next to the
   evidence gap they leave alone. `select`'s stdout is substituted into a
   runner's arguments and carries skip data alone, until
   [0098](0098-the-runner-is-handed-its-selection.md) replaces that, so its
   moves go to stderr beside its notes and into a field of its `json` format,
   never to stdout.
   The remedy `evidence-gap.ts` spells by hand, a `story` of named cases, is
   spelled through `spellingOf`'s top-level case, so it reads over MCP too;
   every other gap remedy follows in step 3.
   Their acceptance tests run on the recorded checkouts their own tests
   already build.
3. Every question spelled by hand moves onto the same path. The check that no
   answer spells a question outside `spellingOf` lands first, listing what it
   finds: it reads every string and template literal with oxc for the binary's
   verbs and its MCP tool names, and exempts only `asking.ts`'s usage. Each
   site it lists becomes an edge of its row above — `orient`'s, `packages`' and
   `entrypoint`'s `followUps` among them — and a gap remedy is spelled through
   `spellingOf` with its routing left where it is. Once the list is empty, the
   check fails on any site it finds.
4. Every remaining command gets its entry, each with a fixture that holds the
   evidence its answer reads. An answer asked of one of two reports, or of one
   of two watcher addresses, has its moves answer from that report or that
   watcher. Then the field becomes required and its type a non-empty list, so
   a command with no entry does not compile.
5. The skill's routing table generated from the entries, with a `--write` mode
   and a check that fails when the committed skill's routing drifts from them.
   A row is keyed by the reference an entry names, as the table is today, and
   the generated column is the commands of the needs that route there.
   `tools/docs-cli.check.ts` already holds every command the skill spells
   against `usage.ts`, so the new check holds only the routing. The "choose
   the next question" sections of `docs/` link to the skill's table instead of
   repeating it.
6. None of the gaps above. Each is a spec of its own, the cross-case half of
   the second 0103's; the catalogue marks them, and this spec is done without
   them.
