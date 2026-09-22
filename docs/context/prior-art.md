# Prior art — who else measured this

Every position on the product pages is a claim about the world, and for most of
them somebody has already run the experiment. This file is the map: work that
shares a field with this one, what it found, and which of our claims it
supports, contradicts, or leaves standing.

It holds **no measurements of ours**. A number here belongs to the work beside
it and is a pointer to go and read, not evidence this project produced — which
is why it is not mixed with the journal, where a measurement arrives with the
command that made it ([README](README.md)).

Five fields touch this project, and only one of them is the one people assume.

| Field | Its question | Our page |
| --- | --- | --- |
| Test-to-code traceability | Which unit is this test *about*? | [`composition.md`](../composition.md) |
| Regression test selection | Which tests need to run for this change? | [`selecting.md`](../selecting.md), [`source.md`](../source.md) |
| Flake detection | Is this failure about the change? | [`flakiness.md`](../flakiness.md) |
| Fault localization | Which line caused it? | [`attribution.md`](../attribution.md) |
| Coverage adequacy | Is this suite good enough? | [`better-tests.md`](../better-tests.md), [`tests.md`](../tests.md) |

## Test-to-code traceability

**Van Rompaey & Demeyer (CSMR 2009)** is the origin. It put the candidate
signals side by side and measured them: naming convention and its
contains-variant, last call before assert, longest common subsequence,
Levenshtein distance, and static call graph. The finding that survived is that
naming has high precision and poor recall, and no single signal is adequate
alone.

**TCTracer** (White & Krinke, EMSE 2022; earlier at ICSE 2020) is that work
carried forward with two additions. It combines the signals into an ensemble —
and the ensemble beats every individual technique on every project — and it
makes method-level and class-level links **reinforce each other** rather than be
computed separately.

**SCOTCH+** (Qusef, Bavota, Oliveto, De Lucia, Binkley) replaces *last call
before assert* with a **dynamic backward slice from the assertion statements**.
It is the strictly better form of the same intuition, and it is the one within
reach here: our probes already record how a block was reached, so the stack
standing at an assertion is available rather than inferred from call order.

**Ghafari et al. (SCAM 2015)** named the *focal method* — the method under
assertion — and that vocabulary is what the later corpora standardized on.
**Methods2Test** (Microsoft, MSR 2022) is the largest of them: mined JUnit test
methods paired with focal methods, with the mining heuristics published so their
errors are inspectable.

**What it means here.** The dragon rule ([`variations.md`](../variations.md),
ADR-0045, ADR-0046) is a naming-convention link — Van Rompaey's first signal,
applied to subject-and-parent instead of test-and-unit. That is deliberate and
it is also the entire extent of the idea in this codebase: nothing links an
assertion to the code it asserts on.

## Regression test selection

**Ekstazi** (Gligoric, Eloussi, Marinov, ISSTA 2015) is the reference dynamic
selector, and its result is the uncomfortable one. **File-level granularity
outperformed method-level in practice**, because tracking finer dependencies
costs more than the extra selection saves. Our selection output is test-file
paths and the runner executes every test inside a selected file; Ekstazi says
that is likely the right engineering answer rather than a limitation, and puts
the burden on a measurement to say otherwise.

**STARTS** (Legunsen, Shi, Marinov) is the static class-firewall counterpart,
evaluated head to head against Ekstazi, and found static selection competitive
with dynamic on real projects. **HyRTS** (Zhang, FSE 2018) mixes granularities
to take both.

Together they qualify [spec 0027](../specs/0027-a-test-is-selected-by-what-it-executed.md)'s
argument. *An import is not an execution* is true and the mocked-module case is
real, but "observation beats prediction" is an aggregate claim and the aggregate
has been measured by other people, who found the gap smaller than the argument
predicts.

**Google's TAP** (Memon et al., ICSE-SEIP 2017) is the industrial datapoint, and
its interesting move is not selection. It **schedules** by a cost/benefit model,
and it carries a per-target flakiness rate as a property of the test rather than
of the run — which is what [`history.md`](../history.md) does per subject.

### Predictive test selection, and why it is not the model here

**Facebook's predictive test selection** (Machalica et al., ICSE-SEIP 2019)
learns from historical change-test-outcome triples and ships with an accepted
miss rate, tuned to catch most failures at a fraction of the cost.

