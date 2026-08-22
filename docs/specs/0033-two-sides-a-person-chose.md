# Spec 0033 — two sides a person chose

**Missing:** a comparison whose two sides are named by whoever asked. Every
comparison in the system is one subject against its own baseline:
`diffSnapshots` throws on two subject ids and throws again on two observation
profiles, the run compares this capture against the baseline stored for that
subject under this renderer identity, and the CLI dispatches `run`, `report`,
`adjudicate`, `accept`, `changelog`, `serve`, `doctor` and `comment` — none of
which takes two names. *What is different between `Button` and `IconButton`* and
*what is different between run 1 and run 121* are questions this system holds all
the material for and has no way to be asked.
**Built on:** [ADR-0002](../context/adr/0002-observation-profiles.md) (a band a
profile could not observe is never reported as no difference),
[ADR-0018](../context/adr/0018-a-component-hash-covers-its-own-nodes.md) (the
band-exact hashes that make the cheap answer free),
[ADR-0011](../context/adr/0011-durable-and-ephemeral-retention.md) (what may
accumulate, which is what bounds the run-against-run arm) and
[ADR-0017](../context/adr/0017-the-exit-code-is-the-interface.md) (why an inquiry
must not touch the exit code). [0008](0008-locale-runs.md) already compares two
renders that share no baseline and already counts what pairing could not reach.

## Purpose

The refusal in `diffSnapshots` is correct and must stay. A verdict that crossed
subjects or profiles would let a jsdom run appear to satisfy a Chromium baseline
while blind to every geometry change in it, and the throw is what stops it.

But the refusal is about **judgement**, and it has been applied to **inquiry**,
which is a different operation with different obligations:

| | judgement | inquiry |
|---|---|---|
| sides | a candidate and its baseline | two readings somebody named |
| identity | must match, or the verdict is unsound | need not match; the mismatch is the finding |
| output | a verdict, an approval, an exit code | findings, and what could not be compared |
| record | history rows, drift, recurrence | nothing |

Four questions are asked constantly, all four are inquiries, and none of them can
be typed today:

- *What is different between `Button` and `IconButton`?* — the design-system
  question. Two components that are supposed to be siblings, drifting apart one
  padding token at a time, and the only current answer is opening two pictures.
- *What is different between run 1 and run 121?* — the *when did this start*
  question. History says a component's hash moved in eleven runs; it cannot say
  what the eleventh render looks like against the first, because nothing joins
  two runs' renders.
- *What is different between this branch's `Card` and main's?* — one subject, two
  worlds, no baseline shared between them.
- *What does this arm change?* — [0032](0032-a-render-nobody-committed.md)'s
  contrast, which is one instance of this operation and not a mechanism of its
  own.

The material for all four already exists and is already the expensive part: a
normalized document, band-exact component hashes, delta banding, component
attribution, source resolution. What is absent is a caller that takes two of
anything, and the discipline that keeps such a caller from becoming a way to
launder a baseline.

## What already landed, and why it is not this

`deriveVariation` compares two subjects of one run and returns the difference
without reaching a verdict, sharing its arithmetic with `diffSnapshots` through
`compareTrees`
([ADR-0045](../context/adr/0045-a-subject-may-be-a-variation-of-another-subject.md)).
So the claim that a cross-subject comparison is unsound is now settled where it
was always false: the refusal is about judgement, and the arithmetic under it
answers a pair of subject ids perfectly well.

What that does not give anybody is the ability to **ask**. The only thing that
can reach it is a `variance-parent:<id>` tag on a subject, read before the run
starts — so a pair has to have been declared by an author, in a collector, in
advance. *What is different between `Button` and `IconButton`*, asked after the
fact about two subjects that declared nothing about each other, still has no
caller; the two side selectors below are what would give it one, and the
run-against-run arm still needs an addressable capture that no run keeps.

## What would discharge it

**1. `contrast` is a second operation, not a flag on the first.**

```ts
/** Proposed: in `core`, beside `diffSnapshots`. Refuses nothing; explains. */
function contrast(left: SemanticSnapshot, right: SemanticSnapshot): Contrast;

interface Contrast {
  /** What the two sides share and what they do not. Never a reason to refuse. */
  readonly basis: ContrastBasis;
  readonly deltas: readonly Delta[];
  /** Per band: same, different, or unreachable on one side and why. */
  readonly bands: readonly BandContrast[];
  /** Nodes no partner was found for, per side, and where pairing stopped. */
  readonly uncompared: UncomparedNodes;
}

interface ContrastBasis {
  /** Fields whose values differ between the sides: `subject`, `profile`, … */
  readonly differs: readonly string[];
  /** Fields that agree. Present so that agreement is stated, not inferred. */
  readonly shared: readonly string[];
}

interface BandContrast {
  readonly band: Band;
  /** `same`, `different`, or `unobservable` when one side's profile is blind. */
  readonly state: string;
  /** Which side could not observe it, when that is the answer. */
  readonly blind?: 'left' | 'right';
}

interface UncomparedNodes {
  readonly left: number;
  readonly right: number;
  /** Paths where pairing stopped, so a smaller number is never a cleaner one. */
  readonly paths: readonly string[];
}
```

