# Tests are evidence for a decision

A test is a repeatable question asked of software. Its result is evidence for a
decision about the product or a change — useful only to the extent that the
question, observation and limit survive the run. Variance Authority follows
that evidence from a visible regression to the point two readings diverged,
then outward to cause and impact.

## A test makes a promise

A passing test does not say that the software is correct. It says that one
question received the expected answer under the conditions the test observed.
The strength of that answer depends on what the test can notice, what it holds
still, and whether a failure explains enough to act.

That is the purpose of a test: reduce uncertainty for a decision somebody will
have to make. The decision may be whether a product behaviour is fit to ship,
where an engineer should look after a failure, or whether an agent has enough
evidence and authority to change code. The same execution can serve all three,
but a bare pass or fail rarely carries enough context to do so.

## The bill is larger than runtime

A test costs what it takes to write, execute, understand and maintain. A fast
test with an obscure failure can be expensive. A slower test can earn its place
when it catches a consequential change no cheaper observation can see.

[Test Desiderata](https://testdesiderata.com/) gives useful names to the
qualities involved: fast, readable, behavioural, specific, predictive and
more. They are trade-offs, not a universal scorecard. Some reinforce each
other; some compete. The right balance comes from the decision the test exists
to support.

## Coverage can tell the truth and still mislead

Coverage answers whether an execution reached code. It does not establish that
the test noticed the behaviour that matters, would fail when that behaviour
breaks, or explains the cause when it does.

A suite can execute every line and leave its important promises untested.
Coverage remains useful for finding untouched code, selecting relevant work and
locating missing observations. It becomes misleading when its percentage is
treated as confidence in the product.

## See the effect, find the fork, follow the impact

Visual regression catches a correlated effect: two readings differ. A changed
pixel can prove the effect, but it cannot prove its cause.

Divergence compares what each component was handed, what it retained, and what
it produced. It finds where the readings first parted. From that fork,
provenance follows the effect through semantic structure, component, state and
source; composition shows every observed subject that shares it; execution
evidence shows the path it travelled.

Causation runs forward through evidence the run recorded. Where a hop was not
observed, the explanation stops. Where the chain is present, the result names a
cause and its impact at every available depth — enough for a product decision,
an engineer to fix it, or an agent to act within the evidence.

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
