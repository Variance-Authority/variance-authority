# ADR-0026 — `ignored` is not `unchanged`

**Status:** accepted
**Date:** 2026-08-05
**Amended by:** [ADR-0090](0090-a-moved-identity-is-a-cause-not-a-verdict.md) — a baseline from another machine is compared, with the identity named as the cause, and reports `changed` or `unchanged`; `unobserved` stands
**Extends:** ADR-0002 (observation profiles), ADR-0008 (per-profile expectations)
**Discharges:** spec 0024 (an ignore is a declaration, not a blind spot)

## Context

ADR-0002 established a rule that has held everywhere since: **an unobservable
difference is never reported as no difference.** A band a profile cannot see
reports `unobserved`; a baseline from another machine reports `incomparable`.
Neither is allowed to be spelled `unchanged`, because a green subject that is
indistinguishable from a genuinely clean one destroys the only question worth
asking of a suite — *how much of this did you actually check*.

[ADR-0025](0025-an-ignore-names-a-place-or-a-shape.md) introduced a second reason
not to have looked, and this one is chosen rather than imposed: the operator
declared that a subtree or a difference shape is not the subject. The obvious
implementation reports such a subject `unchanged` and moves on. Every product in
this category does exactly that, and it is why a masked suite rots — a mask that
outlived its flake is a permanent hole nobody can see, because nothing
distinguishes the subjects it covers from the ones that are genuinely fine.

## Decision

**A subject whose every difference was absorbed reports `ignored`.**

It is green and it exits `0`: the operator said this is not the subject, and
nothing needs review. It is a different word from `unchanged` so that the two can
be counted separately, forever, by anyone reading the report — including an agent,
since the verdict is on `RunReport` where the MCP tools can see it.

**Absorption is accounted for at three levels**, and each answers a question the
other two cannot:

- **Per comparison.** `Observation.ignored` carries the pixels absorbed, the
  number of excluded boxes, how many of those covered nothing, and a per-rule
  breakdown. It is present whenever the subject had an exclusion at all, including
  when it absorbed nothing — a field that vanishes at zero cannot report the state
  that matters.
- **Per subject.** `changedPixels` is net of exclusions and `ignored.pixels` is
  what they took, so the two can never be added by accident and a subject with a
  mask over half of it does not read as one that barely moved.
- **Per run.** `variance run` prints a ledger: what each rule absorbed, in how many
  subjects, and — named as `[dead]` — every rule that absorbed nothing. Two dead
  states are distinguished, because they need opposite actions: a rule that found
  its element and saw no difference is probably a fixed flake, and a rule that
  resolved nowhere at all is a selector that has rotted while the operator
  believes something is silenced.

**Expiry is declared rather than inferred.** A rule may carry `until`, after which
it stops absorbing and starts being reported, and the differences it was hiding
come back with no further action. The filtering happens in the CLI rather than in
a collector, because a collector runs in a browser and a browser is the wrong
place to hold a clock; `core` takes the date as an argument for the same reason —
a package that reads a clock cannot be tested for what it does on the one day the
field matters.

**An `ignored` subject gets a count, not a line.** `variance_summary` lists every
subject whose verdict is not `unchanged`, which would put a shared header carrying
a clock in front of the reader three hundred times. Three hundred lines saying
"you already decided not to look at this" is the output nobody reads — which is
how the *other* lines get missed. The header count keeps it visible and the ledger
explains it.

## Consequences

**`exitFor` reads a list of green verdicts rather than comparing to one word.**
Written as `!== 'unchanged'` the distinction would have disappeared from the exit
code the day it was added; the list makes adding a third green state a decision
somebody has to make.

**Every verdict map has to grow.** `tribunal`'s build summary counts by verdict
and now counts `ignored` too, including as an explicit zero — a map missing the
key reports `undefined` where a build genuinely had none, and a review surface
that cannot tell "no ignored subjects" from "this build predates ignores" is one
an operator goes to the database to check.

**It is honest about a run that is entirely ignored.** A suite where every subject
went green because of one over-broad rule reports every subject `ignored`, one
ledger line, and exit `0`. That is a correct answer and an alarming-looking one,
which is the intended reading: nothing about it resembles a clean run.

**What it does not do.** It does not refuse the exit code. An operator who
excludes their entire application gets `0`, because the alternative is a tool that
argues with a decision it was told to respect. What it does instead is make the
decision impossible to lose track of.

## Amended 2026-10-13 — what the default policy forgives