`uncompared` is not a nicety and it is the same field [0008](0008-locale-runs.md)
argues for at length: two trees that diverge take their subtrees out of the walk,
so the pair that shares the least produces the fewest findings and reads as the
most similar. A contrast that reports a count of what it never looked at is
usable; one that does not is actively misleading, and misleading in the direction
of *these two are fine*.

**2. A mismatch is reported, never thrown.** Crossing profiles is the sharp case:
a jsdom side has no geometry at all, so a jsdom-against-Chromium contrast must
report `geometry: unobservable, blind: left` and must never report the absence as
sameness. That is [ADR-0002](../context/adr/0002-observation-profiles.md) applied
unchanged; the difference from `diffSnapshots` is only that a contrast has no
verdict to make unsound, so it can say the sentence instead of refusing to speak.

**3. The cheap answer comes first and needs no pairing at all.** Component hashes
are already band-exact per [ADR-0018](../context/adr/0018-a-component-hash-covers-its-own-nodes.md).
Two of them compared is five booleans — *`Button` and `IconButton` agree on
structure and a11y, differ on style, geometry and text* — for the price of
reading two records, with no tree walk, no pairing and no uncompared count,
because nothing was walked. That is most of the value of the design-system
question, it is available before any of the rest of this is built, and it is what
a report should lead with.

**4. A side is a selector, and one selector does not resolve yet.**

```ts
/** Proposed: the two side arguments a `contrast` command accepts. */
type SideSelector =
  /** A subject captured by this invocation: `subject:components-button--primary`. */
  | { readonly kind: 'subject'; readonly id: string }
  /** The stored baseline for a subject, under this machine's identity. */
  | { readonly kind: 'baseline'; readonly id: string }
  /** A declared arm of the same subject, from `experiments`. */
  | { readonly kind: 'arm'; readonly id: string; readonly arm: string }
  /** A subject as one recorded run read it: `run:121#components-button--primary`. */
  | { readonly kind: 'run'; readonly run: string; readonly id: string };
```

Three of the four resolve against material that exists. The fourth does not, and
saying so is the ordering this spec asks for: **a run keeps no addressable
capture.** History is text and keeps hashes; the durable store keeps rasters
partitioned by renderer identity; the report is a summary. A hash answers *did
this move* and can never answer *what does it look like now against then*, so
`run:121` needs a capture archive — text, opt-in, with a declared retention,
addressed by run id and subject id, and never pixels, because pixels may not
accumulate. That archive is the whole cost of the run-against-run arm, and it is
why this ships in two parts rather than one.

**5. A contrast writes nothing and decides nothing.** No approval, no baseline,
no history row, no drift, no recurrence, and no exit code but the operator-error
one. The failure this refuses is concrete: an operator who cannot get a subject
green discovers that contrasting it against something agreeable produces a clean
report, and the moment such a report can promote anything, the gate is optional.
Judgement stays the only path that writes, which is
[ADR-0022](../context/adr/0022-deciding-is-not-writing.md)'s split arriving one
level up.

**6. It is an agent tool before it is a human one.** *What is different between
these two things* is the question an agent asks continuously and the one the
current tool list answers only when one of the two things is a baseline. A pure
function over two snapshots is exactly the shape the existing eight tools have,
so `variance_contrast` is a tool and a formatter rather than a new subsystem
([0013](0013-a-real-agent.md)).

## Acceptance

1. **Unmet.** A `contrast` command given `subject:a` and `subject:b` reports banded findings for
   two different subjects. `diffSnapshots` throws on this input today, and no
   command accepts two names.
2. **Unmet, and the one the design rests on.** Two subjects whose trees diverge
   at the root report an `uncompared` count on both sides and a path where
   pairing stopped — never zero findings.
3. **Unmet.** A jsdom side against a Chromium side reports `geometry` as
   unobservable with the blind side named, and reports no geometry deltas.
4. **Unmet.** A contrast run against a failing suite leaves the exit code, the
   baselines, the changelog and the history store untouched. Asserted by
   inspecting all four after the command, not by reading the code.
5. **Unmet.** `run:1` against `run:121` for one subject resolves. It cannot until
   a capture archive exists; this is the criterion the second part is measured
   against, and it is listed here rather than deferred to a spec of its own
   because the selector is meaningless without it.

## Not in scope

**A verdict on two things that were never the same thing.** `Button` differs from
`IconButton`; that is not a regression and this command must never call it one.
A contrast produces findings and a basis, and whoever asked decides what they
mean.

**Merging the two operations.** `diffSnapshots` keeps its throws. A shared
implementation underneath is expected and welcome; a shared entry point with a
`strict: false` option is how the refusal gets turned off in a config file
somebody wrote once and nobody read again.

**Pixel contrast between two subjects.** Two different components produce two
different rectangles, and a raster comparison of unequal frames reports every
pixel. The raster tier stays where it is: one subject against its own baseline,
under one renderer identity.