**The position here is that this does not work, and the reason is mechanical
rather than statistical.** A model over that triple learns which tests
*historically failed alongside* which changes. That correlate is team habit and
directory adjacency, not causation, so it decays every time a codebase is
reorganized — exactly when selection is under the most stress — and it cannot
say why a test was chosen. A selector that cannot state its reason cannot be
audited, which is the requirement
[ADR-0039](adr/0039-the-digest-is-the-proof-the-trail-is-the-explanation.md)
exists to enforce, and it fails in the direction
[`selecting.md`](../selecting.md) refuses: a miss is silent, because the test
that should have run is not in the report to be missing from.

What does work on this question is the traceability field's answer, one field
over: **connect a test's actions and its assertions to the system under test**,
so the link is a structural fact about what the test does rather than a
correlation over who broke what. That is the AAA boundary, and this project
addresses it only for its own naming needs — the dragon rule, and the Act and
Assert vocabulary in [`scenarios.md`](../scenarios.md). Neither of those reaches
source. Nothing here joins an authored Act to the regions executed under it.

## Flake detection without a rerun

**DeFlaker** (Bell, Legunsen, Hilton, Eloussi, Yung, Marinov, ICSE 2018) is the
single most transferable result in this list. A test whose outcome changed
between two versions, and whose coverage of the *changed* code is empty, is
flaky — proven, without rerunning it once. Nothing it executed changed, so
nothing about the change can explain the new outcome.

