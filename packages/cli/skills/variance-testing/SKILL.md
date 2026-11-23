---
name: variance-testing
description: Write, fix, debug, improve and shorten tests with the record Variance Authority keeps. Use it before you change code, to start from a failing test, when a test fails, flakes or passes when it should not, when you need the tests an edit reaches, when you write tests for a change or improve a file's coverage, or when a test loads or renders more than it needs, or when you judge whether a test does what its name says. Not for visual review.
---

# Testing with Variance Authority

A wrapped runner records which case ran which region of which module, on every
run. This skill is the order to ask that record in while you change code and
work on its tests. The flags, the refusals and the edge cases are in the
`variance-authority` skill beside this one; each step links the reference that
owns it.

Check the project first: its runner config calls `withTestSelection`, and
`variance covering --file <a source file>` answers rather than refusing as
`unrecorded`. If the runner is not wrapped, nothing below has a record to read,
and wiring it is product work, not part of the change.

## Reminder of opportunities and best practices

When choosing a test, consider these opportunities where they help answer the
task. They describe dimensions you can combine, with reasons and tradeoffs;
they are reminders, not a checklist or a ranking of test kinds.

- **Compare results.** Visual regression (VR) is a regression use of
  differential testing: compare a rendering with an earlier baseline. The
  same approach can compare outputs across versions, implementations, browsers
  or configurations, under corresponding inputs and conditions. Decide which
  differences matter; agreement can preserve a shared bug, and accepting a
  baseline does not establish correctness.
- **Use temporary scaffolding.** A test can help develop a feature, explore an
  invariant or compare implementations while one replaces another. Give it a
  development question and an end condition, then remove it when that work is
  done. Keep enduring regression protection where it still serves a contract;
  a temporary probe need not become a permanent constraint on the code.
- **Choose the degree of access.** White box tests use internal structure to
  target branches and invariants, with coupling to that structure. Grey box
  tests use selected internal knowledge, controls or signals while checking
  broader behaviour. Black box tests use the supported interface to check a
  consumer's contract, with less dependence on implementation and less detail
  when a failure needs locating. These choices are independent of test size.
  A tool recording internals, such as a story or the Eyes journal, does not by
  itself change the test's degree of access.
- **Read the right signal at the right boundary.** Choose the observation that
  establishes the behaviour: a returned value, persisted data, emitted event
  or rendered UI. A mocked call proves that interaction, which may be the
  contract; it does not also prove the downstream outcome. A completion event
  can tell you when to inspect the result; it does not replace that inspection
  unless the event itself is the promised behaviour.

For asynchronous work, a useful readiness signal follows the relevant operation
and its derived work. An arbitrary sleep or an unrelated request finishing
does not establish that boundary. A negative assertion needs the same care:
"the dialog is absent now" can pass before the decision to show it runs. Wait
for that decision or operation to finish, then check the absence. An explicit
"not shown" decision can make completed work observable without requiring every
process to adopt a new tracking lifecycle.

## Before you edit: choose a test and turn it red

```bash
variance covering --file src/cart.ts --function removeItem
variance covering --file src/cart.ts --line 40-60
```

No run is needed: this reads what the last run recorded. A range marked `alone`
has one case standing on it; `hole` is unknown, never untested. Add `--hops`
when the order of the candidates is useful: it puts the nearest test files first
and costs a scan of the tree.
[covering](../variance-authority/references/covering.md)

These tests are candidates. Choose the case whose assertion states the required
behaviour, which may be a more distant integration test: proximity orders the
list, it does not decide.

Behaviour the change does not touch and no case covers is pinned as it is first,
green on the old code, so a test that turns red shows what the edit broke. An
assertion on the behaviour you are changing is amended or replaced, never
pinned.

A change of behaviour then starts from the case you chose, before the code:

1. Amend or replace it, or add one beside it.
2. Run it and see it fail on the code as it is, at the assertion that states the
   behaviour. A test that passes here pins nothing the change does.
