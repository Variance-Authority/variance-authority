# Spec 0032 — a render nobody committed

**Missing:** the render input the application controls. `EnvironmentInputs`
covers the engine, the ruleset, the allowlist, the viewport, the fonts, the
resolved media conditions, the external assets and the stabilization recipe —
every non-code input except the one the product decides for itself. A page
rendered with `checkout-v2` on and the same page with it off carry one
environment key, one commit and one subject id, so they meet under one baseline,
and their disagreement is reported as a change with a component and a `file:line`
attached.
**Built on:** [ADR-0002](../context/adr/0002-observation-profiles.md) and
[ADR-0012](../context/adr/0012-observability-and-the-damage-boundary.md) (what a
reading could not reach is said, not defaulted),
[ADR-0010](../context/adr/0010-tier-specific-environment-keys.md) (which inputs
reach which representation, and what adding one costs),
[ADR-0030](../context/adr/0030-two-second-passes-one-variable-each.md) (one
variable per second pass — the discipline this breaks),
[ADR-0031](../context/adr/0031-the-run-asks-what-is-recorded-now.md) and
[ADR-0032](../context/adr/0032-a-flake-rate-divides-by-the-runs-that-asked.md)
(where the misdiagnosis is recorded and what it divides).
[0008](0008-locale-runs.md) is the axis this one is shaped like;
[0026](0026-selection-by-closure-digest.md) is where an input nobody read is
already handled the way this one must be.

## Purpose

The environment key's own docstring states the rule this spec exists under: the
guarantee is *same hash ⇒ same render*, it is exactly as strong as the key's
coverage, and an uncovered input produces two different renders under one key —
a false `unchanged`, or a change attributed to whatever else moved. A feature
flag is an uncovered input. It is also the only one that somebody outside the
repository can change while the suite is running.

**The assignment is not stable, and nothing about the page is unstable.** A split
is keyed on a user, a fresh browser context is a user the service has never seen,
and a bucketing rule answers a new key by drawing. So two readings of one subject
can land in two arms with no commit, no remote change and no defect: the arm is
drawn per context, and the suite opens contexts. Under a percentage rollout the
draw is the *design*, not a fault in it.

What the system does with that today is the cost, and it is specific:

- `again` reads the subject a second time and gets a different answer, so the
  subject is reported unstable. It is not; it was asked twice and answered about
  two different products.
- `alone` then does not run, because instability was established first — which is
  the correct order for the question it was built for, and here it retires the
  one pass that would have shown the world unchanged.
- The flake rate divides by the runs that asked, and this subject answers
  differently in a fixed fraction of them forever, so the number converges on the
  rollout percentage and reads as a property of the component.
- When the draw happens to hold and a rollout percentage moves instead, the
  comparison reports a change, `resolveSource` resolves it to the component that
  rendered differently, and the report names a file and a line in code nobody
  edited. Confident, specific, and about the wrong thing.

The operator's remedies are all aimed elsewhere. Stabilization holds animations,
clocks and fonts still; there is nothing on the page to hold. An ignore hides the
region and hides every real regression in it. Re-running draws again.

There is no version of this the current shape gets right, because the failure is
not in the comparison or the flake pipeline — both behave correctly on the
information they hold. It is that nobody recorded which product was rendered.

**And the same fact, recorded, is a capability rather than a fix.** A flag is a
declared, enumerable, machine-settable difference between two renders of one
commit. That is the controlled experiment [0024](0024-what-a-prop-controls.md)
had to construct by hand, arriving for free: *what does `checkout-v2` change*
becomes a question with a banded answer, an approval, and a recurrence count — a
flag that has silently moved the same 22px in six of the last thirty runs is a
sentence no experimentation platform can produce, because none of them holds a
picture of the page and none of them keeps a record keyed on the change.

## What already landed, and why it is not this

A subject may declare that it is a variation of another subject
([ADR-0045](../context/adr/0045-a-subject-may-be-a-variation-of-another-subject.md)):
a `variance-parent:<id>` tag, resolved at plan time, produces a comparison
between the two subjects of one run and a digest of the difference between them.
That is the half of this spec a link can reach. A story added for
`checkout-v2 = on` is no longer a second baseline nobody can question — what the
flag does is measured, printed, and stable across a change that moved both arms.

