# 0014 — Running the incumbent, and losing one row

**Branch:** B14 — replacement
**Steer:**

> *"expand of `cases`. Lets prove to ourselves how(exactly) we can replace other
> solutions on the market"*

The operative word is *exactly*, and the second one is *ourselves*. Neither is
satisfied by a feature table.

## What a case is, decided here

`cases/` had one occupant and no stated rule. Writing the second one forced the
rule out:

> **A case is a confrontation with something this project did not author.**

That is the whole line between `cases/` and `examples/`. The examples are our
corpus — our components, our declared ground truth, our mutations — and journal
0008 already recorded what that costs: a fixture that applied token overrides
inline on the subject root routed around a hole where `:root` tokens reached
nothing at all. A fixture convenient in the same way the implementation was
convenient tested nothing.

A case removes the convenience. Storybook writes the index; Playwright writes the
baselines and the wording of every failure. **We can be wrong there**, which is
the only property that makes an agreement worth anything.

## The arrangement

`@playwright/test` is installed, and its runner executes
`cases/incumbent-case/src/incumbent.spec.ts` in its own process, in the two phases
a team runs — record on the trunk with `--update-snapshots`, compare on the
branch. What our side reads afterwards is the JSON report that run wrote.

Nothing about the incumbent is reimplemented. This mattered more than expected:
see *What the run corrected*, below.

Both arms navigate to one `file://` page and observe one clip. Every variant is a
prop on one component tree rather than a second copy of the markup, so a
disagreement can only come from what each arm *observes*.

Two incumbent configurations, because one would have been a straw man whichever
it was. `strict` is what Playwright ships — no tolerance, so a single differing
pixel fails, which no real suite survives for long. `tolerant` sets
`maxDiffPixelRatio: 0.01`, which is the number teams reach for when antialiasing
starts costing them mornings.

## The corpus, and the question it is scored against

Ground truth is **not** *"did the image change"*. It is *must a reviewer be
told?* Those come apart in both directions:

- an `aria-label` deleted from an icon-only control changes no pixel and is a
  defect that ships
- a formatter reindenting JSX changes no rendering and is not a defect

A corpus built on "did the image change" cannot contain either row. That is worth
saying plainly, because it is how pixel tools come to be evaluated on corpora
where they do well.

Eight edits, declared with their arguments in `src/scenarios.ts` before either arm
ran.

## Result

```
scenario            ground truth  incumbent (defaults)  incumbent (tolerant)  ours
label-dropped       regression    miss                  miss                  hit          IconButton
heading-demoted     regression    miss                  miss                  hit          Heading
control-devolved    regression    miss                  miss                  hit          RowAction
indicator-dropped   regression    hit                   miss                  hit          Indicator
space-token-nudged  regression    hit                   hit                   hit          Panel, Toolbar
row-added           regression    hit                   hit                   hit          Total, Panel
unseen-subject      no defect     deferral              deferral              deferral     no baseline
note-reindented     no defect     hold                  hold                  false alarm  Note

  incumbent (defaults)  3 hit, 3 miss, 1 hold, 1 deferral
  incumbent (tolerant)  2 hit, 4 miss, 1 hold, 1 deferral
  ours                  6 hit, 1 false alarm, 1 deferral
```

**35 of 36 assertions passed on the first run**, the exception being one of our
own predictions.

### The finding worth keeping: three rows are not a tuning problem

`label-dropped`, `heading-demoted` and `control-devolved` are missed at **both**
incumbent configurations, and no third configuration would help. There is no
threshold, comparator or tolerance that finds a change which never reached a
pixel — the evidence is absent from the representation.

We settle all three at `pixels: 0, semanticOnly: true`, asserted rather than
claimed. That is the economic argument in its honest form: not *we are faster*,
but *nothing these edits changed was ever visible, so no screenshot was needed to
decide them*.

The fair objection is that a team catches these with `jest-axe` or a DOM
snapshot. True, and it is a second tool, a second suite and a second baseline.
The claim is one observation answering both questions, and the objection belongs
in the README rather than in a footnote.

### The second finding: the tolerance is measured against the wrong thing

```
tolerance          maxDiffPixelRatio 0.01 of 420×312 = 1310px
the indicator      36px
headroom           36×
```

A tolerance is a fraction of the **image**; a regression is a fraction of a
**component**. The two are on scales with nothing to do with each other, so the
smaller and more precise the affordance, the safer it is from being noticed — and
nothing in the output says which of the two a tolerance just absorbed.

