# On testing

A test earns its place by producing credible information soon enough to change a
decision. Its level, speed, coverage and age matter through that job. A suite is
not strong because it owns many tests or because each test is small. It is
strong when each important risk has evidence at the cheapest boundary that can
still expose the real failure, and when you can tell what each test adds.

[David Heinemeier Hansson gave one failure mode a direct
name](https://dhh.dk/2014/test-induced-design-damage.html): test-induced design
damage. Production code should not acquire indirection only to make isolated
tests easier to write or faster to run. But the alternative is not an
unaffordable suite. Kent Beck, James Shore, Google, and three decades of
test-reduction research point to a more useful question: what evidence belongs
at which boundary, and what decision does it change?

[Variance Authority](README.md) records the [execution](execution-record.md),
[attention](eyes.md), [distance](distance.md), and [history](history.md) that
make those choices inspectable. It never converts a metric into permission to
delete a test. Each decision still belongs to the person who can name the risk;
the readings show which evidence can inform it.

## Tests are feedback, not inventory

[Kent Beck's account of testing at
Facebook](https://softwareengineeringdaily.com/wp-content/uploads/2019/08/SEDFB15-Facebook-Process-Kent-Beck.pdf)
describes tests that failed while the site remained healthy. The tests did not
predict the production outcome, so the team deleted them instead of teaching
people to ignore the signal. Facebook also had code review, staged rollout,
logging, production awareness, and incident review. The deletion made sense
inside that larger feedback system, not as a rule that tests do not matter.

Beck's later [Programmer Test
Principles](https://medium.com/@kentbeck_7670/programmer-test-principles-d01c064d7934)
makes the boundary explicit: programmer tests should be deterministic and
predictive. Delete a nondeterministic test; if the lost coverage matters,
redesign the code for testability and write a deterministic test again. The
point is the quality of the feedback, not the continued existence of the file.

[Test Desiderata](https://testdesiderata.com/) gives the same decision more
dimensions. A useful test may need to be behavioural, structure-insensitive,
specific, and predictive, but those properties trade against one another. A
high-level test can survive a refactor and still leave several possible causes
when it fails. A narrow test can name the cause and still miss a disagreement
between real collaborators.

Each test protects one codified path under the conditions it observed.
Confidence grows as the paths that matter stay preserved, not as the count of
tests or the width of the green bar grows. That proof lets you refactor beneath
stable behaviour and gives a coding agent something it can reproduce. Its
boundary matters just as much: a passing assertion does not establish that
presentation, execution, component state, dependencies, or an unasserted part
of the interface stayed the same. [See what changed](changed.md) keeps those
other readings available without making one test assert everything.

## Size and scope are different decisions

Google's testing chapter separates [test size from test
scope](https://abseil.io/resources/swe-book/html/ch11.html). Size is the
resources a test needs: time, memory, processes, machines, and network access.
Scope is how much code and behaviour the test verifies. Executing a line is
also different from verifying that it worked.

Those distinctions stop a performance problem from silently becoming a design
rule. A broad test may be slow because its setup is wasteful, or because the
real contract crosses several parts. A narrow test may be fast because it
isolates one decision, or because it replaced the collaborator that carried the
risk. Runtime does not tell you which case you have.

Hansson's companion argument about the [slow database test
fallacy](https://dhh.dk/2014/slow-database-test-fallacy.html) is a useful
warning against designing from an assumed cost. Measure the loop you have.
Remove setup that buys no evidence. Keep the real dependency where replacing it
would change the question. [Make one test cost less](optimize-a-test.md) applies
that distinction to one test and verifies each smaller boundary with a rerun.

## Put variation where it can fail

When two dimensions are genuinely orthogonal, repeating every combination at
the broadest level pays for composition many times. Beck's [Composable
Tests](https://newsletter.kentbeck.com/p/composable-tests) gives an illustrative
shape: test four computation variants, test five reporting variants, then keep
one test proving that computation and reporting compose. The matrix changes
from twenty combinations to ten tests only when the two dimensions can be
reasoned about independently.

James Shore's [Testing Without
Mocks](https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks)
arrives at a similar structure from sociable tests. Test a collaborator's
variation where that collaborator owns it. Test its caller with the real
collaborator, narrowly enough to prove the join without copying the
collaborator's whole table. Keep narrow integration tests for real external
communication and a small number of whole-system smoke tests.

This is not a universal preference for unit tests, mocks, or integration tests.
It is a placement rule. Fan out where variation is the risk. Keep composition
evidence where real contracts meet. Tests at two levels are not duplicates when
they fail for different reasons and send the repair to different owners. [Own
fewer tests](own-fewer-tests.md#fan-out-where-variation-is-the-risk) turns that
rule into a retention decision over one suite.

## Coverage opens the question; it does not close it

Coverage-based test reduction has a long research history. Harrold, Gupta, and
Soffa described [selecting a representative subset that preserves chosen
testing requirements](https://dl.acm.org/doi/10.1145/152388.152391). That can
identify tests that are redundant with respect to the chosen requirement. It
does not establish that the subset preserves the same confidence or fault
detection.

Rothermel, Harrold, von Ronne, and Hong found the missing qualification in
[empirical studies of test-suite
reduction](https://onlinelibrary.wiley.com/doi/10.1002/stvr.256): in the studied
subjects, criterion-preserving reduction could still severely reduce fault
detection. Inozemtseva and Holmes later measured [coverage against test-suite
effectiveness](https://cs.uwaterloo.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf)
across generated suites for five Java systems. After controlling for suite
size, coverage had only low-to-moderate correlation with mutation-based
effectiveness. Their conclusion keeps coverage useful for finding under-tested
code and rejects it as a quality target.

Execution evidence can tell you which tests covered the same region. It cannot
tell you whether they protect the same promise, notice the same fault, or lead
to the same action. [Test-level coverage](test-level-coverage.md) keeps the
named test-to-region relation so you can open the cases and ask those questions.
It refuses to answer them from overlap alone.

The vocabulary also matters. Yoo and Harman's [survey of regression testing
techniques](https://onlinelibrary.wiley.com/doi/10.1002/stvr.430) separates
minimization, selection, and prioritization. Minimization changes the suite you
own. Selection chooses the tests relevant to a change. Prioritization decides
which tests run first. A faster selection does not prove that the suite owns the
right tests, and a smaller suite does not prove that the next run should execute
all of them.

## Let tests have lifetimes

Some tests protect durable contracts. Others support a decision that ends. A
reproduction test can keep a defect visible while it is repaired. A migration
test can compare two implementations while both exist. A broad characterization
test can protect a change while narrower tests are being placed.

Michael Feathers describes [pinch points in legacy
code](https://www.pearson.com/en-us/subject-catalog/p/Feathers-Working-Effectively-with-Legacy-Code/P200000008984?view=educator):
a narrow place where one test can observe effects from a larger region. That
broad protection can be temporary. Once narrower tests support the code at the
boundaries being changed, the pinch-point test may no longer inform a distinct
decision.

Age does not decide the lifetime. Neither does overlap. The exit condition is
that the uncertainty, migration, or defect-specific decision has ended, or that
another test now protects the same promise sooner and more clearly. Meta's work
on [probabilistic
flakiness](https://engineering.fb.com/2020/12/10/developer-tools/probabilistic-flakiness/)
treats test reliability as something that changes over time because unreliable
tests erode trust in the regression process. A test can remain in the suite and
still stop doing its job.

## Cost calls for better selection, not weaker proof

Large systems cannot run every useful test after every edit. That constraint
has produced [predictive test selection at
Facebook](https://arxiv.org/html/1810.05286), [continuous-testing workload
control at Google](https://research.google/pubs/taming-google-scale-continuous-testing/),
and [economic models for testing less at
Microsoft](https://www.microsoft.com/en-us/research/publication/the-art-of-testing-less-without-sacrificing-quality/).
The systems differ, but each treats execution as a decision under limited time
rather than a sacred requirement to run everything on every change.

Variance Authority takes a narrower position on the evidence used for that
decision. It joins source relationships with [recorded
execution](coverage-test-selection.md) and gives a reason for each selected or
excluded test. A test with no complete recording
runs, so missing evidence never becomes a skip. [Run relevant work](run-relevant-work.md) is the
task-level route, and [select the tests that matter](selecting.md) is the exact
selection contract.

Selection changes what runs now. It does not change what the suite owns, which
risk a test protects, or whether an assertion remains credible. Those are
separate decisions because they need different evidence.

### History is conditional on the workflow that produced it

Historical outcomes describe only the changes and tests that reached the
recorder. Facebook's [predictive-selection
paper](https://arxiv.org/html/1810.05286) says developers typically run a few
hand-picked tests before creating a review diff, while its classifier learns
from outcomes on changes submitted to continuous integration. It follows that a
failure found and repaired before the first diff is absent from that history.
The model estimates residual risk after the observed development loop, not
every failure an unfiltered edit could cause. Meta later reported that
[running tests in the editor before review](https://engineering.fb.com/2021/02/17/developer-tools/fix-fast/)
returned feedback sooner and reduced post-commit failures: the earlier loop
changes what the later one gets to observe.

When a distant consumer test is the first to expose a local regression, the
useful response is not only to keep running that test forever. Name the risk it
observed, place the cheapest credible detector at the boundary that owns that
risk, and retain enough downstream evidence to prove that the real parts still
compose. Then rerun both. The nearer test improves feedback only if it exposes
the same failure; the downstream test remains valuable when it protects a
different decision.

That suggests a diagnostic beyond selection depth: **observed detection
distance**, the distance from an edit to the nearest test that actually failed
for that version. A large value is a prompt to ask why the owning boundary had
no nearer detector. It is not a reason to skip the farther test. Variance
Authority's [execution record](execution-record.md) cannot reconstruct this
history: it keeps witnessed crossings, completeness and a commit position, not
a sequence of verdicts and intervening edits. Its
[distance](distance.md) orders recorded paths; it does not measure which test
can detect a fault.

## Choose the next question

Start with the decision you control:

- [Own fewer tests](own-fewer-tests.md) when several tests may protect the same
  promise, or when a temporary test may have finished its job.
- [Run relevant work](run-relevant-work.md) when the suite is valuable but every
  edit does not need all of it.
- [Make one test cost less](optimize-a-test.md) when a retained test loads or
  initializes more than its promise needs.
- [Trace instability to its owner](flakiness.md) when a failure has stopped
  producing trustworthy feedback.
- [Record test-level coverage](test-level-coverage.md) when you need the named
  cases behind a line rather than one merged percentage.

Each reading narrows a question. None replaces the decision about what failure
matters, who owns it, and which evidence would change what happens next.
