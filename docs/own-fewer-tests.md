# Own fewer tests

Your suite only grows. Every test in it was justified when it was written, and a
merged coverage report cannot tell you which of them are still worth keeping: it
shows that a line ran, not which tests ran it, not whether six of them ran it
for the same reason. [Variance Authority](README.md) records the half coverage
drops: for each test case, which regions of your source that case covered. Point
at a line and it hands back the named cases that walked it, which is where the
question *why do all of these tests need this code?* starts having an answer.

The decision that sits on top of that reading is which tests to keep, where to
put them, and when to retire one. The reading never authorizes a
deletion on its own — execution shows where a test went, not which assertion or
risk made the trip worthwhile — so each section below pairs a reading with the
rerun that settles it.

Tests are evidence with different costs, scopes, and lifetimes. [On
testing](on-testing.md) relates those differences; within one suite, they govern
which tests remain owned.

## Ask which tests cover a line

Record case identities once. `withTestSelection` wraps a Vitest configuration
and keeps its plugins, setup files and reporters; every run writes an
[execution index](execution-record.md) naming which individual case covered each
region, beside the file-level snapshot the same run already writes.

```bash
npm install --save-dev @variance-authority/sense
```

```ts
import { defineConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';

export default withTestSelection(
  defineConfig({ test: { include: ['src/**/*.test.ts'] } }),
);
```

Run the suite the way you already run it, then ask about the line you are
considering:

```bash
npx variance covering --file src/cart/total.ts --line 14
```

```text
3 named tests covered line 14 of src/cart/total.ts:
  splits a discount — src/cart/total.test.ts [total.test.ts::splits a discount]
  renders a coupon — src/cart/Cart.test.tsx [Cart.test.tsx::renders a coupon]
  checks out — src/cart/flow.test.tsx [flow.test.tsx::checks out]
```

Every answer is a test you can open: the case's name, the file it is written in,
and the id the record stores for it. `--line 10-20` answers it for a run of
lines, and `--function <name>` for a whole function, or a class's methods by
the class's name. A line the record holds no finer than the file, such as a
module-level statement or the first line of a top-level function, is answered
with the cases that loaded the file, and the answer says so: a line that opens with `At file grain`, and `grain: "file"`
under `--format json`. An answer without it names the cases that entered the
region the line sits in. `--file` on its own answers the whole recorded
file at once, as ranges of lines that share the same cases — where a range with
an empty list is recorded and unreached, and a line outside every recorded
region produces no range at all, which is a different statement from nobody
reaching it. A range with an empty list where a run over another text has landed
since a case ran it is not unreached: the answer says which case ran it is not
known. `--format json` hands the same reading to whatever reads it next,
which is the form an agent needs when it is about to change a line and needs the
tests to run after.

The command reads no project configuration and finds the index where the
recorded run wrote it, so the question is one flag long; `--execution <path>`
names an index recorded somewhere else. A missing index is refused rather than
answered empty, because an empty list here reads as *no test covers this line* —
the sentence that gets a test deleted. `coveringTests` and `coveringTestsInFile`
from `@variance-authority/sense/test-selection` answer the same two questions in
process, for an editor or a script that needs the records rather than the text.

