# Which tests ran this line

`variance covering` is the question to ask before changing a line, and the one
to ask about a test that may no longer be worth keeping. It reads the per-case
execution index and names the tests that ran through a file, a line or a
function. Of the root `variance.config.json` it reads only `suites` and
`cacheRoot`, and `names` under `--where`. None of it is a verdict: execution says where a
test went, never why the trip was worth taking.

```bash
variance covering --file src/checkout/total.ts --line 48
variance covering --file src/checkout/total.ts --function applyDiscount --format json
variance covering --file src/checkout/total.ts                  # per recorded range
variance covering --file src/checkout/total.ts --format refs    # each case once, ranges by number
```

A line or a function is answered per test file first: `total.test.ts — 2/3`
says two of that file's three cases ran through it, and the cases follow.

- `--hops` puts each test file's import hops beside it and sorts nearest first.
  It needs `--line` or `--function`, is refused with `--since`, and costs a scan
  of the tree, so ask for it when the list is long, not on every edit.
- `--cases last` answers from the cases the last run recorded; `--cases <test
  file>` from the ones that test file declares.
- `--where <name>[=<value>]` keeps the cases that said that precondition with
  `variancePrecondition`. Reading what cases arranged, their twins and an
  `unmeasured` refusal is in [case preconditions](case-preconditions.md).
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
record, and the answer is one block per suite, headed `<suite> (<kind>):`.
`--suite <name>` reads one suite's record alone, and is refused beside
`--execution`. Under `--format json` the answer is `{"file": …, "suites": [...]}`,
with `since` in place of `file` for a diff. Each entry is that suite's answer
with `suite` and `kind` added, or `{suite, kind, refused, reason}` for a suite
that could not answer.

## Nothing recorded is refused, not empty

An empty list reads as *no test covers this line*, so a missing index is
refused: exit `2`, and under `--format json` stdout is
`{"refused":"unrecorded"}`, which tells *nothing recorded* from a failed question
without reading the sentence. Asking again changes nothing until a wrapped run
has happened. With suites declared, the refusal is exit `2` only when no suite
has a record; otherwise the answer exits `0`, and a suite with none says
`refused` in its own entry.

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

## Read the state of every range

Every range, and the answer about one line, has a `state`:

| state | meaning |
|---|---|
| `walked` | two or more cases called into it |
| `alone` | one case did, and every case that could have called it finished, so that case is the only one that fails for it |
| `loaded` | it ran only while its module evaluated |
| `hole` | no case ran it, and a case that could have stopped first, so the record cannot say whether it would have |
| `unwalked` | no case ran it, and every case that could have finished |

Read `hole` as unknown, never as untested. A range with no state is one the
record cannot rank.

## Ask about the text you are editing

When the file differs from the text the suite ran over, which it does the moment
you edit it, pass the text you have:

```bash
variance covering --file src/checkout/total.ts --text - --format json < edited.ts
variance covering --file src/checkout/total.ts --text edited.ts --line 52
```

The answer's `frame` says which coordinates its numbers are in:

- `recorded` — the recording's, and the text matches it.
- `mapped` — every range was carried into your text; ranges an edit touched are
  marked `moved`.
- `stale` — the recorded text could not be found, so no ranges are given. Run
  the suite.

A `--line` your edit wrote is refused, because no case has run it. Do not read
that as a gap.

## Ask about the whole change at review time

```bash
variance covering --since main
```

This reports every region the diff changed with the cases that ran it, and
counts the two findings a percentage cannot state: regions **no case ran**, and
regions **one case alone** ran. A changed test file is answered with the named
cases it declares, since it has no module row. A changed path the index has
nothing for says so, since *no row* and *no test* are opposite facts. The diff is
measured from the commit the record was written at, so record before you read.
`variance_changed_tests` asks the same over MCP, on a host that serves it
([MCP](mcp.md#tools-no-binary-serves)), taking the unified diff as an argument, but answers without the file graph: a case whose file mocked the
changed module can be listed under it.

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
