# Which tests ran this line

`variance covering` is the question to ask before changing a line, and the one
to ask about a test that may no longer be worth keeping. It reads the per-case
execution index and names the tests that ran through a file, a line or a
function. Of the root `variance.config.json` it reads only `suites` and
`cacheRoot`. None of it is a verdict: execution records where a test
went, never why it was worth running.

```bash
variance covering --file src/checkout/total.ts --line 48
variance covering --file src/checkout/total.ts --line 40-60
variance covering --file src/checkout/total.ts --function applyDiscount --format json
variance covering --file src/checkout/total.ts --function Cart   # every recorded method of the class
variance covering --file src/checkout/total.ts                  # per recorded range
variance covering --file src/checkout/total.ts --format refs    # each case once, ranges by number
```

A line or a function is answered per test file first: `total.test.ts — 2/3`
means two of that file's three cases ran through it, and the cases follow.

A line lands on the regions an edit to it charges, the same ones `variance
select` reads, so the list is what a selection over your edit would run.
`--line <a>-<b>` asks a run of lines and lands on every region one of them is
charged to. `--function` takes the name the record writes for a function,
`Cart/total` for a method, or a scope that holds recorded functions: `Cart`
answers every case that entered one of its methods. A name nothing recorded is
under is refused with the names the file has; a constant or a type has no region
of its own, so ask about its lines instead.

When some case entered the function, the answer also names the outermost parts
of it no case ran — a branch no case took, a nested function no case called —
under `No case ran a part of it`, as `unrun` in JSON (`kind`, the nested
`name`, held-text lines, and `state`, `hole` or `unwalked`, when the record
can tell) and `; no case ran 112 branch` in refs. They are read over every
case, before `--where` or `--at-distance`, across the whole function, with the
review's own reading, in each suite: a function the handover flags is answered
here with the part to test.

The record holds a line no finer than its region does. A line whose edit
charges the module's own region is held at file grain: a module-level
statement, and the first or last line of a top-level function, which an edit
charges to the module too. Its cases are the ones that loaded the file, and the
answer says so with `At file grain`, `grain: "file"` under `--format json`. In
a run of lines, the lines held at file grain are named in `fileGrain`, and the
lines no region holds, such as imports, types or blank lines, in `outside`.
Which of the cases that loaded the file ran the line is then open, and the
answer ends with a Deep gap: the story of its first three tests, in the order
the answer lists them ([Fast, Smart, Deep](fsd.md)). A whole-file answer asks of
no line, so it ends with no Deep gap: ask `--line` on the range you mean.
Lines of a run your edit wrote are named in `written` and left out; when your
edit wrote every line asked, the answer says that no case has run them. When
no line asked is in a recorded region, the answer names no case and says, for
each line, whether your edit wrote it or no region holds it.

- `--hops` puts each test file's import hops beside it and sorts nearest first.
  It needs `--line` or `--function`, and a run of lines or any `--function` is
  measured from the file. It is refused with `--since`, and costs a scan of the
  tree, so ask for it when the list is long, not on every edit.
- `--cases last` answers from the cases the last run recorded; `--cases <test
  file>` from the ones that test file declares.
- `--where <name>[=<value>]` keeps the cases that recorded that precondition
  with `variancePrecondition`. Reading the state each case ran under and a record
  that holds no preconditions is in [case preconditions](case-preconditions.md).
- `--format refs` numbers each case once in a table at the end and names every
  range's cases by those numbers, so a module whose eleven cases all run it
  costs one table, not eleven names per range. It is the shortest answer to hand
  another agent.

```bash
variance covering --file src/checkout/total.ts --line 48 --hops
variance covering --file src/checkout/total.ts --line 48 --cases last
```

The index is read from where a recorded run writes it, so `--file` is usually
the whole command. `--execution <path>` names an index recorded elsewhere, and
`--root <path>` the project root it was recorded against. Producing the index is
in [producers](producers.md).

