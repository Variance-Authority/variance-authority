# What a skipped test promises

[Variance Authority](README.md) leaves a test file out of a run only when the
record of its last run shows it ran none of the code you changed. Every doubt
about that record — there is none, it holds nothing whole, or the change touched
what every test rests on — runs more of the suite, up to all of it, and the run
prints which doubt it was; a record that is there but cannot be reached stops
the command instead. A changed file that neither the record nor your
imports connect to any test keeps no test in the run, and the run names it so
you can declare it. What no record can show is a short list, and the
whole-suite run on your main branch is where a test it hid fails.

## One edit and its answer

Here is one edit, in this repository, and the answer `variance select` gives
for it. The edit changes one line inside `unreadNotes` in
`packages/cli/src/commands/select-notes.ts`:

```console
$ yarn variance select --suite unit --format json > selection.json
skipping 902 of 910 test files recorded whole: none covered a changed line; every other test file runs.
…
read packages/cli/src/commands/select-notes.ts: bodies — the changed regions are charged, not the whole module
```

The `…` stands for notes about where this checkout's record came from; the
sections below say what each kind means. In `selection.json`,
`packages/cli/src/commands/select.test.ts` is under `selected`, and its reason
is the region of `unreadNotes` at lines 18–22 that its last run executed.
`packages/cli/src/commands/select-before.test.ts` imports the same package and
is under `skip`: its last run never entered that function.

That is the whole contract. The rest of this page is about what happens when
the record cannot answer that cleanly, and what it cannot see at all.

## What a skip promises

The answer is a skip list, never a run list. A test file is on it only when
both of these hold:

- the record holds the file's last run **whole**: it ran to the end without
  failing;
