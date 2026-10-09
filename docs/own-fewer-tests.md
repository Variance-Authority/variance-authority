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
and the id the record stores for it. `--function <name>` answers the same
question for a whole function. `--file` on its own answers the whole recorded
file at once, as ranges of lines that share the same cases — where a range with
an empty list is recorded and unreached, and a line outside every recorded
region produces no range at all, which is a different statement from nobody
reaching it. `--format json` hands the same reading to whatever reads it next,
which is the form an agent needs when it is about to change a line and needs the
tests to run after.

The command reads no project configuration and finds the index where the
recorded run wrote it, so the question is one flag long; `--execution <path>`
names an index recorded somewhere else. A missing index is refused rather than
answered empty, because an empty list here reads as *no test covers this line* —
the sentence that gets a test deleted. `coveringTests` and `coveringTestsInFile`
from `@variance-authority/sense/test-selection` answer the same two questions in
process, for an editor or a script that needs the records rather than the text.

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
renders the summary, and each of those has a narrower test of its own. What the
flow test adds is what is left when you take its narrower tests away. That
subtraction only works region by region. Two coverage totals subtract to a
number, and a number cannot name the code only the flow test runs.
[Distill](distill.md) reads one test against what it loaded; this reads one test
against the narrower tests inside it.

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

Every count is execution, so a piece is a test that ran the same code, not one
that checks the same thing. A test that mocks a module runs none of it, and
reads as having nothing in common with the tests of that module. A test its
pieces explain completely is not redundant either: the order the flow calls its
parts in is not a region of any one part.

To settle it, break the code and see who fails. Change one line the pieces ran —
[`covering`](#ask-which-tests-cover-a-line) names the tests that ran it — and
run only the pieces. A piece that fails catches what the flow test catches
there, at a cheaper boundary. A break that only the flow test catches is one
the reading cannot see, and the flow test keeps it.

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
the code only it runs. Each reading identifies a conversation rather than a
verdict.

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
