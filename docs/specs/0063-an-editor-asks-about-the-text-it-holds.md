# Spec 0063 — an editor asks about the text it holds

**Missing:** a reader an editor keeps open, which answers **everything the
record knows** about the text in the editor's buffer, line by line. Today the
record's facts are spread across seven commands, and each answers one of them:

- `covering` answers which cases walked a line.
- `select` and `run --since` answer what an edit is and which tests it reaches.
- `journeys` answers where the observers parted.
- `report` answers what a component's pixels did and why.
- `distill` answers what a test looked at.

Each command starts a process per question, answers in the line numbers of the
text the suite ran over, and never checks that the text is still that text.
An editor that wants to show all of this on every file open would have to
start seven processes and join their answers itself.
**Built on:** `coveringTestsInFile` and `coveringChange` in
`packages/sense/src/test-selection/reverse.ts`, `frameOf` in
`packages/sense/src/test-selection/frame.ts`, `placeInText` in
`packages/sense/src/test-selection/placed.ts`, `stateOf` in
`packages/sense/src/test-selection/range-state.ts`, the one-shot
`covering --file --text` in `packages/cli/src/commands/covering-frame.ts`, the change reading in
`packages/sense/src/test-selection/reading.ts`, the selection causes in
`packages/sense/src/test-selection/select.ts`, `journeyDivergences` in
`packages/sense/src/test-selection/divergence.ts`, the region and finding
records in `packages/report/src/`, and
[0049](0049-nothing-can-ask-the-record-where-it-stands.md) (the question
surface).
**Callers:** [0064](0064-the-record-in-vs-code.md),
[0065](0065-the-record-in-webstorm.md) and
[0068](0068-an-edit-runs-what-it-reaches-from-the-editor.md).

## Purpose

Wallaby sets the bar: open a file and every line already says what happened to
it. Wallaby gets there by owning the test run and instrumenting it for values.
We get there by joining what the record already holds, and the record holds
things Wallaby does not:

- which *case* entered a region, not only that some test did;
- the case that entered it only while the module loaded;
- the region one case alone stands behind;
- the regions where observers of one subject parted;
- what an edit is (bodies, values or load effects) before any test runs;
- which tests the edit reaches, how many imports away, and why;
- the pixels a component's source line moved, the finding standing on it, and
  that subject's flake and churn history.

The editor surfaces must not rebuild any of these joins. If one plugin in Kotlin
and one in TypeScript each join seven readings, they disagree within a release,
and the painted lines are the input someone uses to delete a test. So the join
is done once, in sense, and each fact is carried as the stage that produced it
wrote it (ADR-0069).

## What would discharge it

**1. One long-lived reader, started from the workspace's own install.**
`variance lens --stdio` reads one JSON request per line and writes one JSON
reply per line. The editor starts it from the project's
`node_modules/.bin/variance`, never from a copy bundled with the plugin. The
recorder and the reader then come from one install and one version, and a
version gap ([0045](0045-a-snapshot-states-its-own-age.md)) is refused by the
reader rather than decoded wrong. When there is no install, the plugin paints
nothing and says why. The reader keeps the snapshot, the cases sidecar and the
last report open between questions, so a file answer is a point read
([ADR-0061](../context/adr/0061-a-crossing-relation-is-interned-not-owned.md)),
not a process start.

`lens` is a loop around the functions the existing commands already call.
`covering --file --format json` becomes one facet of `lens --file --format json`,
so the two spellings cannot drift.

**2. The request carries the buffer.**

```jsonc
// request
{ "id": 7, "file": "src/cart/total.ts", "text": "…the buffer…" }
```

`placeInText` already decides the frame (`recorded`, `mapped` or `stale`), and
the one-shot `covering --file --text -` already carries every range through it
with `moved` on the ones an edit touched. The reader passes `text` to the same
function and frames every other line-keyed facet through the same placement:
`failures`, `components` and `change`. Without `text`, it frames the file on
disk.

**3. The reply is the facets, each present only when its source is.**

```jsonc
{ "id": 7, "frame": "mapped", "at": "03984ae78218", "recordedAt": "2026-09-24T18:02:11Z",
  "ranges": [ { "startLine": 12, "endLine": 19, "kind": "function", "state": "alone", "mark": "failing",
                "tests": [ { "id": "t41", "outcome": "fail" } ],
                "parted": { "entered": 3, "missed": 1 } } ],
  "moved": [ { "startLine": 21, "endLine": 24 } ],
  "change": { "reading": "values", "names": ["total"], "reaches": [ { "id": "t41", "distance": 0, "cause": "region" } ] },
  "failures": [ { "line": 16, "test": "t41", "message": "expected 90 to be 100" } ],
  "components": [ { "name": "CartTotal", "line": 30, "verdict": "changed", "finding": "…",
                    "history": { "flakiness": { "runs": 40, "rate": 0.05 } } } ],
  "tests": { "t41": { "file": "src/cart/total.test.ts", "name": "applies a discount", "line": 8,
                      "outcome": "fail", "durationMs": 14 } } }
```