- no region that run executed is a region your diff changed, read at the
  [precision](selecting.md#how-precisely-a-suite-selects) the suite declares.

Everything else runs. Two kinds of test file never reach the skip list, so they
always run:

- **A test file the record never saw.** A new test runs until a run records it.
  In a runner's count it is one of the selected, because it runs.
- **A test file the record holds but not whole.** A file whose last run failed
  or stopped is listed in `incomplete` in the JSON answer and runs.

"Changed" means `git diff` from the record's own commit to your working tree,
untracked files included. The diff starts where the record was written, so
everything that landed between that run and your checkout counts as your
change. A record from an older commit costs you a wider run, not a riskier one.

Precision decides what "a region your diff changed" means. At the default,
`region-use`, a changed function body charges the tests that ran that body; a
changed value charges the tests that ran code reading it; a change to what a
module does when it loads charges every test that loaded it. Each precision step
runs every test a finer one runs, so a suite you do not trust that far declares
a coarser step and pays for it in run time.

Each changed file gets one `read` line on stderr, with one of these verdicts:

| Verdict | What it charges |
|---|---|
| `none` | nothing: ` — the runtime text is equal` |
| `bodies` | ` — the changed regions are charged, not the whole module` |
| `values` | ` — the readers of the changed values and the changed regions are charged` |
| `load` | ` — every test that loaded it is charged` |
| `unread (<reason>)` | depends on the reason; see the next two sections |

Stdout carries skip data and nothing else. The explanation is on stderr, or in
the same JSON document under `--format json`.

## Every doubt about the record runs more

When the record cannot answer for the whole diff, the answer skips nothing. The
first line on stderr then reads `skipping nothing: <why>.`, followed by the
sentence that says what runs. Through a runner's seam — a config wrapped by
`withTestSelection` with `VARIANCE_AUTHORITY_SINCE` set, as
[testing an edit](test-an-edit.md) sets it up — the same doubt is the line
`variance-authority: declined: <why>`, and every test file runs.

The output calls the file the record is kept in the *journal*. Each line range in
it was cut from a module's text at the journal's commit, so a range is checked
against that text before it is compared with your diff.

| Doubt | What runs | What the output says |
|---|---|---|
| No record of the suite: not this checkout's, not the mainline's | every test file | `no execution journal at <path>` / `nothing to narrow by, so every test file runs` |
| The record holds no coverage | every test file | `the record at <path> holds no coverage` / `the run that wrote it instrumented no module, so every test file runs` |
| The record holds no test file whole | every test file | `the journal holds no whole observation of any test file` / `nothing recorded whole, so every test file runs` |
| git cannot produce the diff | every test file | `cannot read what changed since <ref>` / `no diff, so every test file runs` |
| The install cannot be compared with the one the record ran over | every test file | the reason the lockfile could not be compared, then `a package bump shows in no covered line, so every test file runs` |
| The diff moves a file the suite declares in `before` | every test file | `the suite <name> rests on <files> before any test imports it, and this diff moves it` / `what a suite rests on runs before every test in it, so every test file runs` |
| A changed module was recorded from a text nobody kept | every test that ran any region of it | `N changed modules were recorded from a text the journal's own commit does not hold and the cache did not keep, so every region of them was charged rather than read` |
| The record names no commit, and `--since` names the base | every test that ran a changed module | `the journal names no commit, so none of its line ranges could be checked against the text they were cut from; every changed module with a row was charged whole` |
| Some test files last ran at an earlier commit | those files are read against both texts | `N test files last ran at <commit>, before the journal's commit <commit>, so the K files changed between the two are read from both texts for them` |

A package bump is not by itself a doubt. When the lockfile can be compared, the
files that import a moved package are read as changed whole, and a note names
the packages and the files; see
[what a bumped package reaches](changes-before-and-beyond.md#what-a-bumped-package-reaches).
Only an install that cannot be compared runs everything.

Three doubts stop the command instead of widening it, because an answer would
look like a clean one:

- a record that exists but cannot be reached: `A reader that treated this as "nothing recorded" would pass over a record it holds and look exactly like a clean answer.`;
- a record that names no commit, with no `--since` to name one: `a selection measured from a guess would skip test files for lines nobody changed.`;
- a file of runs kept beside the journal that cannot be read, when no `--diff` is handed in: `a selection that guessed would skip tests that should run.`

When a suite declares nothing in `before`, every run says so:

```text
the suite unit declares nothing before reach, so a change to its runner config or the setup it loads is read like any other file; name them in `before` in variance.config.json to run the whole suite when they change.
```

Read that line as a to-do. Until your runner configuration and global setup are
in `before`, a change to them is judged like any other file, and a file no test
imports keeps no test in the run.
[How a change before reach is declared](changes-before-and-beyond.md#how-a-change-before-reach-is-declared)
shows the declaration.

## A file nothing connects to a test keeps none, and is named

A changed file can have no row in the record: no test executed it as code. The
selection then asks the file graph which measured files import it, and charges
the tests that loaded those, with the verdict `unread (…) — every test that
loaded its nearest measured importers is charged`. A stylesheet or an image a
component imports is answered this way.

When neither the record nor the file graph connects the file to any test, the
file keeps no test in the run. This is one of two places a doubt narrows
instead of widening — the other is [an unseen load](#what-no-record-shows) — and
it is deliberate: a README, a changeset or a design note would
otherwise run your whole suite on every edit. The run names every such file:

```text
the journal records nothing about 5 changed files, so they keep no test in the run; a file read without importing it is named by a `/// <depends>` in the module that reads it.
read .changeset/mainline-owned-tests.md: unread (the record and the file graph hold nothing about it) — it keeps no test in the run
```

If a test does depend on that file — a fixture it reads with `fs`, a schema it
loads by path — declare the dependency:

- in the module that reads it, `/// <depends path="…" />`: a change to the file,
  or to any module it loads, runs the tests that load that module;
- in `before`, when every test in the suite rests on it;
- on the seam, its `preconditions` option, when every test of the run rests on
  it, such as compiler settings: from the next recording on, a change to the
  file runs every test.

A suite with `"relations": false` declines the graph, so a `/// <depends>` reaches
none of its tests: there the file goes in `before` or `preconditions`. A file the
suite's `ignore` matches is the exception: the declaration still selects its
readers, and `before` does not.

Two settings narrow on purpose, and print a line when they do:

| Setting | What the output says |
|---|---|
| `relations: false`: the suite asks the file graph nothing | `the suite declines relations, so N changed files its record did not measure keep no test in the run; a file the suite rests on is declared in its \`before\`` |
| `ignore` globs | `the suite ignores N changed files by its \`ignore\`, so only a \`/// <depends>\` on one runs a test for them, or a \`preconditions\` entry, which runs every test of its run` |

In the JSON answer these files are under `unread`, `declined` and `ignored`.

## What no record shows

A record shows what ran. A few ways a test can depend on a change leave no
trace a record or a file graph can read:

- **A load the file graph does not list.** A test reached a changed module
  through a path the graph has no edge for: a computed `import()`, a plugin
  loaded by name, a module a runner config injects. The record saw the module
  run, but the change travels by use, and the use is not on the graph. Such a
  test is printed by name and not selected:

  ```text
  unseen <test>: loaded <file> by an import the file graph does not list; named, not selected
  ```

  The missing edge is the thing to fix: make the import static, or declare the
  file.
- **A read the code does not import.** A fixture, an environment variable, a
  network response, a file a tool writes and a test reads. Declared, it selects;
  undeclared, it is an unread file and keeps no test.
- **A change inside a git submodule.** The diff shows a submodule as one
  `Subproject commit` line, so no test that entered a file inside it is
  charged.
- **An edit you undid.** The record knows a test ran over an edit that is now
  gone only when it kept that edit's text. An undone edit to a test file or a
  setup file, whose text the record does not keep, selects nothing.
- **A branch no run has taken.** A changed line no test executed charges no
  test. That is correct for selection — no test exercised it — and it is a
  coverage gap, which [the record also shows](selecting.md#a-branch-no-run-has-taken).
- **A result a cache returned.** A memoized function the cache answered runs
  nothing, so a change to it selects only the case that ran it:
  [a result a cache returned](selecting.md#a-result-a-cache-returned).
- **A value another test file evaluated.** Under a module graph shared across
  test files, a file that reads what an earlier file's evaluation left runs
  nothing in the module:
  [a record needs a module graph per test file](selecting.md#a-record-needs-a-module-graph-per-test-file).

None of these is a doubt the run can detect, so none of them widens the run.

## The whole run on main catches what a skip hid

The record your branches read is the one your main branch publishes, from a run
of the whole suite; [sharing](sharing.md) describes how that run is published
and how a checkout finds it. A published record has to show that every test
file the runner collects ran, so that run skips nothing. Any
test that a narrowed run on a branch hid fails there, on the next push to main,
against the same change.

So a miss costs a late failure, not a silent one: the failing test names the
file, and the fix is the declaration or the change to the test that the
earlier sections name. The narrowed
runs on your branches buy time; the whole run on main is the backstop for the
short list above.

## How sure you can be of one run

You do not have to take a selection on trust. Each run says what it read:

- the first stderr line says how many test files were skipped out of how many
  the record holds whole, or why nothing was;
- one `read` line per changed file says how it was read, and an `unread` line
  says why it could not be;
- every `unseen` line is a test the graph could not connect to its load;
- under `--format json`, `selected` lists each test that runs with the regions
  that put it there, and `incomplete`, `unread`, `declined`, `ignored` and
  `stale` list the rest.

Read the output of your next run with three questions:

1. Does the first line say `skipping nothing:`? Then the reason is the thing to
   fix, or to accept.
2. Is any changed file `unread` with `the record and the file graph hold
   nothing about it`, and does a test read it? Then declare it.
3. Is any test `unseen`? Then its load is invisible to selection until the
   import is static or the file is declared.

A run with none of these left is as sure as its record: every skipped test ran
before and did not touch what you changed.

## Where to go next

- [Test an edit](test-an-edit.md): wire the seam into Vitest, Jest or
  Playwright.
- [Running less of the suite](selecting.md): precision steps, and what each one
  reads.
- [Changes before and beyond](changes-before-and-beyond.md): declare what every
  test rests on, and how a package bump is read.
- [Coverage-based test selection](coverage-test-selection.md): how this
  approach compares with other selectors.
- [The execution record](execution-record.md): what a record holds and how it
  is read.
