# Tests preserve the paths we care about

A test turns one path through a product into a repeatable proof. When the same
starting conditions and action still produce the expected outcome, the test
earns confidence that this promise has been preserved.

## Confidence is specific

Each test protects one codified path under the conditions it observed.
Confidence grows from important paths being preserved, not from the number of
tests or the size of a green bar. That proof lets an engineer refactor beneath
stable behaviour, a team state what must remain true, and an agent reproduce the
promise instead of relying on an instruction to “be careful.”

## High level is a strength — and a blind spot

Good tests describe behaviour at a level that survives implementation changes.
They do not fail because a function moved, a component was wrapped, or the same
outcome took another internal route. [Test Desiderata](https://testdesiderata.com/)
names this balance through properties such as behavioural,
structure-insensitive, readable, specific and predictive.

The same restraint creates a blind spot. A high-level assertion can pass while
presentation, execution, component state, dependencies, or an unasserted part
of the interface changed. That can be harmless, intentional, or damage. The
pass alone cannot distinguish them.

## Confidence has a boundary and a bill

A test costs what it takes to write, execute, understand and maintain. A fast
test with an obscure failure can be expensive. A slower test can earn its place
when it protects a consequential path no cheaper observation can prove.

Spend that effort where it buys confidence:

- **Protect promises that matter.** Consider how easily a behaviour could break,
  what its failure would cost, and how late someone would otherwise notice.
- **Add cases that address another risk.** A boundary, permission or recovery
  path can expose a failure the happy path misses. Another example earns its
  place when it tells you something the existing cases do not.
- **Choose the level that can answer the question.** Exercise calculation cases
  close to the logic; use integration tests to check the contracts between
  parts, and product journeys to check that those parts deliver the promise.
- **Keep the protection while the risk remains.** A migration rehearsal may
  serve one change. A regression test can protect against the same mistake for
  years. Its lifetime follows the promise, even as implementations come and go.

Coverage answers whether an execution reached code. It does not establish that
the test noticed the behaviour that matters, would fail when that behaviour
breaks, or explains the cause when it does. A suite can execute every line and
leave its important promises untested.

Adding assertions for every nuance increases the work, couples the test to
details, and turns unrelated changes into failures. Add tests while they
materially improve confidence in the changes ahead. When the next test mostly
repeats what the suite already tells you, look for a risk it still leaves open
before adding to the count.

## An agent needs both answers

After changing code, an agent needs proof that it **did not break the codified
path**. That is the test's answer. It also needs proof that it **did change the
thing it intended to change**. A passing test cannot provide that second answer
when the intended effect sits outside its assertion.

Neither answer substitutes for the other. Preserving the path while producing
no effect means the work did not land. Producing the effect while breaking the
path means it landed badly.

## Variance gives the test a second answer

Variance Authority helps you learn more from the tests worth keeping. It observes
beside the assertion, retaining what changed in the interface, execution,
component state and source. Visual regression establishes the correlated effect.
Divergence finds where two readings first parted. Provenance and composition
connect that fork to its cause and to every observed subject it reached.

The test remains a readable, behavioural, structure-insensitive statement.
Variance does not turn every nuance into a failure; it makes the nuance
available when a person or agent needs to understand the result. Where the run
recorded the whole chain, the same test can say both: **the promised path still
holds, and this is the change the edit produced.** Where evidence ends, the
explanation says so.

Start where the current cost or uncertainty is visible.

<div class="doc-link-grid doc-link-grid--capabilities">
<a class="doc-link-card doc-link-card--compact" href="better-tests.md">
<span>Improve</span>
<strong>Make the suite earn its cost</strong>
<p>Keep useful work and evidence; remove work that serves no decision.</p>
<em>Build better tests →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="run-relevant-work.md">
<span>Select</span>
<strong>Run what the change can reach</strong>
<p>Use source reach and recorded execution to choose the work that matters.</p>
<em>Run relevant work →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="evidence-field.md">
<span>Understand</span>
<strong>Ask more of a run</strong>
<p>Read source, execution, interface and history without forcing one pipeline.</p>
<em>Use the available evidence →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="explain-variance.md">
<span>Explain</span>
<strong>Connect effect, cause and impact</strong>
<p>Find where readings parted, what caused the fork, and how far it reached.</p>
<em>Explain variance →</em>
</a>
</div>

The [reasoning loop](reasoning.md) shows how a question becomes a bounded
observation. If durable rendered comparison is the decision in front of you,
[observe one state](start.md) follows it through capture, review and explicit
acceptance.