The Context above names two reasons not to have looked: imposed by a profile and
chosen by an ignore. The comparison policy is a third, written by whoever set the
default, and this ADR's rule had not been applied to it.

`DEFAULT_POLICY` was `pixelmatch`'s own: `threshold: 0.1`, antialiasing forgiven.
On tribunal's Storybook gate (183 stories), `--va-line` from #2f3437 to #3a4043 —
every border on the review page — reported 183 `unchanged` and exit 0, and so did
`--va-accent` from #ff4a19 to #ff6a19. A padding edit on the same gate reported 51
`changed`. In `pixelmatch`'s YIQ metric the two colour edits are 4.4% and 8.5% of
the distance from black to white, both inside 10%. That is a false `unchanged`,
the failure ADR-0002 calls the worst this product has. The sentence beside it
said `no pixels differ; 6,172 pixels differ with antialiasing counted`: `recordOf`
appended the strict count and credited all of it to antialiasing, beside pixels
the colour threshold had forgiven.

**The default threshold is `0.01`.** Antialiasing stays forgiven.

Measured before choosing it:

- **The edits.** Each of tribunal's 55 stored before images was recoloured exact
  pixel for exact pixel. The line token touched 54 subjects: 0 pixels counted at
  `0.1` and at `0.05`, and 142,469 at `0.02` and at `0`, so 142,469 at `0.01`.
  The accent touched 17: 0 at `0.1`, and 54,625 at `0.05` and at `0`. A second
  reading the same day, of 37 pairs the gate had rewritten meanwhile, gave the
  same shape: nothing at `0.1`, and `0.01` counting exactly what `0` counts.
- **The noise.** Journal 0010's flakiness rounds, 10 rounds over todomvc's 15
  stories in Chromium. Shooting a mounted story twice: 0 pixels under every
  policy. Remounting it on the reused page: 0 pixels at every threshold from
  `0.1` down to `0.01`; 18–25 pixels a round at `0` with antialiasing forgiven;
  91–129 at `strict`. The worst pixel at `0` was 0.32% (`ds/button--default`).
  One level per channel can never be further than 0.39%.

**Alternatives.**

- **`0`.** Rejected. Remounting on a reused page is the product path (ADR-0009),
  and ADR-0030's second passes compare documents, not paints, so nothing would
  explain the one-level wobble away. Every run would report it as an attributed
  `changed`.
- **`0.1`.** Rejected. It is the defect.
- **`0.05`.** Rejected. It still forgives the line token.
- **`0.02`.** It counts both edits, and it forgives twice as much colour as
  `0.01` while buying no measured noise back.
- **`0.005`.** It sits above the worst one-level wobble (0.39%) too, but by
  0.11 points, and the rounds were measured on one darwin/arm64 machine.
  `0.01` forgives any difference of up to two levels per channel (0.78% at
  worst), twice the wobble measured, and still counts a grey moved three levels
  (1.14%). It is also jest-image-snapshot's default (prior art: *How far a
  pixel's colour moves before it counts*).

**A green sentence names what was forgiven.** `decide` owns the sentence, and it
is the only place that knows which policy the verdict was decided under. When
the strict policy counts pixels the deciding policy did not, `no pixels differ`
becomes `no pixels differ beyond the tolerance of the default policy, which
forgave N pixels as antialiasing or as a colour change of at most 1%`. The same
clause follows `nothing outside them moved` and `nothing else moved` on
`ignored`. Both reasons are named whenever the policy has both, because one count
cannot tell them apart. The words are read from the policy, not written out, so
a threshold that changes cannot leave a sentence describing the old one. The
count is exact and covers the whole comparison: the deciding policy's mask is
taken before any box is subtracted, and `strict` counts every one of its pixels
and more, so on `ignored` it includes pixels forgiven inside an excluded box.
`recordOf` no longer appends its own clause.

**The verdict stays `unchanged`.** `ignored` is what somebody declared. Forgiven
pixels are a property of the comparison and are on every comparison of
antialiased text. Making them `ignored` would put nearly every subject in that
count, and the count would stop showing what anybody chose not to look at.
`changed.strict` and the sentence carry the disclosure.

**The incumbent arm keeps `0.1`.** `examples/todomvc/src/pixel/diff.ts` keeps
its own copy of `pixelmatch`'s defaults, because that arm stands in for what a
pixel tool ships.

**Stored baselines are not re-keyed.** The threshold is folded into the plan's
digest, and only `plan.test.ts` reads that digest. A subject whose colour
changed by between 1% and 10% since its baseline was recorded reports `changed`
on its next run.
