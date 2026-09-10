# Everything an agent can ask

A run writes down what it saw and stops. An agent then reads a file. No page
opens, no screenshot is taken and no test reruns while a question is answered,
because the answer was paid for when the run wrote the report. This chapter is
the whole of what can be asked, where each answer comes from, and which of the
three entrances to ask it through.

## One list, three entrances

The questions are read off the MCP tools themselves, so the three ways of
asking cannot differ by one:

- **The `variance-authority` skill.** [Install it in
  Codex](agent-cli.md#point-an-agent-at-it), then it routes an agent through the
  questions in the order below without client configuration.
- **A shell.** `variance ask <question>` calls the same functions an MCP
  connection calls and prints the same text. It is what a CI job or a sandboxed
  agent uses: [ask a run from the command line](agent-cli.md).
- **A connection.** Each question is a `variance_*` tool over MCP, and a
  connection also serves the domains a producing integration holds:
  [question retained evidence over MCP](agent-mcp.md).

```bash
npx variance ask
```

With no question, that prints the list: each question, the arguments it
takes, and what it answers. It reads no configuration, so it works before a run
exists.

## What the run wrote down

Every answer below is a reading of the report, and the report is what the run
committed to paper per subject, where a subject is one state of one component or
page the run observed:

- **The verdict and its evidence.** Which band moved, which region, which
  component owns it and which source line rendered it:
  [attribution](attribution.md).
- **The composition.** Which components the subject is made of, who mounted
  whom, and which renderings recur across subjects: [composition](composition.md).
- **The lexicon.** Every name the subject carries, per field: its id, the
  component it is the example of, accessible names and visible text, components
  and their creators, files, roles, design tokens, and the code regions its
  journey entered. This is what a description is searched against:
  [the subject you can only describe](composition.md#the-subject-in-hand-and-the-one-you-can-only-describe).
- **The journey.** Which code regions ran while the subject rendered, and where
  two subjects parted: [journeys](journeys.md).
- **Findings.** Defects in the render itself, with no baseline involved:
  accessibility, content and layout rules.

A field the run could not fill is named as absent in the answer, never printed
as an empty match. A report from a tier that composed nothing says so when
asked about composition.

## Arrive

The first question is rarely about a subject id, because an agent arrives with
a description. `locate` matches the words of a query against the lexicon and
prints, for each hit, the field the word matched in:

```
2 of 3 subject(s) match `button label`.
Read: id, example, names, text, components, createdBy, regions, files, roles, tokens.

card/compact · 2 boundaries · example of Card
  button: components `Button`; roles `button`
card/summary · 3 boundaries · example of Card
  button: components `Button`; roles `button`

`label` occurs in no field that was read. The names this run did record:
  Save

next: variance_composition {subject: "card/compact"} · variance_describe {subject: "card/compact"}
```

The order is orientation, not a finding: a wrong first hit costs one more
question. A word that occurs nowhere is said so, with the names the run did
record, so the next query uses the suite's vocabulary rather than the agent's.
The search runs over an inverted index built once from the report; the page the
names came from is not open and is not needed.

From a hit, `composition` with a subject prints what the subject is made of,
and `describe` prints everything known about it: the ranked regions, the
component each belongs to, where it is on the page in words, the file to edit,
and the fingerprint an accept or an ignore rule is keyed on.

## Review

For a run that changed something, the order is the one the skill follows:

1. `summary` counts verdicts, lists the subjects that need attention, and
   lists the subjects that were planned and never observed. Unobserved is not
   unchanged.
2. `changes` groups the changed subjects under the distinct changes behind
   them, most decidable first. A token edit that reached forty stories is one
   decision.
3. `composition` names what explains a movement and separates a subject read
   twice that differed from one never read twice. `variations` covers the
   subjects measured against another subject rather than a baseline: a flag's
   other value, a second viewport, a dark scheme.
4. `describe`, `explain-verdict`, `trace-component` and `findings` narrow to
   one subject or one component once it is known which one matters.
   `explain-verdict` says why a subject was not compared, which is never a
   code problem.
5. `changelog` previews what accepting would write into the baseline record,
   and which subjects would be refused. It is the last question before an
   accept, never one after.

`diff` compares the current report with the one the previous successful
question was answered from, which is how a rerun's effect is read.

## Declare, then read

An agent that made the edit declares it before reading the diff. `adjudicate`
takes claims, each naming the component or shape, why, and at most how many
subjects it should reach, and answers three ways: declared and delivered,
moved but undeclared, and declared but never happened. The third answer is how
an edit that did not land is found, and no comparison of images produces it.
Claims copied out of `changes` score the run against itself and are worth
nothing.

## While the suite runs

A finished run left a file. A suite in flight has not, so its questions go to
a watcher the suite reports to, over the same shell or over MCP with `--watch`:

- `self` says where the watcher listens, whether a run has reported yet, and
  exactly what to start the suite with. Ask it first, and again when an answer
  is emptier than expected.
- `run-signals` lists every test that has reported, its state, and how much it
  has announced. `test-signals` replays one test in order, with the realm that
  said each line, plus the work that started and never ended.
- `diff` over a watcher compares with the previous reading.

The instrumentation, the ordering rule and what the answers may be read to mean
are in [inspect a live run](agent-live-run.md). Stop the watcher and this state
is gone; none of it becomes retained evidence.

## Beyond the run

Two more surfaces answer over MCP and are not about a run at all. A workspace's
public API, where a symbol is declared and who imports it, is read from
manifests and current TypeScript source:
[inspect the workspace public API](agent-workspace-api.md). Evidence a
producer holds, such as source execution indexes, test-attention archives,
presentation reports and scenario archives, is served by that producer's own
connection and inventoried by `observability` before any of it is asked.

## What no question does

No question runs a test, rerenders a subject, approves a baseline or edits a
file. An answer that could settle a reviewed change carries the exact CLI
command as text and leaves running it to the owner of the review loop.
Evidence the run was never supplied with is absent in the answer, and absent is
never read as zero.