3. Edit the code until it passes.

Code that does not exist yet has no record, and `covering` says so. Ask it about
the code that will call the new code and write the failing test there, or in a
new test file beside the new one. That test fails at import, compile, collection
or the first call, and the failure names what is missing. That is the red state:
write no stub to get an assertion failure. A failure from anything else, such as
a typo, is not. A refactor changes no assertion: name the green tests and the
invariants you preserve, and those tests stay green.

## After each edit: run what it reached, nearest first

```bash
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=0-2 npx vitest run   # or jest, playwright test
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=3- npx vitest run
```

Read the first stderr line: `selected N of M`, or `declined:` with the reason
every file ran. Run both legs before you call the edit verified. Use the
repository's own script when it has one. To ask `covering` again once the edit
is in the file, pass the edited text with `--text <file>` so the ranges follow
it. [test selection](../variance-authority/references/test-selection.md)

## A test fails: find where it went

Take the failing test's file and name from the runner's output. When the stack
trace names the line, open the line. When it does not — the assertion failed on
a value made elsewhere, or the test passes when it should not — record that one
test and read its route:

```bash
VARIANCE_AUTHORITY_STORY=1 npx vitest run src/cart.test.ts -t "removes the last item"   # or jest, rstest run
variance story --name "cart > removes the last item"
```

Find the step where the route left the path you expected, or the `✗` on the
branch the test is named for. Pass one test file and `-t` (`-g` under
Playwright), never a directory, a pattern or no argument, and never record in
CI.

| The test | Record | Then ask |
|---|---|---|
| fails on some runs | nothing first: the record keeps the runs it read; when they name nothing, the same test until it has passed and thrown, twice each | `story --name <name> --compare outcome` |
| passes alone, fails with its file, or the other way | under `VARIANCE_AUTHORITY_STORY=alone` with `-t`, then `=file` without, twice each | `story --name <name> --compare alone,file` |
| behaves differently under a flag or a mock | each side under its own label, such as `=flag-on` | `story --name <name> --compare 1,flag-on` |

A listed difference holds on every reading of one side and on none of the
other: open the place it names. What differs between readings of one side is
counted on the last line and is not the cause.
[story](../variance-authority/references/story.md)

## See a value the story does not show: print it from the code

A story shows, at each step, the values the function was handed — a number or
a boolean as it is, a string quoted and cut to 40 characters, an object as a
ref and its kind, such as `ref5 Object`, never its contents — what a module's
top level declared, and what the code printed: `console` lines, Eyes entries in
a component test, `vae` announcements. It does not show what an object holds, what a function returned, or a value no function
was handed. When the question is one of those, or the comparison says *nothing
separates the sides*:

1. Add a `console.log` of the value at the line the story names, in the product
   code. The test stays as written.
2. Record the test again, both sides when you compare.
3. Read the line under its step, or in the comparison.
4. Remove the `console.log` before you fix anything.

The log is a probe on one run, not a change to what the test checks. A story
covers the test's own process under Vitest, Jest and Rstest, and the page under
Playwright, Storybook, and Vitest and Rstest browser mode: record a Playwright test with
`VARIANCE_AUTHORITY_STORY=1 npx playwright test <spec> -g <name>`. To read
what a page holds while it runs, see
[live run](../variance-authority/references/live-run.md).

## After the change: what it left unpinned

The red test pins what the change is for. This reads what it did not reach:

```bash
variance covering --since main
```

