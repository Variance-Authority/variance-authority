# Own fewer tests

Your suite only grows. Every test in it was justified when it was written, and a
merged coverage report cannot tell you which of them are still worth keeping:
it says a line ran, not which tests ran it, not whether six of them ran it for
the same reason. [Variance Authority](README.md) records the half coverage drops:
for each test case, which regions of your source that case entered. Point at a
line and it hands back the named cases that walked it, which is where the
question *why do all of these tests need this code?* starts having an answer.

This page is the decision that sits on top of that reading: which tests to keep,
where to put them, and when to retire one. The reading never authorizes a
deletion on its own — execution says where a test went, not which assertion or
risk made the trip worthwhile — so each section below pairs a reading with the
rerun that settles it.

## Ask which tests claim a line

Record case identities once. `withTestSelection` wraps a Vitest configuration
and keeps its plugins, setup files and reporters; `cases: true` writes an
[execution index](execution-record.md) naming which individual case entered each
region, beside the file-level snapshot the same run already writes.

```bash
npm install --save-dev @variance-authority/sense
```

```ts
import { defineConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';

export default withTestSelection(
  defineConfig({ test: { include: ['src/**/*.test.ts'] } }),
  { cases: true },
);
```

Run the suite the way you already run it, then ask about the line you are
considering:

```bash
npx variance covering --file src/cart/total.ts --line 14
```

```text
3 named tests reached line 14 of src/cart/total.ts, nearest first where the index carries a depth:
  depth 0 — splits a discount — src/cart/total.test.ts [total.test.ts::splits a discount]
  depth 0 — renders a coupon — src/cart/Cart.test.tsx [Cart.test.tsx::renders a coupon]
  depth 0 — checks out — src/cart/flow.test.tsx [flow.test.tsx::checks out]
```

Every answer is a test you can open: the case's name, the file it is written in,
and the id the record knows it by. `--function <name>` asks the same question
about a whole function. `--file` on its own answers the whole recorded file at
once, as ranges of lines that share the same cases — where a range with an empty
list is recorded and unreached, and a line outside every recorded region
produces no range at all, which is a different statement from nobody reaching
it. `--format json` hands the same reading to whatever asks next, which is the
form an agent wants when it is about to change a line and needs the tests to run
after.

The command reads no project configuration and finds the index where the
recorded run wrote it, so the question is one flag long; `--execution <path>`
names an index recorded somewhere else. A missing index is refused rather than
answered empty, because an empty list here reads as *no test covers this line* —
the sentence that gets a test deleted. `coveringTests` and `coveringTestsInFile`
from `@variance-authority/sense/test-selection` answer the same two questions in
process, for an editor or a script that wants the records rather than the text.

Two limits shape how you read the list. Anything a file entered before its
first case — imports, `beforeAll`, top-level evaluation — is credited to every
case in that file. And this recorder writes every crossing at depth zero rather
than inventing a call-stack distance it did not observe, so the order is by
identity; the file-level [execution record](execution-record.md) stores real
distance instead, and an index from another producer that measured depth sorts
nearest first. Turn cases on for a local loop over the code you are changing,
not for the repository-wide index CI reads to select files. A Jest suite wraps
its own configuration the same way and records the same regions against test
files; the case axis is the Vitest integration.

The list starts the conversation. It does not finish it, and the rest of this
page is about what finishes it. For one candidate test rather than a set of
them, [Distill](distill.md) separates what that test loaded, entered and
addressed, and names what it never witnessed.

The useful unit is not a test or a covered line. It is a decision the test can
change. Keep the smallest set of tests that can expose the risks you would act
on, at the boundaries that own those risks, for as long as those decisions
remain live.

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
integration evidence to show that the real parts still compose.

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
authored attention with the source the same test entered. When a broad social
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

Temporary tests need an exit condition, not a weaker name. Delete, merge or
demote them when the condition arrives. A suite that only adds evidence and
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

[Ask which tests claim a line](#ask-which-tests-claim-a-line) names the cases
that entered a region. The file-level [execution record](execution-record.md)
answers the same question by test file, adds the call-stack depth each test
stood at, and says how much source that test pulls in with it. Both readings
identify a conversation rather than a verdict.

For one candidate, [Distill](distill.md) can show what it loaded, entered and
addressed. Change one boundary and rerun the exact test before keeping a smaller
version. For several candidates protecting the same promise, remove or merge
one at a time and check that the remaining suite still fails for the risks each
candidate claimed to own.

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