It leaves the whole of the rest. A declaration says *these two were meant to
differ*; it says nothing about which arm a render was **produced under**, which
is what this spec is about. A subject with no declaration, drawn into an arm per
browser context by a percentage rollout, is exactly as unreadable as before: one
subject, one environment key, two renders, and a `file:line` in code nobody
edited. The link is a thing an author writes down; the assignment is a thing the
run has to read.

## What would discharge it

**1. An assignment that was read, never one that was requested.** Setting an
override and trusting it is the mistake the rest of this project already refuses
in every other medium: the SDK may fall back, the flag may not exist on the
remote, a targeting rule may outrank the override, and the render then disagrees
with the config that claims to describe it.

```ts
/** Proposed: what the render actually resolved, per flag it asked for. */
interface FlagReading {
  /** The flag key as the application asked for it. */
  readonly key: string;
  /** The variant name when the provider names one — `control`, `treatment`. */
  readonly variant?: string;
  /** The resolved value, canonicalized. */
  readonly value: string | boolean | number;
  /**
   * Why this value: `static`, `targeting-match`, `split`, `cached`, `default`,
   * `error`. `default` and `error` mean the provider was not reached, and a
   * reading that was not reached is a diagnostic rather than a value.
   */
  readonly reason: string;
}

/** Proposed: the assignment one subject's render was produced under. */
interface Assignment {
  /** Every flag this render evaluated, sorted by key. */
  readonly readings: readonly FlagReading[];
  /** `digestCombine('assignment/v1', readings)`. Absent when nothing was read. */
  readonly digest?: Digest;
  /** The declared arm this render was asked for, when a run asked for one. */
  readonly arm?: string;
  /** What could not be read. Empty is the expected case. */
  readonly diagnostics: readonly Diagnostic[];
}
```

The provider stays somebody else's dependency. This is the seam
[0019](0019-provenance-without-react.md) already established for framework
provenance: a callback the adopter wires, twenty-odd lines against OpenFeature's
evaluation details — which already carry a variant, a value and a reason — and a
count of implementations rather than a vendor in `core`.

**2. The digest covers what this render read, not what the project defines.** An
application with three hundred flags that hashed all of them would invalidate
every baseline of every subject the day somebody adds an unrelated one. The
evaluation callback reports the flags the render *asked for*, which is a per
subject fact, and it is the same shape as `closureOf`'s unread inputs and the
capture's `couplings`: what was reached is recorded, what was not is named.

The corollary is load-bearing and unobvious: **a subject that evaluated no flags
carries no assignment digest at all**, and its baseline is unaffected by this
work. Adopting flags is not mass invalidation; it costs exactly the subjects that
read one.

**3. Where it goes, and the two things it can be.** An assignment is a property
of what was rendered, not of the machine that rendered it — the same call
[0008](0008-locale-runs.md) makes for a locale, and for the same reason:
`diffSnapshots` refuses to compare across environment keys, correctly, and two
arms of one flag exist to be compared. So it is a collector input and a capture
field, not an `EnvironmentInputs` member.

Which leaves the real decision, and it has two answers because there are two
situations:

- **A contrast.** One subject, N renders, one baseline in the declared control
  arm, and each other arm compared against the control render *of the same run*.
  Nothing else gets a baseline, storage does not multiply by the number of
  experiments, and no arm ever needs an approval of its own. This is the default
  and it is the locale design, unchanged.
- **An arm of its own.** A flag that has shipped to a fraction of users for six
  months is not an experiment any more; its regressions are production
  regressions, and a design that never stores its baseline can never catch one.
  Such an arm is declared `baselined`, and its assignment digest joins the key
  the baseline is stored under — so the two arms are two baselines that never
  meet, which is what `incomparable` already exists to guarantee for every other
  render input.