When the root config declares `suites`, the question is asked of each suite's
record, and the answer is one block per suite, headed `<suite> (<kind>):`,
nearest kind first: unit, integration, e2e, visual. Once any suite answers, the
answers come first, then any suite with no recording yet. A suite whose record
was made at a commit that did not hold the file says so in full, with that
commit, refused as `older` under `--format json`: the record is older than the
file, so the file is new, and its gap names the recorded test files `variance
select` runs for it, then `variance reach --since <commit>` from that commit,
which takes every file added since, new test files among them
([Fast, Smart, Deep](fsd.md)). When git cannot read that commit
— a shallow clone — the suite says so instead of claiming either. Suites that
never loaded the file are named together on the last line,
`Not loaded by <suite> (<kind>): …`: no answer from them, which is not *no test
covers it*. When no suite answers, each block says why in full, with the record
it read, since a wrong path is then the likely cause. The record names files
from the repository root; `--file` takes that path, or an absolute one inside
the root. A refusal names the asked path and no other: a recorded path that
shares its name, or ends in it, is a different file. The `--cases` refusal for a
test file the index holds no case of reads the same. `--format refs` answers the
same way.
`--suite <name>` reads one suite's record alone, so gives its refusal in full,
and is refused beside `--execution`. Under `--format json` the answer is
`{"file": …, "suites": [...]}`, with `since` in place of `file` for a diff. Each
entry is that suite's answer with `suite` and `kind` added, or `{suite, kind,
refused, reason}` for a suite that could not answer, with its `gap` when a
recorded run would answer it.

A module the run loaded without instrumenting it has no recorded line, and is
not refused: the answer is `preconditionOf`, every test file that loaded it, and
no case. Those are the files `variance select` selects on a change to it, whole.
`--line` and `--function` get the same answer, since no line of it was measured.

## Nothing recorded is refused, not empty

An empty list reads as *no test covers this line*, so a missing index is
refused: exit `2`, and under `--format json` stdout is
`{"refused":"unrecorded","gap":{…}}`, which separates *nothing recorded* from a
failed question without reading the sentence. The `gap` names the recorded run
that answers it, [Record](fsd.md); asking again changes nothing until it has
happened. With suites declared, the refusal is exit `2` only
when no suite has a record; otherwise the answer exits `0`, and a suite with
none has `refused` in its own entry.

## Narrow to the tests nearby

When the list is long for structural reasons:

```bash
variance covering --file src/checkout/total.ts --line 48 --at-distance 0-3
variance covering --file src/checkout/total.ts --line 48 --in-package
```

`--at-distance` counts import hops from the file to the test's own file, over
the file graph, in the range spelling `SKILL.md` defines. `--in-package` keeps
the tests written under the same `package.json` as the file you asked about.
Both print how many of the tests survived the narrowing, because a filtered list
and a short list look the same and lead to opposite decisions. A test the walk
could not place is left out and counted. Both measure from one file, so neither
combines with `--since`.

The same band counts a whole suite: `variance coverage --at-distance 2-` counts
only what no test within one hop ran, by the nearest test across every suite,
over every region the suites loaded, and with `--packages` names the packages
whose regions only another package's tests reach.

`variance coverage --fan-in` asks `covering`'s question of every file at once:
how many test files called into each region, per kind, with the files at each
end. Test files that only loaded a file are left out, so each count is the least
an edit runs; `covering --file` names the loaders. Read it before refactoring
for selection or stability. The thin end is regions one test file ran: one
deletion from unobserved. The wide end splits two ways, and each has a different
fix: `most test files called into the file` (the code is a hub; stabilise the
tests it sends, or narrow its callers), and `selected whole beyond what its
median region needs` (the file sends `entered` where its median region needs `median`; that gap is
the most a split saves, since each part still sends every test file that called
into it). Under `--at-distance` the counts read only the band. `--format json` lists every file under
`fanIn`; no field is a verdict.

## Read the state of every range

Every range, and the answer about one line, has a `state`:

| state | meaning |
|---|---|
| `walked` | two or more cases called into it |
| `alone` | one case did, and every case that could have called it finished, so that case is the only one that fails for it |
| `loaded` | it ran only while its module evaluated |
| `hole` | no case ran it, and a case that could have stopped first, so the record does not show whether it would have |
| `unwalked` | no case ran it, and every case that could have finished |

Read `hole` as unknown, never as untested. A range with no state is one the
record cannot rank.

A range's cases are the ones an edit to its lines selects, so the line that
opens a branch carries the cases of the function around it. A region no case
entered on such a line, a one-line branch or the opening line of a longer one,
gets a range of its own in the whole-file answer and a line under it that says
no case entered it, with its state, here and over MCP alike:

```text
line 6 — alone
  the same named test as lines 4-5
  no case entered the branch on line 6, and every case that could have reached it finished: unwalked.