`indicator-dropped` is built so its removal moves nothing around it. Had it
reflowed the toolbar the diff would be the reflow, a pixel differ would catch it
easily, and the row would have measured layout movement instead of how small a
real regression can be.

### The row where we lose

`note-reindented` renders identically and moves our hash, exactly as
`docs/flakiness.md` says it does. It is asserted as a false alarm so the day
somebody fixes it the suite goes red. A comparison that only ever finds in its
own favour is an advertisement.

## What the run corrected

Two declarations were wrong, and both corrections are in the source with the
reason attached. A prediction quietly edited to match its result is not a
prediction.

**`row-added` was declared as a refusal to measure.** Older write-ups describe
`toHaveScreenshot` hard-failing on a size mismatch with no comparison performed.
What 1.62 does is print both dimensions *and* a count over the padded canvas:
`Expected an image 420px by 312px, received 420px by 359px. 1967 pixels … are
different.` The scenario lost the property it was added for and now sits with the
others as a row about interpretability.

This is the entire argument for running their runner rather than reading their
documentation, arriving unprompted on the first run — the same way
`storybook-case` produced `React is not defined`.

**`indicator-dropped` was declared to name `Toolbar`.** It names `Indicator`.
Attribution resolves the component that *owns* the node, not the one containing
the region, so it was more precise than the declaration and the declaration moved.

## Migration, and what it costs

A better answer is half of "replace". A tool nobody can migrate *to* has replaced
nothing, so `src/migration.chromium.test.ts` starts from the PNGs their runner
recorded and re-records nothing.

Their baselines are ordinary PNGs, so there is nothing to convert, and the
reading end produces components and files from one on the first run. **Their
artifact format is not a format** — which is the fact cheap migration rests on,
and the one a proprietary blob or an API-only baseline removes.

Two costs, both measured rather than argued:

**A PNG carries no identity.** No engine, no scale factor, no fonts, no platform.
Our durable baselines are partitioned by renderer identity precisely so a
cross-machine run is `incomparable` rather than unattributable red (ADR-0011). An
imported baseline can only be compared by assumption, and the verdict guarding a
wrong assumption is unavailable for as long as the import lasts.

Not a defect in their design: a screenshot assertion has no identity to record
because it never compares across machines by construction. It becomes a cost the
moment the baseline outlives that assumption.

**A PNG is not a semantic baseline either**, and this is sharper. Attribution
needs one snapshot of the *current* state, so names and files survive the import.
*Ranking* needs a baseline document, because cause and collateral are decided by
what two documents say. So an imported subject can only be ordered by area — the
ordering journal 0013 measured as backwards. The same 17 regions:

```
by area   «no component» > Heading > Row > Row > … > IconButton
by cause  Heading > Total > IconButton > Indicator > … > Row
```

So migration is a generation rather than a switch: import to get moving, let the
imported baselines age out as subjects are re-recorded under an identity. The
generation tracking that would make that a product feature does not exist.

## Running the thing, which had never happened

A tool that answers better and has never been run replaces nothing, and
`comparison.md` §5 lists it as the first disqualifier: *"nothing above the CLI
boundary has been run once."* So the second half of this move was to write the
collector `cases/storybook-case` was missing and execute the workflow.

It works. Four steps, over a Storybook this project did not author:

| step | verdicts | exit |
|---|---|---|
| `variance run` on a fresh checkout | 8 new | **1** |
| `variance accept --all` | 8 accepted | 0 |
| `variance run` again | 8 unchanged, *nothing to review* | 0 |
| `variance run` on a build with one component edited | 3 unchanged, **5 changed** | **1** |

The last row is the measurement. `Button` appears in five of the eight stories and
the run finds exactly those five; the three that hold render no `Button`. The edit
is selected at build time rather than threaded as a prop, for the reason
`code-mutation.ts` records — a prop switch makes a source edit look like a
composition change and roots it at the story's entry point.

### It found five defects, and three made durable mode unusable

None was reachable from `run.test.ts`, which injects a fake `Collector` and a fake
`Renderer`. That is the right way to test the loop and no way at all to test the
*workflow* — whether a run leaves something `accept` can promote, whether a
promoted baseline is the one the next run finds, whether the exit codes mean what
they claim across a cycle.

1. **The run never exited.** `deps.renderer()` is a factory; nothing closed what
   it opened. A correct report printed and the process sat holding a browser. A
   fake renderer costs nothing to leave open.
