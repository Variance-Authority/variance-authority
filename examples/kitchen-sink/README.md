# kitchen-sink

This directory scores the comparison against answers written down before the run
that produces them. It holds a small component library and a table of 40 cases
over 8 subjects. A **subject** is one named UI state you can ask for again —
here one component composition, such as `button` or `dialog`. A **case** is two
renders of one subject plus the answer they should produce: `hash-stable` where
nothing a user could perceive changed, `hash-changed` where something did.
Because the answer came first, a run that agrees is evidence and a run that
disagrees is a defect report rather than a discussion.

What is being scored is **normalization** — the pass that turns a raw DOM
capture into the semantic snapshot a verdict is decided from: ids replaced by
structural aliases, class attributes dropped, inapplicable CSS pruned, the
cascade resolved to winning values. Two collection paths feed it, one under
`jsdom` and one under Chromium, and the corpus scores both.

## Running it

You need a checkout, Node 22 or newer, and, from the repository root:

```bash
yarn install
yarn build          # the fixtures import the packages' built output, not their src
```

The `chromium` half additionally needs a browser, and skips itself with a stated
reason if there is none:

```bash
npx playwright install chromium
```

Both commands below are run **from the repository root**:

```bash
yarn vitest run examples/kitchen-sink/src/measure.test.tsx
yarn vitest run examples/kitchen-sink/src/measure.chromium.test.tsx
```

## What you see

The `jsdom` run prints its score, then the cases it refused to score and why:

```
M0 CORPUS MEASUREMENT — jsdom
  scorable cases:       38  (20 stable, 18 changed)
  undecidable here:     1   wrapper-flex-block/wrappers
  contested (excluded): 1   dialog-open/dialog
  agreed:               38/38
  false unchanged:      0
  false changed:        0
```

**Scorable** is the declared cases a collection path is allowed to be graded on,
and **agreed** is how many of those it got right. **False unchanged** is the one
that must stay at zero — a real change reported as no change.

A case is **undecidable** where the path's own declared observation profile says
it cannot see the dimension in question, so scoring it either way would measure
blindness rather than the ruleset. `wrapper-flex-block/wrappers` is undecidable
under `jsdom` and scorable under Chromium — there is no layout engine in `jsdom`
to notice that the inserted `<div>` became the flex item — which is why the two
totals differ by one.

**Contested** is the case the corpus refuses to grade at all. `dialog-open/dialog`
has nothing deciding whether portalled content belongs to the subject; the two
defensible readings give opposite verdicts, and it is held out until a decision
exists rather than settled by whichever answer the implementation happens to
give. The run prints the whole argument rather than a label:

```
contested dialog-open/dialog: declared hash-changed, observed hash-changed — No ADR
defines the subject subtree for portalled content, and the two readings disagree
about the verdict. Under the DOM reading the panel is a child of `document.body`,
nothing inside the container changed, and the correct answer is `hash-stable` — a
modal dialog appearing is reported as `unchanged` [...]
```

38 + 1 + 1 is the 40 declared cases. Under Chromium it is 39 + 0 + 1:

```
M5 CORPUS MEASUREMENT — chromium (chromium@151.0.7922.34)
  scorable cases:       39  (20 stable, 19 changed)
  agreed:               39/39
  false unchanged:      0
  false changed:        0
```

The Chromium file also scores the two collection paths against each other, in
one file and one run so that it compares two observers rather than two runs. Of
the 40 cases, 38 are *comparable* — observable by both — and both answer
identically on all 38, with no divergence that was not declared in advance:

```
P4 — PROFILE AGREEMENT (jsdom vs chromium)
  comparable cases:      38
  declared divergent:    0
  must agree:            38
  observed agreement:    38/38
  undeclared divergence: 0

  band shifts (reported, not scored — the profiles observe different evidence):
    token-space-3/hero: jsdom token → chromium geometry
    prop-variant/button: jsdom token → chromium geometry
    prop-size/button: jsdom token → chromium geometry
    prop-primary-variant/hero: jsdom token → chromium geometry
```