```

`--format json` lists those regions under the range's `unentered`, and
`--format refs` adds `; unentered branch 6 unwalked` to its line.

## Ask about the text you are editing

When the file differs from the text the suite ran over, which it does the moment
you edit it, pass the text you have:

```bash
variance covering --file src/checkout/total.ts --text - --format json < edited.ts
variance covering --file src/checkout/total.ts --text edited.ts --line 52
```

The answer's `frame` names the coordinates its numbers are in:

- `recorded` — the recording's, and the text matches it.
- `mapped` — every range was carried into your text; ranges an edit touched are
  marked `moved`.
- `stale` — the recorded text could not be found, so no ranges are given. The
  answer names the cases that ran code in the file and says that which of them
  ran your line cannot be said.

A `--line` your edit wrote is answered with no case, because no case has run
it, and in a run of lines it is named in `written` and left out. That is not
*no test covers it*: the answer ends with a Record gap naming the test files
`variance select` runs for the file, under the suite's own `relations`, `ignore` and `before`. A `stale` frame and a `moved` range end the
same way.

## Ask about the whole change at review time

```bash
variance covering --since main
```

This reports every region the diff changed with the cases that ran it, and
counts the two findings a percentage cannot state: regions **no case ran**, and
regions **one case alone** ran. A changed test file is answered with the named
cases it declares, since it has no module row. A changed path the index has
nothing for is named as such, since *no row* and *no test* are opposite facts.
The diff is measured from the commit the record was written at, so record before
you read. `variance_changed_tests` answers the same question over MCP, on a host
that serves it ([MCP](mcp.md#tools-no-binary-serves)), taking the unified diff
as an argument. It reads the file graph off the source tree the host supplies,
so a case whose file mocked the changed module is not listed under it.

A review agent reads the same answer with `--format refs`, and adds the base
branch's case index to see what the change did in files the diff does not name:

```bash
variance covering --since origin/main --against base/coverage.bin --format refs
```

- **lost** — cases ran it at the base, none do now, and every case that could
  have finished. Report it as a regression.
- **hidden** — the case that could have run it stopped. Report it as unknown,
  naming the stopped case, never as lost.
- **thinned** — one case runs it where several did; one case away from
  unwalked.
- **gained** — no case ran it at the base, and one does now.

Regions the base branch changed after the base was recorded are left out and
named; do not charge them to the change.

Regions are paired through git's diff from the commit the base was recorded at,
so the clone needs that commit. When the base names no commit, or names one the
clone does not have, the command exits 2 with an `undiffed` refusal and compares
nothing. Fetch the commit (`git fetch origin <sha>`) or check out every commit
(`fetch-depth: 0`) and ask again; do not read the refusal as *nothing moved*.

Without a base record, `--cases last` compares the last run with the one before
it, which answers *what did my last change do to the cases*. It needs the last
run at an earlier commit: a second run at the same commit that re-ran a test
file is refused the same way, so commit before you compare:

```bash
variance covering --file src/checkout/total.ts --cases last --format refs
```
