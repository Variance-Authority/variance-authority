# Tests preserve the paths we care about

A test turns one path through your product into a repeatable proof: the same
starting conditions, the same action, the outcome you expected. What you earn is
confidence that this one promise has been preserved under the conditions the
test observed. That is worth stating precisely, because it is also the boundary
of what a green run can tell you.

## Confidence is specific

Each test protects one codified path under the conditions it observed.
Confidence grows as the paths that matter stay preserved, not as the count of
tests or the width of the green bar grows. That proof is what lets you refactor
beneath stable behaviour, state to your team what has to remain true, and hand a
coding agent something it can reproduce instead of an instruction to be careful.

## High level is a strength, and a blind spot

You want tests that describe behaviour at a level that survives implementation
changes — that do not fail because a function moved, a component was wrapped, or
the same outcome took another internal route. [Test
Desiderata](https://testdesiderata.com/) names that balance through properties
such as behavioural, structure-insensitive, readable, specific and predictive.

The same restraint creates the blind spot. A high-level assertion passes while
presentation, execution, component state, dependencies, or an unasserted part of
the interface changed. That can be harmless, intended, or damage, and the pass
alone cannot separate the three.

The pass has answered the question it was written to answer. To ask what changed
beside that promise, keep [the middle of the change](changed.md#the-middle-carries-the-explanation)
rather than weakening the assertion until it notices everything.

## Confidence has a boundary and a bill

A test costs what it takes to write, execute, understand and maintain. A fast
test with an obscure failure is expensive. A slower test earns its place when it
protects a consequential path no cheaper observation can prove.

Spend that effort where it buys confidence:

- **Protect the promises that matter.** Weigh how easily a behaviour could
  break, what its failure would cost, and how late you would otherwise notice.
- **Add cases that address another risk.** A boundary, permission or recovery
  path exposes a failure the happy path misses. Another example earns its place
  when it tells you something the existing cases do not.
- **Choose the level that can answer the question.** Exercise calculation close
  to the logic, use integration tests for the contracts between parts, and
  product journeys for whether those parts deliver the promise.
- **Keep the protection while the risk remains.** A migration rehearsal may
  serve one change; a regression test can hold the same mistake off for years.
  Its lifetime follows the promise, even as implementations come and go.

Coverage settles none of this. It answers whether an execution reached code, not
whether the test noticed the behaviour that matters, would fail when that
behaviour breaks, or can explain the cause when it does. A suite can execute
every line and leave its important promises untested.

Adding an assertion for every nuance increases the work, couples the test to
details, and turns unrelated changes into failures. Add tests while they
materially improve confidence in the changes ahead; when the next one mostly
repeats what the suite already tells you, look for a risk it leaves open before
adding to the count.

## After a change, you need both answers

You need proof that you did not break the codified path — that is the test's
answer — and proof that you did change the thing you meant to change. A passing
test cannot supply the second one when the intended effect sits outside its
assertion.

Neither substitutes for the other. Preserving the path while producing no effect
means the work did not land. Producing the effect while breaking the path means
it landed badly.

[Seeing what changed](changed.md) is the companion question, and
[Variance Authority](README.md) answers it from what a run recorded beside your
assertion — so the second answer does not become another assertion this test
has to carry.
