# Spec 0035 — a flake is proven by what the run did not execute

**Missing:** the join, and the verdict it makes possible. The coverage index
records which tests entered which regions; the attribution ladder decides what
explains a moved component; nothing connects them. So `unexplained` is the
absence of an explanation, and turning it into `flake` still costs a second
reading of the subject.
**Built on:** [`composition.md`](../composition.md#why-a-component-moved) (the
ladder this adds a rung above),
[ADR-0033](../context/adr/0033-the-component-that-mounted-it-is-not-the-one-it-sits-in.md)
(the ladder's order),
[ADR-0030](../context/adr/0030-two-second-passes-one-variable-each.md) (`again`
and `alone`, which this does not replace),
[ADR-0008](../context/adr/0008-per-profile-expectations.md) (blindness is not
an answer — the rule this rung currently breaks),
[0027](0027-a-test-is-selected-by-what-it-executed.md) /
[0029](0029-what-a-run-remembers.md) / [0030](0030-a-diff-lands-on-blocks.md)
(the index this reads, and the diff-to-block mapping it shares),
[`prior-art.md`](../context/prior-art.md) (DeFlaker, which is this argument
made once already in another language).

## Purpose

A run reports a moved component, walks the ladder, and reaches `unexplained` —
no edited file, no moved token, no edited caller, no contradiction. That finding
is the product, and it is derived the wrong way round.

**`unexplained` is an absence.** It says four rungs were tried and none held. It
does not say what the rendering executed, because nothing observes that. The
same absence is produced by a genuine flake, by an `edited` rung that missed
because a barrel file hid the declaration, and by a run that had no change set
to consult. Only the last one is reported distinctly.

That is the one place this codebase reasons from silence. Everywhere else the
rule holds: a baseline recording no component list is *unknown*, never *renders
nothing*; an unparseable file is *not instrumented*, never *not executed*; a
band a profile could not observe is `unobserved` and never collapses into a
verdict. The rung that produces the flake finding is shaped the way the rest of
the project refuses.

The correction is a positive observation, and DeFlaker's result is that it is
sufficient on its own: **if the regions a subject actually executed do not
intersect the change set, nothing in the change can explain the movement.** No
rerun, no second reading, no control group required. It is not a shortlist entry
and not a confidence level. It is a fact about what ran.

The asymmetry is the whole design and it only points one way:

| Observation | What it concludes |
| --- | --- |
| Executed regions do not intersect the diff | **Conclusive.** The change did not reach this rendering; the movement is not the change's |
| Executed regions do intersect the diff | The `edited` rung, sharpened. Necessary, never sufficient — entering a changed region is not rendering differently because of it |
| No execution evidence held for this subject | **Unknown.** The rung does not fire and the subject keeps the finding it has today |

## What would discharge it

**1. An execution footprint addressed by subject, not by test file.** The
coverage index keys crossings to test files
([0029](0029-what-a-run-remembers.md)). A visual subject is a story, a route or
a fixture, and the rendering that moved is a component instance inside it. The
footprint this rung needs is *the set of blocks entered while producing this
subject's document* — which is a narrower window than a test file's whole run
and is the reason this cannot be a query against the existing shape alone.

**2. Both profiles, or the rung declares itself blind.** The `jsdom` collector
runs in Node, so probes reach it through the same Vitest seam
([0028](0028-the-instrument.md)). A Chromium subject is produced in a browser,
so its bundle carries the probes and the page carries the collector, and until
it does the rung has no evidence for that profile. Spec 0027 already committed
to one index across every origin rather than a later feature; this is its first
consumer, and the first thing that makes the commitment cost something. A
profile without probes reports **unobserved**, on the ADR-0008 rule, and never
reports non-intersection it could not have seen.

**3. The rung sits above `unexplained`, not instead of it.** The ladder keeps
its order and its first-rung-that-holds shape. What changes is that the finding
splits by evidence:

| name | evidence |
| --- | --- |
| `flake` | the executed regions were observed and do not intersect the change set |
| `flake` (today's meaning) | unexplained, and the subject also failed to read the same way twice |
| `suspect` | unexplained, with no execution evidence and no second reading |

Two independent routes to one name is correct here and is not a confidence
blend: each states which instrument produced it, the way `flake` already names
both halves of its sentence today.

**4. It narrows nothing and skips nothing.** This rung classifies a movement the
run already found. It must not be reachable from selection, from `settle`, or
from any decision about whether to collect a subject — a non-intersection that
silences a comparison is a missed regression with a confident sentence attached,
which is the failure [`selecting.md`](../selecting.md) is arranged to avoid.
`accept` continues to refuse the subject, for the reason it refuses `unstable`:
the image on disk is one of two readings.

**5. It orders the sweep.** `variance run --flakes` reads every subject twice
and reads them in plan order, which
[`flakiness.md`](../flakiness.md#nothing-in-this-run-explains-it) records as a
vacancy rather than a decision. Non-intersection is the ranking signal that
vacancy is missing: a subject whose footprint the change never reached is the
one worth the second reading first. Ordering the sweep is where this pays for
itself nightly.

**6. The measurement that would settle it.** The corpus has 40 declared cases
and a demonstrated false alarm — reindented JSX renders at 0px and moves the
structural hash ([0022](0022-evidence-from-code-this-project-did-not-write.md)).
That case is the acceptance test in both directions: the reindent executes the
region it edited, so this rung must **not** call it a flake, while a clock
ticking in a subject the diff never reached must be called one on the first run,
with no second reading and no `held` list.

## What this refuses to conclude

**Intersection is not causation.** A rendering that entered a changed region and
moved has satisfied the `edited` rung with better evidence than a declared file
list. It has not been explained, and the ladder continues past it.

**A footprint is not a coverage percentage.** The question is which regions were
entered, never how many, and no threshold, ratio or score is derived from this
index. The instrument records the path, not the percentage
([0028](0028-the-instrument.md)).

**An empty footprint is not an empty intersection.** A subject the collector
produced with no probes loaded has *no evidence*, and reads as unobserved. The
distinction is the entire correctness argument: reading "nothing was recorded"
as "nothing was executed" reinstates the reasoning-from-silence this spec exists
to remove.