Its shape is already ours. A run here calls a subject `changed`, walks a ladder
for what explains the movement, and stops at `unexplained`
([`composition.md`](../composition.md#why-a-component-moved)); it then reads the
subject twice and reports `unstable`
([`flakiness.md`](../flakiness.md#nothing-in-this-run-explains-it)). The `held`
list is the control group, and `flake` is the name for both halves being
present.

**And the difference is the thing worth taking.** Our `unexplained` rung is an
*absence*: no rung held. DeFlaker's judgement is a *presence*: the executed
regions were observed, and they do not intersect the diff. *Blindness is not an
answer* is this project's own rule
([ADR-0008](adr/0008-per-profile-expectations.md)), applied everywhere but here — so the
one rung that produces the finding is the one shaped the way the rest of the
codebase refuses. [Spec 0035](../specs/0035-a-flake-is-what-the-run-did-not-execute.md)
is that correction.

The neighbours are worth the same afternoon. **iDFlakies** (Lam, Oei, Shi,
Marinov, Xie, ICST 2019) separates order-dependent from non-order-dependent
flakes by running randomized orders, which is
[spec 0012](../specs/0012-order-dependence-in-a-run.md)'s literature and the
`alone` pass's. **NonDex** (Gyori, Shi, Marinov et al.) surfaces tests relying
on underdetermined API behaviour such as hash iteration order. **Shaker** (Silva,
Teixeira, d'Amorim, ICSME 2020) adds stress to make concurrency flakes
reproducible instead of rare — the opposite lever to `pin-animations`, and one
we have no equivalent of.

## Fault localization

**Tarantula** (Jones & Harrold, ASE 2005) reads the coverage matrix as
suspiciousness: a region entered by few tests, one of them failing, is
characteristic. **Ochiai** (Abreu, Zoeteweij, van Gemund) is the same idea with
a better coefficient and has beaten Tarantula in repeated replications;
**Barinel** and **DStar** follow it. If a suspiciousness number is ever computed
from our coverage index, Ochiai is the default and Tarantula is the historical
reference.

**Delta debugging** (Zeller & Hildebrandt, TSE 2002) is the general form of
`git bisect`: given a change set that moved forty subjects, `ddmin` reduces it
to the minimal hunk responsible. It belongs to the *attribute* rung of
[`instruments.md`](../instruments.md) and there is nothing like it here.

## Web UI difference

**XPERT** (Roy Choudhary, Prasad, Orso, ICSE 2013) detects cross-browser
incompatibilities by comparing structure and layout rather than pixels, and then
localizes to the responsible element. **WebSee** (Mahajan & Halfond, ICST 2015)
does presentation-failure localization from an expected image down to the DOM
node and CSS property at fault.

Both are the published form of the argument
[ADR-0018](adr/0018-a-component-hash-covers-its-own-nodes.md) makes, and both
went further than we have on one axis: they name the responsible **CSS property**,
where we stop at a component, a band and a `file:line`. Anyone building
culprit-naming for a moved component hash should read them first. The commercial
row — Percy, Chromatic, Argos, Applitools — is
[`comparison.md`](../comparison.md) and stays there.

## Coverage adequacy

The field that asks whether a suite is good enough, as opposed to which of it to
run. It is the one our own [journal 0067](journal/0067-a-hundred-percent-bought-one-witness-per-region.md)
walked into: a package at 100% lines whose regions have a median of two
witnesses, beside another at 100% where every region has one.

**Coverage is necessary and not sufficient, and this is settled.** Low coverage
proves a weak suite; high coverage proves nothing, because a test with no
assertion executes lines exactly as well as a test with one. Once a percentage
becomes a target it stops measuring — Goodhart, and the worthless tests written
to clear a threshold are the standard observation.

**Mutation testing** is the field's answer, and it is the strong one. Inject a
fault, see whether the suite notices; the mutation score covers execution *and*
assertion where coverage covers only execution. **Petrović, Ivanković, Fraser &
Just** (ICSE-SEIP 2021) is the industrial datapoint: Google runs it inside code
review, surfacing a selected sample of mutants in changed code as review
findings rather than as a batch score, because the full analysis is too
expensive to run whole. **Stryker** (JavaScript) and **PIT** (Java) are the
tools within reach.

**Checked coverage** (Schuler & Zeller, ICST 2011) is the closer relative and
the cheaper one. It takes a dynamic backward slice from the assertions and
counts only the code an oracle actually *checks*, so a line executed by a test
that never looks at the result is not covered. They reported it more sensitive
to oracle decay than mutation testing, at a fraction of the cost. It is the same
slice **SCOTCH+** takes one field up, used for adequacy instead of traceability.

**Test gap analysis** (CQSE / Teamscale) is the industrial form nearest to what
we hold: intersect *changed since the last release* with *executed by any test*
and report the methods in neither. Its **testwise coverage** upload format is
per-test coverage as an interchange artifact at method granularity — the closest
published thing to our record's rows, and the evidence that a per-test format is
a thing somebody already needed.

**Per-test coverage exists as a feature and not as a metric.** JetBrains IDEs
track it and answer *show tests covering line*; **Parasoft Jtest** records
covered code per test case; **Wallaby.js** puts per-line covered / not-covered /
partially-covered indicators in the editor as you type. All three are lookup
tools — you ask about a line and get the tests. None of them aggregates the
inverse into a number, and none reports *this region has one witness* as a
finding.

**What it means here.** Two positions come out of that gap, and one warning.

The gap is real: nobody found reports witnesses per region as a suite-level
signal, and our record already carries what it needs — every region holds the
test files that entered it, and those files have names. Our own numbers say the
signal is not redundant with the one everybody quotes: over this repository's 31
packages with fifty regions or more, the line percentage ranks with regions
entered at ρ = 0.62 and with the single-witness share at ρ = 0.26.

The warning is that **witness count is not assertion strength**, and the two
must not be conflated on a product page. A region entered by six tests that
assert nothing about it has six witnesses and no evidence. Schuler & Zeller
measured the difference and Petrović et al. shipped the stronger answer; we
record reach, not checking, and any claim that our reading beats a percentage
has to say which of the two it is beating it on. Nothing here slices to the
assertion, and [spec 0035](../specs/0035-a-flake-is-what-the-run-did-not-execute.md)
is the nearest place that changes.

## Where the field contradicts us

| Our position | Who measured otherwise | What it costs us |
| --- | --- | --- |
| Finer granularity would select better | Ekstazi: file-level beat method-level, cost dominated | A claim we should stop implying until measured |
| Observation beats prediction | STARTS: static competitive with dynamic in aggregate | The mocked-module case stands; the aggregate one does not |
| One signal, exact, or unknown | TCTracer: the ensemble beat every single technique | Evidence against purity, on the attribution question only |
| The corpus is enough to argue from | Methods2Test: ground truth at a scale in-house corpora do not reach | Named in [spec 0022](../specs/0022-evidence-from-code-this-project-did-not-write.md) already |
| Naming the witnesses beats counting the lines | Schuler & Zeller, Petrović et al.: execution is the weak half either way | True against a percentage, not against an oracle-aware measure; say which |

None of those is a refutation of a shipped behaviour. Each is a reason a
sentence on a product page needs a measurement behind it before it is quoted as
an advantage.