| facet | from | present when |
|---|---|---|
| `ranges[].state`: `walked` / `alone` / `loaded` / `unwalked` / `hole` | the cases sidecar, with each case's `stopped` (0067) | the file is recorded |
| `ranges[].tests[].outcome` | [0067](0067-a-case-carries-its-outcome.md) | the recording carried outcomes |
| `ranges[].parted` | journey divergence | journeys were recorded |
| `change` | the reading and the selection causes | the buffer differs from the recorded text |
| `failures` | 0067's source frame of a failing case | a case failed on a line of this file |
| `components` | the report's region and finding records, and history | a report exists and names this file |
| `tests` | the cases sidecar, 0067 | always, for the tests named above |
| `tests[].attention` | the Eyes archive and `distill` | the file is a test file and Eyes watched it: the queries that resolved absent or threw, and the phases addressed but never entered |

`state` is `hole` or `unwalked` only where the reader could tell them apart,
through each range's `stopped` list from `coveringTestsInFile` (0067 item 0).
Where it could not (a stopped case, and no file graph that holds the module),
the range has no `state`, and the mark falls to the next row that applies.
A hole's hover lists the cases that stopped before reaching it. A range whose
witnesses are named beside a stopped case is `walked`, never `alone`.

When a source is not configured or not recorded, its facet is **left out**. It
is never `[]` and never zero
([ADR-0002](../context/adr/0002-observation-profiles.md)). A line in no recorded
region has no range. A file the record does not hold gets `recorded: false`. A
test is referred to by the record's own id everywhere, and its detail appears
once, under `tests`.

**4. The reader says when anything it read moves.** It watches the snapshot, the
sidecar and the report. When a run replaces one of them, it writes an unsolicited
`{"changed": ["cases"], "at": "…"}`, and the editor asks again for the files it
has open. A reader running under the session daemon
([0056](0056-a-session-daemon-keeps-the-index-current.md)) gets the signal from
the daemon instead.

**5. A test carries the line it is declared on.** `ExecutionTest` holds a file
and a name. The seams already know the line: Vitest reports a task location, and
the other hosts' registrars are wrapped where each case is declared. The case
axis records it, so an editor can open a witness at its `it` line and put a
test's own facts on it.

**6. One vocabulary for every editor.** Each range's state, outcome and marks
reduce to exactly one gutter mark, chosen by the first row that applies. The
reader returns it as `mark`, so the two editors cannot rank the rows
differently. `stateOf` already ranks the last five rows, and the one-shot
`covering` answers carry the result as `state`; `mark` is that rank with the
outcome, journey and selection rows above it:

| mark | when | Wallaby's nearest |
|---|---|---|
| `failure` | a failing case's top in-checkout frame is on this line | pink: error source |
| `failing` | at least one case that walked the range failed | red: on a failing test's path |
| `queued` | a running selection ([0068](0068-an-edit-runs-what-it-reaches-from-the-editor.md)) has not reached the range's cases yet | none |
| `moved` | an edit touched the range since the recording | none |
| `hole` | no case entered it, and a case that could have reached it stopped first (failed, threw, timed out, or was retried or quarantined by CI) | none |
| `parted` | observers of one subject that all finished disagreed on entering it | yellow: partly covered |
| `alone` | exactly one case walked it, it passed, and no case that could have reached it stopped | none |
| `walked` | two or more cases walked it, all passed | green |
| `loaded` | the only entry was while the module evaluated | none |
| `unwalked` | recorded, no case entered it, and every case that could have reached it finished | white: not covered |

A mark differs from its neighbours in shape as well as in colour. A line with no
range has no mark. The hover of any mark lists its cases with outcome and
duration, called-in before loaded-only, and each one opens at its declaration
line.

**7. The cost is gated on counts.** One file answer decodes one module's
regions, one pool run per region, and one report slice. The gate is bytes
decoded per answer against the size of what is open, on the
seven-Material-UI corpus. It is not a millisecond figure, which would gate on
the machine.

## What it deliberately does not do

- **It does not record values.** Wallaby's value explorer and inline
  `console.log` values come from instrumenting what product code computes. The
  record holds the places a case visited, never what it computed there
  ([ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md)). This is a
  position, and a runtime value that reaches an editor would have to come from
  the runner's own reporter, as a case's output does in 0067.
- **It does not re-record, and it does not guess.** An edited region is `moved`
  until a run records it. [0068](0068-an-edit-runs-what-it-reaches-from-the-editor.md)
  is the run.
