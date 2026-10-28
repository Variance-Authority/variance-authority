# Follow the reasoning loop

You already have visual regression covered — `toHaveScreenshot`, Chromatic,
Percy, `jest-image-snapshot` — and the question you bring to a red build is
rarely *did these pixels change*. It is which tests this edit could affect, whether
the change on screen is the change somebody authored, or why one state keeps
disagreeing with itself. [Variance Authority](README.md) answers those from
different readings — a parse of the source, a completed run report, a
[record of what each test covered](test-level-coverage.md), a suite still running — and asking the wrong
one pays for a full suite render to get an answer a source reading already had.
This page is how you pick the reading before you pay for it.

## Start from the decision, not the tool

A [**subject**](information.md#things-a-run-addresses) is one named UI state a run captures and compares against its
approved baseline — a Storybook story, a route at a viewport, a component
mounted in a test. Which reading you need depends on the decision, not on what
renders those subjects.

| The decision in front of you | What answers it | Command |
| --- | --- | --- |
| Which test files can this diff not have reached? | The recorded execution journal, checked against the diff | `variance select --since origin/main` |
| Which tests went through this line, nearest first? | The regions each named test case covered | `variance covering --file <path> --line <n>` |
| Which changed regions does a test already cover, and which does none? | The same coverage record, read against the diff | `variance covering --since origin/main` |
| Where did two subjects take different paths through the same module? | Each subject's [journey](understand-execution.md#start-here-which-part-of-a-module-two-subjects-took-differently): the regions it covered while its state was painted | `variance journeys` |
| Which subjects are worth rendering this run? | Source reach, what each subject was last seen rendering, and the [execution index](execution-record.md) | `variance run --since origin/main` |
| What changed, and is it one cause or many? | The completed run report | `variance ask summary`, then `variance ask changes` |
| Is this subject changing, or disagreeing with itself? | Every subject read twice in the same run | `variance run --flakes` |
| What is this test actually exercising? | Attention markers joined to the source that execution covered | `variance distill --test <id>` |
| An answer ended with a gap: what runs next? | [The gap's reason and the run that closes it](#fast-smart-deep) | the commands the gap prints |

`select` is the one written for a runner this tool never drives — a plain
`vitest`, a `jest`, a CI shell script. It emits a skip list of test files and
never a run list: a test the journal has never recorded is absent from it and
stays in the suite. It reads no project configuration, and with no recording it
skips nothing and prints that on stderr.

`run --flakes` reads every subject twice instead of only the ones a comparison
already called `changed`, and exits `1` even when every verdict is green.

A first pass through the loop is three commands:

```bash
variance run --since origin/main
variance ask summary
variance ask changes
```

`variance ask` with no question prints every question the last run and a live
watcher can answer, and the arguments each takes.

## The loop behind those commands

**Name the outcome → frame the variance → choose an eye and a [vantage](vantage.md) → sense
or instrument → read the evidence → act or step back.**

The path can be short. One reading may answer the question. It can also reveal
a better question or show that another point of observation is needed.

## Why — name the outcome

The outcome is the decision or action the work must support: which tests to
run, whether a change is authorized, where two executions parted, what an
interface communicates, or whether an agent knows enough to edit a file.

Naming it separates useful work from work that merely happens to be available.
“Compare every screenshot” may become “find the subjects this edit could
affect.” “Approve this image” may become “explain the cause shared by these
changes.” The more precise question usually needs less machinery.

## How — sense what remains; instrument what disappears

Some evidence already exists in source, artifacts, retained history, or a
running system. Read it where it is. Other evidence disappears with the
process that produced it. Instrument that moment and retain the answer.

Neither mode is better in general. The question decides whether a source
index, a browser observer, an execution trace, a comparison, or an existing
external system should answer it. [Instruments](instruments.md) names the
reading behind each product claim and where it stops.

## What — choose an eye and a vantage

An **eye** is the capability that can make the relevant distinction: source
reach, accessibility, component [provenance](attribution.md), pixels, runtime work, presentation
relationships, or another observation. A **vantage** is where and under which
conditions that eye reads: committed source, a live page, one execution, two
runs, or retained history.

[Eyes](eyes.md) shows how a test's attention reads the React tree.
[Vantage](vantage.md) shows what a live or unfinished run can reveal. They are
examples of the choice, not mandatory stages. The same eye from another vantage
may answer a different question; the same vantage with another eye may expose a
different kind of variance.

## Result — make the decision the evidence supports

Evidence supports only the question it answered. It may help approve a change,
select work, attribute a cause, guide an investigation, or show that another
observation is needed. The result names its subject, conditions, provenance,
and boundary so the next person can understand why it is useful.

The goal is enough confidence for one defensible decision, with no claim about
the parts of the codebase that were not observed.
[Information model](information.md) defines how the question and its boundaries
survive in retained evidence. [Metrics](metrics.md) defines the population and
denominator behind every measured claim.

## When the evidence stops, choose the next question

An unavailable reading is absent, never an empty result. A first observation is
`new`, not unchanged. Evidence produced under different conditions names the
condition that moved as its cause. A capability that did not observe a band reports
it as unobserved rather than silently clearing it.

When the evidence cannot support the intended decision, the next step is one of:

- narrow the claim to what was observed;
- widen the observation;
- choose another eye or vantage;
- ask the person or system that owns the missing decision; or
- leave the conclusion open.

An open conclusion is still useful when it names what is missing. It keeps the
current answer trustworthy and turns the missing observation into the next
explicit question.

### Fast, Smart, Deep

Ask that next question at the cheapest reading that can answer it. The readings
fall into three gears, Fast, Smart and Deep, FSD for short:

- **Fast** reads what is known without a run: the diff, the source and the
  [source index](source-index.md), through `variance ask` and `variance select`.
- **Smart** reads what a run recorded, through `variance covering`: which cases
  ran which lines, at which commit, and what the last runs found.
- **Deep** reads [one case's story](test-stories.md), through `variance story`:
  the functions it called, in order, and the branches it took. It runs on the
  nearest of the tests Smart already named, at most three, never on a suite:
  `covering` lists the nearest test files first, and a story records every step
  of each test it runs.

`variance covering` ends an answer that leaves its question open with that next
question, a gap: what stays open, what is known, why, the run that closes it
with the commands that run as printed, and, when a record counts it, how many
tests in how many test files it takes. The reason in parentheses is
one of three:

- `absent`: no run of the suite is recorded;
- `stale`: the record was made over a different version of the file than the
  one you have checked out, or before the file existed;
- `coarse`: the record holds the line only at file grain, so it knows which
  tests loaded the file but not which of them ran the line.

An `absent` gap and a `stale` one name a recorded run:

```text
Gap (absent) on src/total.ts: which tests ran it. Known: no run is recorded.
Next, Record, at a cost no record counts:
  Wire the suite's producer and record one run of it: that first run is the record.
```

```text
Gap (stale) on lines 2-3 of src/cart.ts: which tests run it now. Known: line 3 was written since the recording.
Next, Record, 1 test in 1 test file:
  Run with the suite's own runner: a.test.ts
```

A `coarse` gap names Deep:

```text
Gap (coarse) on line 20 of src/ledger.ts: which of the nearest 3 ran it, and in what order. Known: 4 named tests loaded src/ledger.ts, and 1 past the nearest 3 stays unread.
Next, Deep, 3 tests in 2 test files:
  Run each case with the suite's own runner under VARIANCE_AUTHORITY_STORY=1, filtered by its name as a regular expression (-t; --grep under Playwright):
    ledger.test.ts  'finds the user'\''s entry'
    ledger.test.ts  'records an entry'
    book.test.ts  'opens a book \(draft\)'
  variance story --file ledger.test.ts --name 'finds the user'\''s entry'
  variance story --file ledger.test.ts --name 'records an entry'
  variance story --file book.test.ts --name 'opens a book (draft)'
```

You run the three cases with your runner, and each `variance story` then reads
the story that run recorded. An answer with nothing open ends without a gap.

**Record is not a fourth gear.** It is the remedy when the record Smart reads
cannot answer, because it is `absent` or `stale`. A deeper reading does not help
then; a recorded run of what the gap names does, and the whole suite over a record
that exists only when selection runs it. Run the files under the suite's recording
producer, the wrapped runner configuration [test-level coverage](test-level-coverage.md#the-process)
sets up, so the run refreshes the record; a run without it leaves the gap
where it was:

- **No record of the suite**: `variance share --suite <name>` fetches the
  mainline's record when the root config gives the suite `"carry": "share"`.
  Otherwise wire the suite's producer and record one run: that first run is
  the record.
- **Lines written since the recording, in a file the record holds**: run the
  test files the gap names: the ones `variance select` runs for the file under
  the suite's own `relations`, `ignore` and `before`.
- **A file the record is older than**, so a new file: run the recorded test
  files `variance select` runs for it by reach. `variance reach --since
  <commit>`, from the commit the record was made at, then takes every file
  added since, the new test files no record
  names among them, with no record needed.

Run Deep only on a gap that names it, skip a gear only when its record cannot
have the answer, and check a finding at the cheapest gear that could prove it
wrong: a path a story shows against `variance covering`, a selection against
the diff.