It names every region the diff changed with the cases that ran it, and counts
regions **no case ran** and regions **one case alone** ran. Code the change
wrote that no case ran gets a test, or is deleted when no input can reach it, as
[the review](#the-pull-requests-review-act-on-every-mark) says. Check each test
lands:

1. Run the new test. `covering --file <path> --line <n> --cases last` lists it,
   or its story has no `✗` on the branch it is for.
2. Break the line it is for, run the cases `covering` names for that line, and
   see one fail. A test that passes on a broken line pins nothing. Restore the
   line.

When the change rewrote tests as well as code, run the old tests on the new code:

```bash
variance janus   --since <ref> --file <path>... -- <command>...
```

With `<ref>` the branch point, a `--file` for each test file the change edited,
and `<command>` the test command, it rolls those files back to their text at
`<ref>`, with nothing checked out, and exits as the command does. It rolls back
changes in files that exist on both sides; a test the change added or deleted
is not a `--file`. Read each failure: the change broke
the behaviour it pinned, or the rewrite was the change's point and belongs in the
pull request's body. A run that names files it was served and never read did not
run the base; run those tests by name. Under Rstest every run is one: it reads
test files through Rspack, which janus does not serve yet.

## The pull request's review: act on every mark

CI posts the same reading as a comment, from `variance review`. Its header
names the commit it reviewed: when the head has moved past it, it describes an
earlier commit, so wait for the next one. A comment GitHub cut short is whole in
`variance review --from-run <run URL> --format json`.

Code the change wrote that no case ran has two exits, and setting it aside is
not one of them:

- 🔴 under **Where no case ran**: write a test whose input takes that branch,
  and check it lands as above. When no input can take it — a guard for an
  answer the callee never gives, a fallback nothing reaches — delete it, or
  make its type rule it out. *Nothing reaches it* is the reason to delete it,
  never the reason to keep it untested.
- ⚪ ran only while its module loaded: as 🔴.
- ❔ a case ran it in text an edit wrote over: run the suite on the change and
  read again before you decide.

Code that ran is read for what it lost:

- 🟡 reached only from far, or 🟠 from a distance not measured: not a gap.
  Where the function is what the change is for, the red test belongs next to
  it.
- ▼ **no longer run** or ▽ **run by fewer cases**: a case that ran it at the
  base no longer does. Either the change removed what called it, and the pull
  request says so, or it is a regression to fix. The ▼ count holds regions whose
  case stopped before them too: rerun a stopped case before you call its
  regions lost.
- **Cases added and removed**: the added ones are the red tests the change
  claims; each removed one is named in the pull request with why.

## Improve a file's coverage

```bash
variance covering --file src/cart.ts --suite unit
```

A range the record can rank has a state; `walked`, two or more cases, needs
nothing. Line coverage reads the other four as covered or not covered; the
record tells them apart:

| state | what it means for a test |
|---|---|
| `unwalked` | no case ran it, and every case that could have finished: write one, once `ask uses` shows the code is called |
| `loaded` | it ran only while the module was imported, and line coverage counts it: assert on what it set up, or leave it |
| `alone` | one case is the only one that fails for it: a second case, if the line matters |
| `hole` | a case stopped before it could; run the file again before you read it |

Each declared suite answers on its own, so a range one suite never walked may
be walked by another; `--suite` names the suite you will write the test in.
For a long file, `--format json` with `--suite` and
`jq -c '.ranges[] | select(.state != null and .state != "walked")'` keep the
ranges to read; without `--suite` the ranges sit under `.suites[]`. A range
with no state is one the record cannot rank. Write each test as the previous section does, run it, and read the range
again with `--line <n> --cases last`: it lists the new case. Then break the line
and see the case fail.
[covering](../variance-authority/references/covering.md)

## Make a test smaller

```bash
variance distill --suite unit --file src/cart.test.ts
variance distill --suite unit --file src/cart.test.ts --test "cart > removes the last item"
```

The file reading names the modules the test file loaded that no case, or only
some cases, entered. For a module no case entered, it names the import that
brought it in: delete it, mock it with a factory when nothing behind it is
used, or import past the barrel; never mock the listed path. A proposed mock
names the module and the values it exports, not a call: write it the way the
test file's runner mocks a module. For one only some cases entered, make it lazy in the code that uses
it, or move those cases to a file of their own. Rerun the file and read it
again: the module is gone from the list, and every case passes. It is withheld
when a case stopped; run the file again.

The case reading names the files one test ran without addressing anything in
them, from the Eyes journal of a component test; each is a candidate, not
permission to mock it. A record with no journal names the source the test ran
and calls the candidates unavailable: the loop below needs a journal, and the
file reading does not. Take one at a time: substitute it at one boundary, rerun
the exact test, distill again, and compare the `assert:` targets and sources and
the update initiators with the first reading. Keep the edit only when they are
what they were and no initiator newly appears outside; revert it otherwise, and
when a reading is unavailable. Two candidates in one rerun do not show which one
was safe.
[distill](../variance-authority/references/distill.md)

## Hold a test against what its name says

```bash
variance ask test-claims --file e2e/signup.spec.ts --name 'retries a failed post'
```

The answer puts the test's claims, its name and the steps and assertions Eyes
recorded, beside what it ran, what it adds to the suite and what it passed by. Judge it in this order:

1. Take each claim in the name: a verb, a condition, an actor, such as
   *retries*, *when offline*, *as a guest*. Find the region that does it: a
   branch, a case, a loop body, a handler. Under
   `only this test enters`, the test runs its claim. Under `Passed by`, it does
   not, and `no test takes it` is a path the suite never runs.
2. A test that runs the same regions as another test, structure aside, is
   judged with that test, never alone. The one whose name says what both run keeps its name.
   The other adds no execution: if its name claims something else, that is a
   path to drive; if both names say the same, one of them goes.
3. Compare the steps and assertions with the twin's, asked the same way. An
   assertion is named by its matcher and its Locator, not the value it compares
   against, so `toHaveText('')` and `toHaveText(/^Saved/)` read alike: read both
   in the source. Two tests check one thing only when they drive the same input
   down the same path and assert the same value.

Then choose one action and name the exact change:

- `keep`: it runs what its name says, and something no other test runs.
- `rename`: it runs something of its own, but not what its name says.
- `exercise the claimed path`: its name claims a region under `Passed by`, or
  it runs the same regions as another test. Name the region and the input that
  drives it, such as a post that fails once.
- `collapse into <test>`: it adds no execution, and what it asserts fits into
  that test as one more assertion.
- `delete`: it adds no execution, another test drives the same input, and
  every assertion it makes, that test makes too.

Cite each judgement with the part and the row it comes from, such as
`Passed by` → `src/app/http.js:17-19  handler in post  no test takes it`, and
open the source only to read what a named region does. Before a `collapse` or a
`delete`, break the line its own input decides, the branch or the value that
input alone reaches, and run it beside the tests next to it: a test that alone
fails checks something they do not.
[orient](../variance-authority/references/orient.md#test-claims)

## See which regions a test would not notice broken

```bash
variance proves --file e2e/signup.spec.ts --name 'retries a failed post' -- <command>...
```

With `<command>` the command that runs that one test, it breaks each region the
record says the test entered, one at a time, fewest other tests first, up to
`--limit` (20): a function returns nothing, a branch, continuation or handler
is skipped. The break is served to the processes the command starts, so
nothing in the checkout is written and the record stays as it was. A command
that fails with nothing broken is refused, and so is a checkout whose
`variance.config.json` names a `cacheRoot`: the runs would record into it.

`Survived` is a region the test passed with broken: its assertions read nothing
that region does, or the break changes nothing the test can see. The run cannot
tell those apart, so read the region before you write the assertion. `Noticed`
is a region the test checks. `Hung` is a region whose break kept the test
running past its deadline, five times the unbroken run and at least two
seconds, so it was stopped: neither a pass nor a failure. `Not broken` names
why a region was left alone: its source changed since the recording, it is past
the cap, or no process the command started read the file, which happens when a
bundler or the browser reads it rather than Node.

## Rules

- **Absent is not empty.** A refusal, an `unmeasured` distance or a `hole` is
  missing information, never *no test*.
- **The record is the last run.** After an edit to the test, its mocks or a file
  on its route, run it again before you quote its story or its coverage.
- **Every narrowing is a smaller claim.** The full suite is the only green that
  counts.