(`M0`, `M5` and `P4` in those headings are this repository's internal ids for the
claims each block answers; the run prints them so a result can be traced back to
the claim it settles.) Two observers agreeing on the dimensions both can see is
what says the two collection paths implement **one ruleset** rather than two that
happen to look alike. The band shifts underneath are the opposite: cases where
Chromium sees a geometric consequence `jsdom` has no layout engine to notice.
They are reported, not scored.

## What the corpus caught

Nine defects, across two scoring runs — five in the first, under `jsdom`, four in
the second, under Chromium — and every one of them real, in the implementation
rather than in the declared answers. One repair was backed out and redone after
it produced a false `unchanged` under the other collection path.

They were found the same way each time: a case disagreed with the answer written
down for it before the run. The cases themselves are in
[`src/corpus-stable.ts`](src/corpus-stable.ts) (no-op refactors),
[`src/corpus-restyled.ts`](src/corpus-restyled.ts) and
[`src/corpus-restructured.ts`](src/corpus-restructured.ts) (real changes), each
row carrying the argument for its answer in a `rationale` field that the run
prints back when a case fails.

The defects share a shape a unit test does not catch. One over-eager
accessible-name fallback, for instance, handed every wrapper `<div>` the text of
its subtree as a name, which made it non-inert to the wrapper-collapse rule — so
no wrapper anywhere ever collapsed. The collector's own tests asserted on roles and names
and passed; four corpus cases did not.

## What a capture costs

The economic claim behind the persistent harness is that a semantic capture
costs less than a screenshot, and a harness that launches a browser per subject
spends that saving before it collects anything. Both halves call the same
`capture`, so the difference is process and navigation cost and nothing else:

```bash
yarn workspace @variance-authority/example-kitchen-sink bench
```

```
PERSISTENT HARNESS — cost of a capture
  captures:      48 distinct (subject, variant) renders
  cold            12940 ms   269.6 ms/capture   (browser + page + navigate + inject, per subject)
  warm              422 ms   8.8 ms/capture   (one browser, one page, no reload)
  ratio          30.7x
```

Those milliseconds are from an M4 Max with 64 GB running Node 26; the ratio is
the part that travels. The benchmark reads this package's compiled `dist/`, so
`yarn build` at the repository root is a prerequisite rather than a convenience.

## The scope of the result

One corpus, over one component library written in this repository. Both
collection paths agreeing on it establishes that they implement one ruleset. It
does not establish the ruleset's behaviour on a third-party component library,
and it gives no false-alarm rate for no-op edits outside this fixture set. The
fixtures were convenient in the same ways the implementation was convenient:
token overrides applied inline on the subject root routed around a hole where
`:root` tokens applied to nothing at all.

## The files

| Path | What it is |
| --- | --- |
| [`src/corpus.ts`](src/corpus.ts) | Assembles the 40 cases and resolves a row against a collection path |
| [`src/corpus-stable.ts`](src/corpus-stable.ts) | The no-op refactors — expected not to change the hash |
| [`src/corpus-restyled.ts`](src/corpus-restyled.ts), [`src/corpus-restructured.ts`](src/corpus-restructured.ts) | The real changes, each with a declared band |
| [`src/subjects.tsx`](src/subjects.tsx), [`src/variants.ts`](src/variants.ts) | The 8 subjects, and the complete description of how one was rendered |
| [`src/components/`](src/components) | The library under test — `Button`, `Card`, `Dialog`, `Field`, `Hero`, `ItemList`, `Tabs`, `Wrappers` |
| [`src/cruft/`](src/cruft) | The churn a no-op refactor really produces: id shifts, class salt, noise stylesheets, spelling |
| [`src/measure.test.tsx`](src/measure.test.tsx), [`src/measure.chromium.test.tsx`](src/measure.chromium.test.tsx) | The two scoring runs |
| [`src/corpus.test.tsx`](src/corpus.test.tsx) | Corpus integrity — every case renders, every perturbation actually perturbs |
| [`scripts/bench.mjs`](scripts/bench.mjs) | The cold-versus-warm capture benchmark |

The package is private and is not published; it exists to be run from a checkout.