The default is the cheap one because the expensive one must be *chosen*. An
adopter who baselines five arms of four flags has asked for twenty baselines per
subject, and that number should appear in a config file they wrote rather than
emerge from a rollout somebody else configured.

**4. An arm is a declared vector, never an axis.** The tempting config is a list
of flags with their values, and it is wrong: six booleans is sixty-four renders
of every subject, and nobody meant that.

```ts
/** Proposed: in the CLI config, beside `locales`. */
interface ExperimentConfig {
  /** The arm every other arm is compared against. Declared, never inferred. */
  readonly control: string;
  readonly arms: readonly ExperimentArm[];
}

interface ExperimentArm {
  readonly name: string;
  /** The overrides this arm asks the provider for. */
  readonly flags: Readonly<Record<string, string | boolean | number>>;
  /** Whether this arm stores a baseline, or is only contrasted with the control. */
  readonly baselined?: boolean;
}
```

Named vectors also give the report and the approval something a person can say:
*`checkout-v2:treatment` moved the summary panel 22px*, not *flags digest
`8a1f…` moved it*.

**5. The run establishes the assignment before it concludes anything about
stability.** This is [ADR-0030](../context/adr/0030-two-second-passes-one-variable-each.md)'s
argument applied one rung earlier. `again` runs before `alone` because `alone`'s
inference is uninterpretable on a subject that does not read the same way twice;
by the same reasoning `again`'s inference is uninterpretable on a subject that
was not rendered under one product. So a run that reads two assignments for one
subject reports **an arm that moved between readings** and stops — it does not
report instability, it does not record a flake row, and the sentence names the
flag key rather than the component.

The refusal that must come with it: a subject whose assignment could not be read
at all — provider unreachable, every reading `default` — is not silently compared
against a baseline taken under real assignments. That comparison is across two
products, and its result is `incomparable` with a reason, which is the answer
this project already gives when a reading cannot reach.

**6. The record gains the column that explains a disagreement on one commit.**
Every history row already carries a commit; two runs on one commit that disagree
are readable today only as flakiness, because nothing distinguishes them. With
the assignment digest on the row, recurrence divides by the runs that asked *in
the same arm*, drift sums approved changes per arm, and the question a rollout
raises — *did this start when the flag went to 50%?* — is a query rather than an
archaeology exercise.

## Acceptance

1. **Unmet.** A run configured with a control and one treatment arm produces one
   baseline per subject and one contrast per non-control arm, and the report
   names the flag key that separates them. Nothing reads an `experiments` key;
   the word does not appear in `packages/cli/src/config.ts`.
2. **Unmet, and the one that decides whether this was worth building.** A subject
   under a 50% rollout, read twice, is reported as *the arm changed between
   readings* rather than as an unstable subject, and writes no flake row. Today
   it writes one, every run, forever.
3. **Unmet.** A subject that evaluates no flag has a byte-identical baseline
   before and after this lands. The cost of the axis is paid by the subjects that
   use it and by no others.
4. **Unmet.** With the provider unreachable, a run reports `incomparable` with the
   provider named, and does not compare a defaults-only render against a baseline
   taken under real assignments.
5. **Unmet.** A `baselined` arm that regresses fails the run on its own baseline,
   and `accept` promotes that arm without touching the control's.

## Not in scope

**Deciding anything about the experiment.** No conversion metric, no
significance, no rollout recommendation. The platforms that do that have the
event stream and this project has a picture of a page; a system that read a flag
service and then offered an opinion about the experiment would be claiming
evidence it does not hold.

**Flags whose effect is not in the render.** A flag that switches a payment
processor and changes no box is invisible here and must be reported as evaluated
rather than as harmless — the distinction [ADR-0002](../context/adr/0002-observation-profiles.md)
draws everywhere else.

**Setting flags in production.** The override path is a test-time provider the
adopter wires. Nothing here writes to a flag service, and a tool that could would
be a tool with a credential nobody wanted to give it.

**Server-rendered assignment the client cannot see.** When the arm is chosen
before the document is produced and the page carries no evidence of which arm it
is, the reading is `default` and the run says so. Guessing from the rendered
output is exactly the inference this spec exists to stop.
