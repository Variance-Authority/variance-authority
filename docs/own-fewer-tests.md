# Own fewer tests

One line of product code can sit beneath a hundred tests. That may mean a
hundred distinct promises depend on it. It may also mean the suite has repeated
the same answer at every layer and kept every repetition forever.

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
enough. Neither is asserting the same outcome through another spelling.

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

Use the two shapes together without cloning the same matrix at both levels. A
small number of social tests protect the joins and consequential paths. A
larger set of solitary tests earns its count only where the local variation is
itself the risk. Tests at two levels are not duplicates when they can fail for
different reasons and send the repair to different owners.

## Let a test have a lifetime

Not every useful test deserves permanent residence.

A reproduction test can hold a defect still while it is repaired. A migration
test can compare old and new behaviour while both implementations exist. A
burst of cases can explore a new rule while its boundaries are uncertain.
These tests start providing value immediately and can stop as soon as the
uncertainty, migration or defect-specific decision is gone.

Keep a test for the long term when it protects a durable promise or a failure
likely to recur. Put it with the owner of that promise, not with whichever line
happened to break. Implementations move; an API contract, policy rule or
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
- the risk moved to a different boundary;
- the implementation can no longer fail in the way the test distinguishes;
- failures are routinely ignored, retried or diagnosed somewhere else;
- the assertion survives while the behaviour it was meant to protect no
  longer passes through the test; or
- maintenance, runtime and false alarms cost more than the decision it informs.

Age alone proves none of these. Nor does overlap. Two tests reaching the same
function may assert different promises, while two tests reaching different
code may still provide the same answer.

Use the [execution record](execution-record.md) to find which tests entered a
region and how much source each test carries with it. Use
[source-to-test lookup](../packages/sense#find-tests-that-cover-source) when a
producer supplies individual test identities. Those readings identify a
conversation: why do all of these tests need this code? They do not authorize
deletion, because execution says where a test went, not which assertion or risk
made the trip worthwhile.

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
suite owns too few. The goal is not fewer executions at any cost. It is fewer
tests with more distinct reasons to exist.

---

**Further:** [`run-relevant-work.md`](run-relevant-work.md) for selecting the
tests an edit needs now · [`optimize-a-test.md`](optimize-a-test.md) for making
one retained test cost less · [`better-tests.md`](better-tests.md) for how
selection, stability and distillation reinforce one another.