2. **`stabilization` was dropped by `identityFrom`.** The codec rebuilds a
   `RenderIdentity` field by field and did not know about the optional one, so an
   identity survived being written and came back shortened. `accept` stored the
   baseline under the shortened digest; the next `run` looked up under the full
   one, found it under a *sibling* identity, and reported `incomparable`. On every
   subject, forever, on a single machine.
3. **The refusal named the same machine on both sides.** `describeIdentity`
   printed the renderer, engine, platform and scale — and neither the fonts nor
   the recipe, which are the other two fields `identityDigest` covers. So (2)
   surfaced as *"a baseline exists but was rendered by playwright-chromium
   (chromium@151, darwin/arm64, 1x)"* on a run that was playwright-chromium
   (chromium@151, darwin/arm64, 1x). Two identical descriptions of two different
   identities, and nowhere for the reader to go.
4. **The coverage section printed twice**, by the CLI and by the MCP tool it
   delegates to. Every assertion about it used `toContain`, which the first copy
   satisfies. The duplication is the exact failure `report.ts`'s own doc-comment
   warns against, arrived at from the other direction.
5. **A production Storybook build minifies**, so attribution reported *"1356
   pixel(s) differ … in a"*.

(2) is the one worth dwelling on, because it is the *third* appearance of one
failure: the write key and the lookup key computed by two rules. `deviceScaleFactor`
was the first (checkpoint M11), `identityFor` was introduced to close it, and this
was the same hole one field over — in a wire codec rather than in a renderer. The
regression test now asserts key-for-key rather than value equality, so adding a
field to `RenderIdentity` and forgetting the codec fails at the codec instead of
in somebody's durable workflow six weeks later.

(5) is not our defect and is the one to pass on. **Component attribution needs a
build that preserves function names.** React reads a display name off the
function; minification renames it; the chain then finds the right regions, joins
them to the right boxes, and reports a complete, confident answer naming
something that is in no source file — which is worse than naming nothing.
`keepNames: true`, and nobody would guess it.

### The gap it leaves open, stated because it is load-bearing

**Nothing on the durable path is a `cause`.** Every region comes back
`collateral`, and the largest belongs to the wrapper the edit displaced rather
than to the component that was edited.

Attribution is not what fails: regions land in the tree, name a component and
resolve to `src/ds.jsx:26`. *Ranking* fails, because separating cause from
collateral needs the previous revision's **snapshot**, and a durable run has a
baseline image without one. The ordering falls back to area — the ordering journal
0013 measured as backwards.

Which is the same sentence the migration half of this move arrived at from the
other end: *a PNG is not a semantic baseline.* There it is a cost of importing
somebody else's artifact. Here it is not an import at all — nothing in our own
durable pipeline carries one. `observePair` has both sides and `observeAgainstBaseline`
has one, and that asymmetry has been invisible for as long as the only thing
exercising it was a test that supplied `causes` by hand.

## Cost paid elsewhere

`tools/boundaries.test.ts` failed on the new workspace, correctly, and the fix was
to the rule rather than to the case: `.spec.` now counts as a test file alongside
`.test.`. The weaker import rule is about *when* code runs, not which runner runs
it, and holding a competitor's spec to the production rule would have put a second
test runner into a workspace's `dependencies`.

A limit of that test, found while adding the collector and not closed: it scans
`src/` only, so a workspace's `scripts/` and `collector/` directories are outside
rule 1 entirely. It matters little today — every `packages/*` workspace is
`src/`-only, and examples and cases are private and never installed — and it is
the kind of hole that stops being harmless the moment a package grows a build
script.

## What this does not establish

- One Mac, one Chromium, one clip size. Every pixel count moves elsewhere, and
  the tolerance arithmetic moves with the image size.
- One comparator. `pixelmatch` at Playwright's defaults — also what
  `jest-image-snapshot` uses and what several hosted products use underneath, so
  a bespoke differ would have proven less. Applitools' and Percy's are not this
  and are not measured.
- **The hosted products are not confronted at all.** A review UI, a team approval
  workflow, a cross-browser grid, change detection at repository scale — nothing
  here says anything about any of it. Claim 1 carries across on the shape of the
  thing rather than on a measurement, and is labelled as such.
- Eight scenarios, chosen by us because we believe they separate the tools. That
  is not a representative sample of a real suite.
