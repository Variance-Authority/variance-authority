# A/B testing: name what differs before you read the difference

Before you read a comparison of A with B, you need to know what is different
between them. When one thing differs, every difference in the result
belongs to it. When two things differ, nothing in the result says which one you
are looking at. Every pair that [Variance Authority](README.md) compares states
the one thing that differs between its sides — the revision, the time, the page
it was read on, an authored Act, or the subject itself — and a pair where a
second, undeclared thing also differs is refused rather than reported.

In product work, an A/B test sends some users to version A and some to version
B, and counts what they do. That tells you which version people prefer. It does
not tell you what version B changed on the page, or whether it still changes
the same thing after later edits. This page is about that second
question: both versions rendered, compared with each other, and the difference
named down to the component.

A **subject** is one named UI state you asked for and can ask for again,
identified by a stable id like `story:checkout--empty`. Every pair below is two
readings, and each reading is of one subject.

## Every pair states what differs

There are two kinds of pair. In the first, A and B are **one subject, read
twice**, and something about the reading changed. In the second, A and B are
**two subjects**, and you declared how they differ.

### One subject, read twice

| A | B | What differs | What you get | Where it is explained |
| --- | --- | --- | --- | --- |
| the approved baseline | this run's capture | the revision | a verdict, and for `changed` the component and the `file:line` | [Verdicts](information.md#verdicts) |
| the first reading | `again`: the same page, read later | time | `unstable`, with the component and the band that differ | [Flakiness](flakiness.md) |
| the first reading | `alone`: a new page built from the same recipe | what ran on the page before it | `order-dependent` | [Flakiness](flakiness.md) |
| the state before an Act | the state after it | the Act | a transition effect | [Runtime scenarios](scenarios.md) |

Only the first row compares against something a person approved. `again` and
`alone` compare two readings from one run, and each of them changes exactly one
thing. `again` runs first. A page that differs from itself over time says
nothing about what ran before it, so `alone` is asked only when `again` found
the two readings in agreement.

### Two subjects, compared on purpose

| A | B | What differs | What you get | Where it is explained |
| --- | --- | --- | --- | --- |
| a subject | a variation of it: the same page with a flag, a scheme or a viewport changed | the one axis you declared | a digest of the difference between the two | [Variations](variations.md) |
| a subject | another subject that renders the same component, at the same commit | the page around the component | an **echo** when both render it the same way, a **divergence** when one props digest renders two ways | [Composition](composition.md) |
| the first state of one execution | the first state of another | the precondition your harness arranged | an Arrange variation | [Runtime scenarios](scenarios.md) |

None of these pairs uses a baseline, and none of them is a regression. A dark
page is darker than its light parent, and reporting that as a failure reports
the subject for existing. A variation changes no verdict, no exit code and
nothing `variance accept` does.

## The same evidence means different things in each kind of pair

Take one component read twice. It was given the same props, the same context and
the same hook cells on both sides, and it rendered differently.

- **Both readings are of one subject.** That is a flake: nothing the component
  was given explains the new output.
- **The readings come from two subjects.** That is not a flake. The elements
  around a component decide where it sits, and no component receives its
  position as a prop, so two instances with the same inputs at two positions
  have contradicted nothing.

[`partingOf`](parting.md) — the comparison that names the input that sent two
readings apart — takes this as its third argument. `'same'` is the default and
means one subject read twice. `'elsewhere'` means two subjects, and a difference
at identical inputs then comes back as the slice `placed`, never `flake`. The
two arms of an experiment are two subjects on purpose, so compare them with
`'elsewhere'`. The slice `absorbed` is worth knowing for the same reason: an
input changed and the output did not, which for an experiment means a variant
was assigned and rendered nothing different. [What kind of difference
this is](parting.md#what-kind-of-difference-this-is) lists every slice.

## A pair with an undeclared difference is refused

When a second thing differs and nobody declared it, the result cannot say which
of the two it shows. The run refuses these pairs and names the reason:

- **Two painters.** The engine, the platform, the device scale, the fonts, the
  stabilization and the rasterization recipe together identify the renderer. A
  baseline and a capture that differ in any of them are reported
  `incomparable`, with the field that differs, and are not compared. [Which
  engine paints](comparison.md#32-capture-material-rendering-placement-and-which-engine-paints)
  explains why the engine is part of that identity.
- **A parent that names more than one subject.** A `variance-parent:` tag in
  short form that matches two subjects in the run is refused by name. It is not
  resolved by run order.
- **Two names for one coordinate.** A subject name lists its axes, and the
  [great green dragon rule](variations.md#link-by-name) says to write them in
  one fixed order, the way English says *great green dragon* and never *green
  great dragon*. Then each subject has one name and one parent.
  `checkout-dark-narrow` and `checkout-narrow-dark` break the rule: they are
  one subject written in two orders. When your configured name grammar reads
  two subject ids as the same point on every axis, both are refused by name.
  Without a grammar, the run does not know that `dark` and `narrow` are axes,
  so nothing is refused: the two names become two subjects with one rendering
  and two baselines, and [suite composition](composition.md) reports them as
  two subjects that render the same way.
- **An experiment that picks its own arm.** A page that assigns its variant per
  browser context, such as a percentage rollout, is one subject id with two
  possible renderings. Two readings that land in different arms are reported
  `unstable`. The run does not guess that they were a variation.

Pairs are declared before the run, by whoever writes the subjects. Comparing two
subjects you choose after the run has finished is outside this surface.

## Compare the two arms of an experiment

1. **Give each arm its own subject.** The collector that produces your
   subjects — Storybook, a route list, a Playwright fixture — sets the arm the
   way it sets any other state: a story sets args, a route sets a query
   parameter, a fixture sets a cookie or answers a request.
2. **Link the arm to the control.** Name the arm so that its id extends the
   control's id at a separator — `checkout` and `checkout-new-flow` — and keep
   the axes of every name in the order the great green dragon rule asks for, so
   the arm has one name and its parent is the control. When the name cannot say
   which subject is the control, tag the arm with the control's id:

   ```ts
   export const NewFlow = {
     tags: ['variance-parent:checkout--default'],
   };
   ```

3. **Run as usual.** The report prints the pair with the bands and components
   that differ, and a digest of the difference.

The digest is taken over the difference between the arms, not over either arm.
An edit that changes both arms the same way — a design token, a shared
component — leaves it as it was. It changes only when the experiment's effect
on the page changes, and that is the review nobody has done yet. An arm that
renders exactly like its control is reported as identical, which is a finding
when the arm was meant to change something.

Read it later with `npx variance report --config variance.config.json`, or ask
for it from an agent with `variance_variations`.

## What a pair compares

Every pair on this page compares documents before it compares pixels. A reading
is a [semantic snapshot](information.md#the-words): the normalized document
tree, with the cascade resolved to winning values. A difference is sorted into
bands — `a11y`, `geometry`, `token`, `content` and `texture` — and a raster is
compared only for a question the document cannot answer. A reading keeps a hash
per component per band, so each row above names a component and a band, and two
readings with equal digests cost a digest comparison and no paint. [Deciding at
the cheapest representation that can
decide](comparison.md#33-deciding-at-the-cheapest-representation-that-can-decide)
explains the order.