An answer that leaves the question open ends with a gap: the question, why it
stays open, and the run that closes it, counted in tests and test files when a record counts it. A line
held at file grain names the story of the three nearest tests, the Deep gear of
[FSD](reasoning.md#fast-smart-deep):

```text
…
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

A record made over a different version of the file than the one checked out,
a line written or a range edited since the recording, or a line a case ran over
where a run over another text has landed since, names a recorded run of the test
files `variance select` runs for the file instead, among them every
test file the record holds only in part. A record older
than the file means the file is new: the gap names the recorded test files
`variance select` runs for it, then `variance reach --since <commit>`, from the commit the record was
made at, which takes every file added since, new test files among them. The gap says what to
run rather than a runner command, since no suite declares one. Under `--format json` the same
gap is the answer's `gap`.

When the list is long, narrow it to the tests that sit near the code:

```bash
npx variance covering --file src/cart/total.ts --line 14 --at-distance 0-3
npx variance covering --file src/cart/total.ts --line 14 --in-package
```

`--at-distance` counts import hops from the file to the test's own file, and
takes a range: `0-3`, `2`, or `3-` for three and beyond. `--in-package` keeps
the tests written under the same `package.json`. Both print how many witnesses
survived the narrowing, so a filtered list never reads as a short one, and both
measure from one origin, so neither composes with `--since`.

One limit shapes how you read the list either way: anything a file covered
before its first case — imports, `beforeAll`, top-level evaluation — is
credited to every case in that file. A Jest, Rstest, Playwright or Storybook
suite wraps its own configuration the same way and records the same regions;
each writes the case axis against the unit it schedules, and
[what each host records](execution-record.md#what-each-host-records) is that
one table.

The list starts the conversation. It does not finish it, and the rest of this
page is about what finishes it. For one candidate test rather than a set of
them, [Distill](distill.md) separates what that test loaded, covered and
addressed, and names what it never witnessed.

The useful unit is not a test or a covered line. It is a decision the test can
change. Keep the smallest set of tests that can expose the risks you would act
on, at the boundaries that own those risks, for as long as those decisions
remain live.

## Ask what one test is made of

A flow test that checks out a cart also prices it, applies the coupon and
renders the summary, and each of those has a narrower test of its own. **Coverage
composition** shows what is left when you take its narrower tests away. That
subtraction only works region by region. Two coverage totals subtract to a
number, and a number cannot name the code only the flow test runs. The
command reads the same per-case index `withTestSelection` writes, from
[the section above](#ask-which-tests-cover-a-line):

```bash
npx variance ask test-composition --file src/cart/flow.test.tsx --name 'checks out'
```

```text
src/cart/flow.test.tsx  checks out: a footprint of 9 regions; 31 more are structure, run by more than half of the 412 recorded tests.

Pieces, smaller tests inside it, most shared first:
  src/cart/total.test.ts  splits a discount  (3 of its 3 regions inside it)
  src/cart/Cart.test.tsx  renders a coupon  (2 of its 2 regions inside it)

Pieces ran 5 of its 9 regions. The other 4 no piece ran:
Its own layer, in modules no piece ran:
  src/cart/checkout.ts:12-30  function submitOrder
  src/cart/checkout.ts:18-21  branch in submitOrder
Paths of a piece's modules only it takes; a test nearer that code would run them more cheaply:
  src/cart/total.ts:40-44  branch in applyDiscount
  src/cart/total.ts:47  branch in applyDiscount
```

The test's **footprint** is the regions it ran, less **structure**: regions more
than half the recorded tests ran, the setup and shared modules every test goes
through. A **piece** is a smaller test with at least nine tenths of its
footprint inside this one; a **whole** is a larger test holding at least nine
tenths of this one, and is listed after the pieces when one exists. Tests with
exactly the same footprint are neither: the answer gives their count on its
second line.

What no piece ran splits in two:

- **Its own layer** is regions in modules no piece ran: the code only this test
  witnesses, and the reason to keep it.
- **Paths of a piece's modules** are regions of a module a piece ran, on paths
  only this test takes. A narrower test could run them more cheaply, and that is
  usually where a unit test is missing.

### Connect the regions to test statements

[Cadence](test-level-coverage.md#which-test-statement-first-ran-a-region)
records which statement of the flow test first ran each region. It connects a
region in the composition answer to the test action that first ran it: pricing
the cart, applying a coupon, or submitting the order. Node runners mark a
hook's work separately; Playwright records `beforeEach` and `afterEach`
statements as case lines.

Composition compares the regions each test ran. Its footprint, pieces and own
layer depend on those sets; the statement lines add attribution to the
recording. `variance ask test-composition` lists the regions and their source
locations, rather than inserting annotations between the lines of your test.
For the sequence of calls and their repeats, read a [test
story](test-stories.md#why-the-journey-has-no-order).

Every count is execution, so a piece is a test that ran the same code, not one
that checks the same thing. A test that mocks a module runs none of it, and
reads as having nothing in common with the tests of that module. A test its
pieces explain completely is not redundant either: the order the flow calls its
parts in is not a region of any one part.

To settle it, break the code and see who fails. Change one line the pieces ran —
[`covering`](#ask-which-tests-cover-a-line) names the tests that ran it — and
run the pieces and the flow test against the same break:

- **A piece fails too.** The flow test is a second witness for that line, at a
  slower boundary.
- **Only the flow test fails.** It checks something there no piece checks, and
  it keeps its place.

A flow test with no own layer, where every break you try fails a piece too,
checks only how its parts are put together. Keep it if that order of calls is a
risk you act on. Otherwise it is the test to retire, or to cut down to the one
assertion about the order. For one candidate test read on its own rather than
against its pieces, [Distill](distill.md) separates what it loaded, covered and
addressed.

## Ask which code only distant tests run

Split a component into three files and change no test, then move two of the
files into a shared package. Coverage stays at 100%, and the shared package has
no test of its own: everything in it runs because a test in another package
imports it, often several imports away. `variance coverage --packages` reads
the same per-case [execution index](execution-record.md) the first section
records, and counts each workspace package by whose tests ran it:

```bash
npx variance coverage --packages
```

```text
which package's tests ran each package
                 ran    own tests  only others'         by
  packages/cli   8,020  100.0%     0             0.0%
  packages/help  2,069  88.9%      229           11.1%  packages/cli 229
run only by other packages' tests
  packages/help/src/  229  packages/cli 229
    tools/            210  packages/cli 210
      uses-of.ts      32   packages/cli 32
      uses.ts         28   packages/cli 28
```

A region is the package's own when one of its own tests ran it, whoever else
did too. The tree under the table walks the packages with the most regions only
other packages' tests ran down to their files, largest first, so the first file
it names is the first place to ask whether the package needs a test of its own.
A package is a workspace the root `package.json` names, and a file belongs to
the deepest one that holds it. A suite you keep at the repository root belongs
to `.`, so everything it runs in a package counts as another package's.

Owning a region is not testing it closely: a package's own flow test can reach a
helper four imports down. `--at-distance` counts each region by the nearest test
that ran it, in any suite, measured in import hops from that test's own file
(`0`) and the modules it imports directly (`1`) outward:

```bash
npx variance coverage --at-distance 0-1
npx variance coverage --at-distance 2-
```

```text
coverage at 818a2cec — 40,331 regions in 1,159 files the suites loaded, counted where the nearest test that ran the code is 0-1 import hops away; 2,204 regions run from no measured distance, in no band
  any suite                   24,163      59.9%
coverage at 818a2cec — 40,331 regions in 1,159 files the suites loaded, counted where the nearest test that ran the code is 2 or more import hops away; 2,204 regions run from no measured distance, in no band
  any suite                   10,100      25.0%
```

That is Variance Authority's own suite, which runs 90.4% of what it loads
without `--at-distance`. A quarter of it runs only from two or more imports
away: no test within one hop reaches it. The ranges split what ran: 59.9%,
25.0%, and the 2,204 regions (5.5%) that only a test the import walk could not
reach ran add up to the 90.4%. A test file the import graph does not hold at
all is left out of every range, never taken as near, and the heading counts it
too. The hops are measured on the tree as it is now, so a count under a range
is not compared with the count the suite recorded on the base branch.

The range composes with `--packages`, which is how you find the files:
`npx variance coverage --packages --at-distance 2-` lists, per package and then
file by file, the regions only another package's far tests ran. Neither reading
says a test is missing. Before you write one, change a region the tree names and
rerun the package's own tests: if none fails, nothing near pins that code. To
see what one test runs that no narrower test does, ask
[what that test is made of](#ask-what-one-test-is-made-of).

### Earned and accidental coverage

`--packages` also counts each suite twice over the same regions. A region is
**in** when a test of its own package ran it from at most one import hop: from
the test's own file or a module the test imports directly. It is **out** when
any other test ran it: another package's, or the package's own from further
away. In is earned coverage. Out and never in is accidental coverage: code that
ran on the way to something else, and no test of its own package within one
hop ran. A hop is any runtime import, so a test that reaches its subject through
an `index` re-export or a shared helper is two hops from it, and counts out.
Under `--at-distance` the band narrows the coverage above it, not in and out:
those count every test, since out is any test.

```text
in: its own package's tests within one import hop ran it · out: any other test did · accidental: out, never in
               regions  in             out            accidental
  chromium     29,797   466     1.6%   5,642   18.9%  5,408       18.1%
  integration  29,788   1,365   4.6%   6,109   20.5%  5,496       18.5%
  unit         39,849   23,596  59.2%  27,157  68.1%  11,971      30.0%
  any suite    40,368   24,145  59.8%  28,455  70.5%  12,347      30.6%
  2,204 accidental regions ran only under tests at no measured distance
```

In and out are two coverages, not two halves of one, and the target for each is
100%. A passing end-to-end suite says the product works, whatever it ran on the
way, so out at 100% is worth having. In at 100% puts each failure next to its
cause. Most of what the wider suites run is accidental. In Variance
Authority's own suite that is 5,496 of the 6,861 regions the integration suite
ran (80%) and 5,408 of the 5,874 the chromium suite ran (92%), against 11,971
of 35,567 for the unit suite (34%).

Accidental names a distance, not a verdict on the test. It rests on one
assumption: the farther a test is from the code it ran, the less that test is
about the code. Whether a test checks a region it ran is a separate question,
and only a break answers it: mutation testing across the suite, or, for one
region, the change-and-rerun above. A test the import walk could not place is
never in, and what only such tests ran is counted on the last line. The
comment `variance review --coverage` posts on a pull request carries the same
table under **Coverage by suite**.

## Ask what still holds since the code changed

A coverage number counts a region as run when a test called into it, but the
test may have run before the code changed. Edit `refund` after the suite ran
and the record still says a test ran it, though no test has run the `refund`
you have now. Ask `variance coverage`, or `variance coverage --packages` for
one row per package, and it reads which version of each file every test file
last ran over. A region counts as **over an older text** when every test that
ran it ran an older version of the file, and an edit since then touched the
region. A region at least one test ran in the version you have checked out
stays counted as run, and so does every region of a file nothing changed since
the tests ran:

```text
coverage at 277e4c8f, recorded at 0bb4c2ad — 5 regions in 2 files the suites loaded
  any suite        3  60.0%                        1 over an older text
    unit     unit  3  60.0%  recorded at 0bb4c2ad  1 over an older text
```

The heading names the commit the record was made at whenever it is not the one
you have checked out. The same part is counted on each suite row, on the
directory `--from` names, and on each `--packages` row, under own tests and
under others'. An edit touches a region when it changes what runs there. An
edit outside the region's lines only moves it, and an edit that does not reach
the region's code, such as a comment you add inside a function, leaves it run.
When the version a test ran cannot be found, because the record does not say
which commit each test file last ran at, or that version was neither kept nor
committed, the region counts as **not known**, and the reason is named once
under the table. Which version you have checked out is the
[source index](source-index.md)'s answer. In CI the index is the one your
pipeline published with `variance index`, and with none published every region
run counts as not known.

## Ask how many test files an edit would run

Coverage counts a region once whether one test file ran it or four hundred, and
the two ends of that count are different problems. A region only one test file
ran loses its coverage when that file is deleted or rewritten. A file that
hundreds of test files run sends all of them to every edit when a suite selects
by file, so [test selection](coverage-test-selection.md) saves nothing on it, and every
unrelated failure in those tests blocks the change. `--fan-in` reads both ends
from the same per-case [execution index](execution-record.md):

```bash
npx variance coverage --fan-in
```

```text
test files that called into each region
               test files  regions ran  one test file         median  p90  max
  e2e          55          5,871        2,894          49.3%  2       14   39
  integration  83          6,866        3,174          46.2%  2       11   54
  unit         1,001       35,729       9,983          27.9%  3       25   453
most regions only one test file ran
  file                                one test file  of ran
  packages/cli/src/commands/story.ts  154            158
most test files called into the file
  file                              test files  of the suites  of their time  by
  packages/core/src/format/hash.ts  523         45.9%          68.6%          e2e 39 · integration 31 · unit 453
selected whole beyond what its median region needs
  file                              beyond median  test files  median region  busiest region
  packages/core/src/format/hash.ts  485            523         38             523
```

That is Variance Authority's own suite, with each list cut to one row; the
command prints ten files per list, largest first. The count is test files,
because a test file is what a selection gives the runner, and a test file counts
once per region however many of its cases ran it. A region counts only when a
case called into it. What ran while the module was imported — the top-level
evaluation the limit [above](#ask-which-tests-cover-a-line) credits to every
case in the file — counts as loaded, not as run, so an import alone never makes
a region look covered. An edit also runs the test files that only loaded the
file, so every count is the least an edit runs;
`variance covering --file` names the test files that loaded it.

The table counts per region, which is what an edit runs when a suite selects
at a fine [precision](selecting.md#how-precisely-a-suite-selects): only the
test files that ran the changed region. A suite that selects by file runs every
test file that ran any region of the changed file, and that is the count the
lists give per file. The table gives, per suite kind, how many regions one test
file ran, and the median, 90th percentile and maximum of test files per region.
Each list is one problem, with its own fix:

- **Most regions only one test file ran.** The thin end. In unit code, one test
  file per region is normal, and it is enough when that test file fails on a
  break there. Change one of the regions and rerun that test file. If it fails,
  the region is checked, and the one thing left to decide is whether you would
  notice the test file being deleted. If it passes, nothing checks the region
  at all: that is the test to write.
- **Most test files called into the file.** The test files that ran any region
  of the file, as a share of the suites that recorded it and of their time. An
  edit to `hash.ts` above runs 46% of those test files and 69% of their time.
  Every flaky test in that set blocks
  every edit to the file, so stabilize those tests first. When the file is wide
  because of one busy region, the last list names the split.
- **Selected whole beyond what its median region needs.** A suite that selects by
  file runs every test file of a changed file, so one busy region makes the
  whole file wide. An
  edit to `hash.ts`'s median region needs 38 test files, and the file sends 523.
  The gap, 485, is the most a split could save: a file split in two still sends
  every test file that called into either part, so the gap is what selecting by
  region would save, and a split saves it only where the parts' callers part.
  `variance covering --file` names the test files behind each region, which is
  where to look for the cut.

None of the lists has a threshold, and none decides that a file is too thin or
too wide. Each is ordered, `--format json` lists every file under `fanIn`, and
`--format markdown` prints the same table and lists for a job summary. A count
is not a check, and under `--at-distance` it counts only the crossings in the
band, which an edit still exceeds. Before you add a test for a thin region or split a wide file,
change the code and rerun the tests the count names, and keep what fails.

## Do you need a test?

Add a test when its result can change what happens next. It might prevent a
regression from merging, distinguish two plausible implementations, protect a
contract another part of the system relies on, or make a failure local enough
to repair.

A test adds little when an existing test would fail for the same reason, at the
same useful time, and lead to the same action. Executing different lines is not
enough. Neither is asserting the same outcome a different way.

Ask four questions before adding one:

- What failure can this test reveal that the suite cannot already reveal?
- Why would that failure matter?
- Is this the cheapest boundary that can answer it without losing the real
  risk?
- What will make the test unnecessary?

The last question separates a permanent contract from temporary scaffolding
before both settle into the suite.

A distant failure is a useful prompt here. Name the risk it exposed, add a
nearer test at the boundary that owns that risk, and keep one downstream test
for the real join. Run both before treating an older case as redundant: path
distance can identify candidates, but it cannot show that two assertions detect
the same failure.

## Fan out where variation is the risk

Some behaviours genuinely need many cases. Parsers, permissions, state
machines, numerical boundaries and compatibility tables can each fail along
independent axes. Fan out when every case represents a different risk or
partitions the input space in a way the implementation could get wrong.

Do not fan out merely because the path accepts many values. If the cases take
the same route, establish the same promise and would prompt the same repair,
more examples increase maintenance without increasing the decision surface.
Use a representative case, a boundary case, or a generated property according
to the failure being sought.

The broad product path rarely needs to repeat the whole table. Prove the
variation where it is cheapest to control and diagnose, then keep enough
integration evidence to show that the real parts still compose. Kent Beck's
[Composable Tests](https://newsletter.kentbeck.com/p/composable-tests) shows
this shape for genuinely orthogonal dimensions; James Shore's [Testing Without
Mocks](https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks)
applies it through narrow, overlapping sociable tests.

## Social and solitary tests pay different bills

A [**social** test](https://martinfowler.com/articles/2021-test-shapes.html) uses
the real collaborators around the subject. It is good at
proving that contracts meet: routing reaches authorization, serialization
survives transport, or a browser action produces the product outcome. Its
reach is also its cost. A failure has more possible causes, and multiplying
cases repeats setup and composition that most cases are not trying to test.

A [**solitary** test](https://martinfowler.com/articles/2021-test-shapes.html)
replaces collaborators and concentrates on one unit's own
choices. It is the better place to fan out a decision table or exercise a large
set of edge cases. Its substitutes are a boundary: it cannot prove that the
real collaborators still agree.

Which collaborators get replaced is a question this page does not settle for
you. One school replaces at the module boundary, so every import of the subject
is a substitute; another replaces at the domain boundary, so the unit is a
cluster of types that belong together and only the network, the clock and the
database are stood in for. Both are solitary, and the argument between them is
about where a unit ends. What decides the count either way is the same: how many
pieces are in play when the test fails. A test with two moving parts names its
cause; a test with twenty offers you a list.

Use the two shapes together without cloning the same matrix at both levels. A
small number of social tests protect the joins and consequential paths. A
larger set of solitary tests earns its count only where the local variation is
itself the risk. Tests at two levels are not duplicates when they can fail for
different reasons and send the repair to different owners.

### A next step: let the test expose the seam

[Eyes](eyes.md) records the elements a test addresses during
[Arrange, Act and Assert (AAA)](eyes.md#read-the-test-at-the-level-it-was-written),
with their React owners when available. [Distill](distill.md) compares that
authored attention with the source the same test covered. When a broad social
test addresses one product path while neighbouring collaborators only load or
render, the difference exposes a boundary worth trying.

Apply that reading one test at a time to turn a broad suite into an intentional
mix. Keep a social test around the real joins. Move the local decision table
and edge cases into solitary tests that replace those collaborators. The social
path becomes cheaper, while the solitary cases can cover more variation
without repeating the whole composition. That can improve runtime and cover
more meaningful cases without increasing test code; removing duplicated setup
can reduce it.

The reading suggests a seam; the rerun proves it. Change one boundary and
check that the social test still proves the parts agree and the solitary tests
still witness the local decisions they own. A runner may establish mocks for a
whole test file. In that case, split the original file so its social tests keep
the real collaborators and its solitary tests can substitute them differently.

## Let a test have a lifetime

Not every useful test deserves permanent residence.

A reproduction test can hold a defect still while it is repaired. A migration
test can compare old and new behaviour while both implementations exist. A
burst of cases can explore a new rule while its boundaries are uncertain.
These tests start providing value immediately and can stop as soon as the
uncertainty, migration or defect-specific decision is gone.

Keep a test for the long term when it protects a durable promise or a failure
likely to recur. Put it with the owner of that promise, not with whichever line
happened to break. Implementations change; an API contract, policy rule or
product journey can survive several of them. A test placed at the enduring
boundary is less likely to become an accidental constraint on the old design.

Temporary tests need an exit condition, not a weaker name. Michael Feathers's
[pinch-point tests](https://www.pearson.com/en-us/subject-catalog/p/Feathers-Working-Effectively-with-Legacy-Code/P200000008984?view=educator)
make the same lifecycle explicit: broad protection can support a change until
narrower tests protect the boundaries being changed. Delete, merge or demote a
temporary test when its condition arrives. A suite that only adds evidence and
never retires it eventually spends most of its time reconfirming settled
questions.

## Value deteriorates

A test is valuable while it can reveal an actionable failure sooner or more
clearly than the alternatives. That value deteriorates when:

- another test protects the same promise more directly;
- the risk is now at a different boundary;
- the implementation can no longer fail in the way the test distinguishes;
- failures are routinely ignored, retried or diagnosed somewhere else;
- the assertion survives while the behaviour it was meant to protect no
  longer passes through the test; or
- maintenance, runtime and false alarms cost more than the decision it informs.

Age alone proves none of these. Nor does overlap. Two tests reaching the same
function may assert different promises, while two tests reaching different
code may still provide the same answer.

[Ask which tests cover a line](#ask-which-tests-cover-a-line) names the cases
that covered a region. The file-level [execution record](execution-record.md)
answers the same question by test file, and shows how much source each test
loads with it. [Ask what one test is made
of](#ask-what-one-test-is-made-of) names the narrower tests inside one test, and
the code only it runs. [Ask how many test files an edit would
run](#ask-how-many-test-files-an-edit-would-run) names the code one test file
covers and the files whose every edit runs hundreds of test files. Each reading identifies
a conversation rather than a verdict.

Kent Beck's [Programmer Test
Principles](https://medium.com/@kentbeck_7670/programmer-test-principles-d01c064d7934)
uses determinism and prediction as the test for noisy feedback. Meta's work on
[probabilistic
flakiness](https://engineering.fb.com/2020/12/10/developer-tools/probabilistic-flakiness/)
treats reliability as a property that can deteriorate over time. Neither makes
age or one failure a deletion rule; both make continued signal the question.

For one candidate, [Distill](distill.md) can show what it loaded, covered and
addressed. Change one boundary and rerun the exact test before keeping a smaller
version. For several candidates protecting the same promise, remove or merge
one at a time and check that the remaining suite still fails for the risks each
candidate was written to cover.

## The portfolio test

For every retained test, be able to finish this sentence:

> We keep this test because it is the cheapest credible way to reveal ___ while
> that risk remains owned by ___.

If several tests complete it with the same failure, timing and owner, the suite
probably owns too many. If none completes it for an important promise, the
suite owns too few. The goal is not fewer executions regardless of cost. It is
fewer tests with more distinct reasons to exist.

---

**Further:** [`run-relevant-work.md`](run-relevant-work.md) for selecting the
tests an edit needs now · [`optimize-a-test.md`](optimize-a-test.md) for making
one retained test cost less · [`better-tests.md`](better-tests.md) for how
selection, stability and distillation reinforce one another.
