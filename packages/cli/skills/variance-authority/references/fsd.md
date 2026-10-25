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
Gap (coarse) on line 20 of src/ledger.ts: which of these tests ran it, and in what order. Known: 4 named tests loaded src/ledger.ts.
Next, Deep, 3 tests in 2 test files:
  Run each case with the suite's own runner under VARIANCE_AUTHORITY_STORY=1, filtered by its name (-t; --grep under Playwright):
    ledger.test.ts  'finds the entry'
    ledger.test.ts  'records an entry'
    book.test.ts  'opens a book'
  variance story --file ledger.test.ts --name 'finds the entry'
  variance story --file ledger.test.ts --name 'records an entry'
  variance story --file book.test.ts --name 'opens a book'
```

Under `--format json` the same gap is the answer's `gap` field:

| Field | Value |
|---|---|
| `question` | what stays open of the scope |
| `scope` | what it is asked of: `line 20 of src/ledger.ts`, or the file |
| `known` | what the answer does have |
| `reason` | `absent`: no run is recorded; `stale`: the record is of another text, or older than the file; `coarse`: the record has the line only at file grain |
| `gear` | `record` or `deep` |
| `run` | what the suite's own runner runs first: `suite`, when the answer is one suite's; `files`, the test files, nearest first; `cases`, `{file, name}`, each filtered by its name; `story: true`, under `VARIANCE_AUTHORITY_STORY=1`. With no `files` and no `cases`: wire the producer and record one run of the suite. Absent when no run closes the gap |
| `next` | the commands that run as printed, in order, after `run` |
| `cost` | `{tests, files}` the run takes; absent when no record counts them |

No record and no configuration names the runner a suite runs under, so the gap
says what to run, not a runner command: run the test files with the project's
runner, and a case filtered by its name with the runner's own filter, `-t` under
Vitest, Jest and Rstest, `--grep` under Playwright.

Each case of `covering` gives one gap, and a stale record comes before Deep:

| The answer | Gap |
|---|---|
| a line at file grain (`At file grain`, `grain: "file"`, `fileGrain`) | Deep: the story of the first three tests, in the order the answer lists them |
| `frame: "stale"`, or lines `written` since the recording, or ranges `moved` | Record: the test files whose cases ran code in the file, or the edited ranges |
| `older`: the record is older than the file | Record: the test files the record ran that import the file, as `variance ask discover --to <path>` finds them, counted from the record. When none does, the gap says so and names that `discover`, never the suite. In a suite given to the share, `variance share --suite <name>` when the mainline holds the file |
| `unrecorded`: no run is recorded | `variance share --suite <name>` in a suite given to the share; otherwise Record: wire the producer and record one run of the suite, with no cost, since no record counts it |

A refusal keeps its exit code `2`. Under `--format json` its gap is beside
`refused`, as `{"refused": "unrecorded", "gap": {…}}`, and in a suite's entry
beside `refused` and `reason`.

## The rules

- **One question in, one answer or one gap out.** Ask a line, a function or a
  diff, never a whole area, and read the gap before you ask anything else.
- **Run Deep only on a gap that names it.** Never record a story of a suite or
  of tests you chose yourself; the Deep gap names at most three, nearest first,
  as [story](story.md) records the first three `covering --hops` lists.
- **Record what the gap names when the record is missing, stale or older than
  the file.** That is a normal recorded run of the files it names, or the
  mainline's record fetched, never a story and never the suite again over a
  record that exists. A story of a test
  over text the record no longer has answers a question about another file.
- **Skip a gear only when its record cannot have the answer.** The source index
  cannot say which case ran a line, so that is Smart; the record cannot say
  which values a function was handed or in what order it ran, so that is Deep.
- **Check a finding at the cheapest gear that could prove it wrong.** A test
  that Deep shows going through a function is checked against `covering` for
  that function, and a selection against the diff.
