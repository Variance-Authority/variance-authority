# Fill a gap with a run of what it names

An answer gives what the record has and names what it lacks — its gap. Fill a
gap with what it names: a record fetched from the mainline, or a recorded run of
the tests it names with the project's own runner. Never fill it by running the
whole suite again over a record that exists:

- **A suite with no recording** — `covering`'s `unrecorded`. When the refusal
  names `variance share --suite <name>`, run that: it fetches the mainline's
  record of a suite the root config gives `"carry": "share"`, with no run.
  Otherwise wire the suite's producer, as [producers](producers.md)
  says, and record one run of the suite: that first run is the record.
- **A domain no producer wrote.** Wire the producer, as
  [producers](producers.md) says, then run again the tests whose
  answer lacked it.
- **A case, or a test file.** Run that file, filtered to the case by its name
  with the runner's own filter: `-t` under Vitest, Jest and Rstest, `--grep`
  under Playwright.
- **A file the record is older than** — `covering`'s `older`: the commit the
  record was made at did not hold the file, so the file is new. Run
  `variance index`, then `variance reach --since <commit>` with the commit the
  refusal names: it takes every file added since the record at once, with no
  record needed, and lists the files each one reaches over imports. Run the
  test files in that list. A ref such as `origin/main` diffs from its merge base
  with `HEAD`, which can already hold the file.
- **Lines written since the recording, or recorded over another text since, in
  a file the record holds** — `covering` answers a line your edit wrote with no
  case and names it in `written`. A line a case ran over, where a run over
  another text has landed since, is named in `overwritten`, under any frame:
  which case ran it is not known. A line the record cannot say a case ran over,
  since it does not say which text one that crossed the file ran, is named in
  `unknown`, with `why`. A `stale` frame or a `moved` range is the
  same gap. Record: the test files the gap names, the ones `variance select`
  runs for the file, among them every test file the record holds only in part.
  Run what the gap's `Run with the suite's own runner:` line names, `gap.run`
  under `--format json`.
- **A file the suite never loaded** — `covering`'s `Not loaded by`
  (`unloaded`). The file is in the record's commit, and the recorded run of the
  suite loaded it by no import at all — static, dynamic, or a setup file's.
  Running the same tests again records the same thing. A test file added since
  the recording is the diff's: `variance reach --since <commit>`, with the
  commit the record was made at, names it when it imports the file. Otherwise
  the gap is a test that loads the file, which no run fills.
- **A base the answer cannot compare against** — `undiffed`. The base names a
  commit this clone lacks or cannot diff from, or names none, or `--since` names
  a ref that reads as no diff. This gap is the one no run fills: fetch that commit, for example by deepening a shallow
  clone, or ask without the base.

`reach` and `discover` follow imports. A suite that drives the code from another
process, such as Playwright over a running app or a built Storybook, has no
import from a spec to the file, so for a new or an unloaded file the source
names none of its specs. Run the specs that drive the page, route or story the
file serves, filtered with `--grep`, against a build that carries
`testSelectionProbes()`, so the run measures the file.

Inside the edit loop, `VARIANCE_AUTHORITY_SINCE= <runner>` already selects
what each edit reached, both legs, as [test selection](test-selection.md#test-an-edit-in-a-loop)
says; these bullets fill one answer's gap. A run of the whole suite is the gate
before a change is done, and it is how the record is brought up to a commit. It
is not how one answer's gap is filled.

