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
Lines of a run your edit wrote are named in `written`, lines a case ran in a
text the record does not number in `overwritten`, and no case is named for
either; when your edit wrote every line asked, the answer says that no case has
run them. When no line asked is in a recorded region, or every one is in one of
those two, the answer names no case and says, for each line, whether your edit
wrote it, a case ran it in another text, or no region holds it.

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
`--root <path>` the project root it was recorded against. A record that names
the commit it was made at is read as the suite's own is: its `at` is that
commit, its lines are framed in your text against it, and its test files are
dated by the runs record beside it. A journey file names no commit, so its
lines are given as recorded and no time is said. Producing the index is in
[producers](producers.md).

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

When the file differs from the text the record's lines are numbered in, which it
does the moment you edit it, pass the text you have:

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
it, and in a run of lines it is named in `written` and left out. A line the
record's text has no place for, but a text that a case which entered the file
ran over holds, is answered with no case too and named in `overwritten`: a
later run over another text numbered the record's lines, so a case ran over
your line, and which one ran it is not known. So is a line of a region a run in
part landed an edit over: that run numbered the record's lines in its text, and
the cases that ran the region before it ran another text there. Every line of
that region is said so, under `--line`, `--lines`, `--function`, the whole file
and `--since`, unless a case the answer names entered it; the whole file says
it of the range, and a range a named case entered says it also holds one.
Neither is *no test covers it*:
the answer ends with a Record gap naming the test files
`variance select` runs for the file, under the suite's own `relations`, `ignore` and `before`. A `stale` frame and a `moved` range end the
same way.

## Read how fresh and how actual the answer is

The frame is numbering only. Which text each test file ran over, and when, is
said apart, because a partial run moves the record to its commit and every test
file it did not run keeps where it last ran: one answer can name a test file
that ran a minute ago over your text beside one that ran days ago over a text
that was never committed. Under the answer, after the frame line, the test
files it names are said in groups, one line each, a group the record holds no
time for first, then the oldest:

```text
The recorded lines of src/pay.ts are placed in its text as it is now.
src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 9 hours ago; `pay` is the same in both.
src/pay.ts is the text the other test file named here ran over, in a run that landed 6 minutes ago.
```

- The frame line says nothing under `recorded`. A `stale` answer about the
  file or a line opens with it instead, as the reason it gives no line; under
  `--function` it adds that the parts no case ran are not said. Under `mapped`
  a part of the function no case ran that an edit touched prints as `edited`.
- A group is the test files one run last finished: it ran them whole, or the
  record held no cases of them. A run that executed none of a file's cases did
  not run it. A later run in part (`-t`, a filter, a skip) names the cases it
  ran, so each named case is dated and compared by the run that last ran it,
  and a test file whose named cases last ran apart is said part by part on one
  line, newest first: ``src/pay.test.ts ran 'refunds' over this text, in a run
  that landed 1 hour ago, and its 1 other case named here over another text of
  src/pay.ts, in a run that landed 3 days ago, in which `pay` is the same.`` A
  run in part whose landing names no cases leaves the file placed by the
  earlier run, its line spanning both times, and if only some of those runs
  ran over your text, which text its cases ran over is not known.
- Your text, `--text` or the file on disk, is compared by digest with the
  texts the runs record names for each run, else the committed ones at its
  commit. A group is compared only on the files its runs read: the asked file
  its cases entered or hold as a precondition, and under `--since` each changed
  file its cases are named for, entered or hold as a precondition. A file its
  runs never loaded says nothing of the text they ran over. The groups that ran
  over your text share one line; a group that ran over another text, or whose
  text is not known, is named. A file the group's commit lacks is said not to
  have existed where it ran; a commit or text this clone lacks leaves it not
  known. Every file a group read and its verdict is said.
- For `--line`, `--lines` and `--function`, a named group's line says whether
  that region is the same in both texts, gone from yours, or why that is not
  known. Under `--function` it says nothing of the region when the record does
  not say which text its lines are numbered in.
- The time is when that run landed, spanned when a line says several runs. A
  commit's date is never used. A group the record holds no time or texts for
  says what it does not hold; a record seeded before landings holds no time,
  since the seed stamped it when it was copied. Runs outside a git checkout
  stand at one place, each dated by its landing, and only the one that wrote
  the snapshot is compared with its rows; an earlier one's text is not known.
  A test file read from a newer mainline record is dated and compared by the
  run that published it.
- A test file the runs record does not place, and every one when no runs
  record lies beside the snapshot or it is of another commit, is read where
  the record assumes it, at no time and over a text not known, and a last line
  says how many were. An answer naming no test file is dated by the test files
  that entered the file, and compared over it, else by every case it read, and
  compared over nothing, since none of them loaded it.
- `--since` says the same under its regions, each group over the changed files
  it read, with no region; a changed file not on disk is named first, and no
  test file is said to have run over it.

In JSON, `at` is the record's commit and `ran.stands` the groups: each a
`commit` (absent for a run outside a git checkout), its `tests`, `cases` (the
cases of its one test file when that file is said part by part), `landed`
(`first`, `latest`, and `runs` when counted), `partly` (the `commit` and
`landed` of each later run that ran them in part without naming its cases),
`files` (the asked files they are compared on, when fewer than all), `text`
(`held` when they ran over your text of every file they are compared on,
`other` when they ran over another text of some, or over none), `other` naming
the files they ran another text of, `absent` those that did not exist where
they ran, `held` those whose text is yours when not every one is, `region` (`same`,
`changed`, `gone` or `{ "unknown": <why> }`), `unknown` for why the rest's text
is not known, and `assumed: true` with `ran.assumed` saying how. `ran.unheld`
names the changed files not on disk, `ran.named` is `entered` or `read` when the
answer names no test file, and `ran` holds `tests` and `unread` in place of
`stands` when where they ran cannot be read; `ran` is absent under `--format
refs`. `moved: true` marks a `--function` answer and each `unrun` part an edit
touched, and `unheld: true` a file that is not on disk.

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
