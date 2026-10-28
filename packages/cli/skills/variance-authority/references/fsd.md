# Fast, Smart, Deep: which reading answers next

Ask one question at a time, and read it at the cheapest gear that can answer
it. There are three gears for reading, Fast, Smart and Deep, and a fourth step,
Record, that makes the record they read:

| Gear | Reads | Commands |
|---|---|---|
| **Fast** | what is known without a run: the diff, the code, the source index | `git diff`, the source, `variance ask symbol\|uses\|search`, `variance select` |
| **Smart** | what a run recorded: which cases ran which lines, at which commit, and what the last runs found, a flake told apart from a change | `variance covering`, `variance coverage`, `variance review`, `variance ask` about a run ([ask a run](ask-a-run.md)) |
| **Deep** | one story per named case: the functions it called, in order, and the branches it took | `variance story`, on at most three tests ([story](story.md)) |
| **Record** | nothing: it is a normal recorded run, and it writes the record Smart reads | the project's own runner, wrapped as [producers](producers.md) says |

## An answer ends with its gap

`variance covering` ends an answer that leaves its question open with a gap:
one question, the reason it is open, and the exact run that closes it. An
answer with nothing open has no gap.

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

Under `--format json` the same gap is the answer's `gap` field:

| Field | Value |
|---|---|
| `question` | what stays open of the scope |
| `scope` | what it is asked of: `line 20 of src/ledger.ts`, or the file |
| `known` | what the answer does have |
| `reason` | `absent`: no run is recorded; `stale`: the record was made over a different version of the file than the checkout's, or before the file existed; `coarse`: the record has the line only at file grain |
| `remedy` | what closes the gap: `record`, a recorded run of the files it names, or `deep`, the Deep gear, a story of the cases it names |
| `run` | what the suite's own runner runs first: `suite`, when the answer is one suite's; `suites`, when it is several suites' with no record; `files`, the test files; `whole`, why the whole suite runs, when selection runs it; `cases`, `{file, name, pattern}`, each filtered by `pattern`, its name escaped as the regular expression `-t` and `--grep` read; `story: true`, under `VARIANCE_AUTHORITY_STORY=1`. A `run` of only `suite` or `suites`: wire the producer of each suite and record one run of it; a suite given to the share has no `run`, and `next` fetches its record. Absent when no run closes the gap |
| `next` | the commands that run as printed, in order, after `run` |
| `cost` | `files`, how many the run takes, and `tests`, the cases the record holds of them, absent when it holds none. Absent when no record counts the run |

No record and no configuration names the runner a suite runs under, so the gap
says what to run, not a runner command: run the test files with the project's
runner, and a case filtered by its `pattern` with the runner's own filter, `-t`
under Vitest, Jest and Rstest, `--grep` under Playwright: each reads a regular
expression, so the pattern escapes the name, which `variance story --name` takes
as written.

Each answer of `covering` gives one gap, one per suite over several suites, and a stale record comes before Deep:

| The answer | Gap |
|---|---|
| a line at file grain (`At file grain`, `grain: "file"`, `fileGrain`) with named tests, asked by `--file`, `--line` or `--lines` | Deep: the story of the first three tests, in the order the answer lists them |
| `frame: "stale"`, lines `written` since the recording or `overwritten`, or ranges `moved` | Record: the test files `variance select` runs for the file, under the suite's own `relations`, `ignore` and `before` |
| `older`: the record is older than the file, so the file is new | Record: the recorded test files `variance select` runs for the file, by reach, under the suite's own configuration, or the whole suite when selection runs it. Then `variance reach --since <commit>`, from the commit the record was made at, never a ref such as `origin/main`, whose merge base can already hold the file: it takes every file the diff added at once, new test files no record names among them. When selection refuses, the gap says why in its words, as in every Record gap. No run when selection names no file, and never the share |
| `unrecorded`: no run is recorded | `variance share --suite <name>` in a suite given to the share; otherwise Record: wire the producer and record one run of the suite, with no cost, since no record counts it |

A refusal keeps its exit code `2`. Under `--format json` its gap is beside
`refused`, as `{"refused": "unrecorded", "gap": {…}}`, and in a suite's entry
beside `refused` and `reason`.

## The rules

- **One question in, one answer or one gap out.** Ask a file or a line, never
  a whole area, and read the gap before you ask anything else.
- **Run Deep only on a gap that names it.** Never record a story of a suite or
  of tests you chose yourself; the Deep gap names at most three, nearest first:
  run those cases under `VARIANCE_AUTHORITY_STORY=1`, then read each with
  `variance story` ([story](story.md)).
- **Record what the gap names when the record is missing, stale or older than
  the file.** That is a normal recorded run of the files it names; for a new
  file, the test files selection runs for it; for no record,
  the mainline's record fetched. Never a story, and never the whole suite
  over a record that exists unless selection runs it. A story of a test
  over text the record no longer has answers a question about another file.
- **Skip a gear only when its record cannot have the answer.** The source index
  cannot say which case ran a line, so that is Smart; the record cannot say
  which values a function was handed or in what order it ran, so that is Deep.
- **Check a finding at the cheapest gear that could prove it wrong.** A test
  that Deep shows going through a function is checked against `covering` for
  that function, and a selection against the diff.
