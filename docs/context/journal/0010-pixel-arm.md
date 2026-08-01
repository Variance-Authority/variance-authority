# 0010 — The pixel arm, and the headline example we got wrong

**Date:** 2026-08-01
**Cycle:** helix 4, the head-to-head
**Branch:** worktree-agent-ad46dc124f5fa08e5

## Move

Build the *other* arm. Real Chromium, real `page.screenshot`, real `pixelmatch`,
over the fifteen stories and eight mutations of `examples/todomvc`. Then measure
what it costs, what it catches, and — the part that mattered — whether the
`visible: true/false` field in `mutations.ts` survives contact with a real
rasteriser.

**Expected readback:** the two `visible: false` mutations produce zero differing
pixels, confirming the corpus's construction argument.
**Disconfirming readback:** one of them differs, and the example this project is
sold on is wrong. This is what happened.

Reproduce, all of it:

```bash
yarn install --no-immutable
npx playwright install chromium
yarn build
yarn workspace @variance-authority/example-todomvc pixel          # the report
yarn workspace @variance-authority/example-todomvc pixel --write  # ... plus PNGs
yarn vitest run examples/todomvc/src/pixel.chromium.test.ts       # the assertions
```

Three consecutive runs on one machine (M-series mac, chromium@151.0.7922.34) were
**identical** in every default-policy number quoted below. The strict-policy
numbers were not; see "Flakiness".

## 1. `broken-toggle` is not invisible. The declared ground truth is wrong.

```
GROUND TRUTH CHECK — mutations declared visible: false
broken-toggle     REFUTED — real pixels differ
                  changed stories 6/15   default 5482 px   strict 11489 px
                    ds/toggle--states             default    381   strict    571   of   27808 px   (resized)
                    page/todos--populated         default   1530   strict   3268   of  451248 px
                    page/todos--active-filter     default   1019   strict   2154   of  386784 px
                    page/todos--completed-filter  default    511   strict   1114   of  321056 px
                    page/todos--drafting          default   1530   strict   3268   of  451248 px
                    page/item--done               default    511   strict   1114   of   60672 px
noop-refactor     HELD — pixel-identical, even byte-exact
                  changed stories 0/15   default 0 px   strict 0 px
```

`mutations.ts` declares:

> Pixel-identical by construction: the `<div>` carries the same classes and
> therefore the same box, the same background, the same border, the same radius.
> A camera sees nothing.

**Every clause of that is false in a real engine.** An `<input type="checkbox">`
is a *native control*. Chromium does not paint it from the author stylesheet at
all — with `appearance` left at `auto` it paints a platform widget: its own accent
fill, a white checkmark glyph, its own border treatment, and its own UA margin.
A `<div>` carrying `class="va-toggle va-toggle--on"` paints what the author
asked for: a flat blue rounded square, no checkmark.

Side by side, `ds/toggle--states` at `pixel-out/`:

- baseline — an empty checkbox and a checked one **with a tick**
- mutated — an empty rounded square and a solid blue rounded square, no tick

It is not even the same size. The screenshots are **1264×22 baseline, 1264×18
mutated** — a 4px height change from the UA margin the `<div>` does not carry. So
the edit is not merely visible, it *reflows*: `expect.impact: 'structural'` was
right and `visible: false` was wrong for two independent reasons.

I have **not** edited `mutations.ts`. It is the ground truth and adjusting it to
match a tool's output — even to match a measurement — is how a corpus stops being
evidence. But it must be changed by whoever owns it, and the field is wrong today.

### What this costs the project's argument

The README-level story is "a pixel differ structurally cannot see the broken
toggle". On this fixture, in this browser, **it can, easily, at default
settings** — 5482 pixels across 6 of 15 stories. `broken-toggle` still separates
the two arms, but on a different and weaker axis:

- The pixel differ says *six screenshots changed*. It does not and cannot say
  that a form control lost its role, its checked state, its label association,
  and its keyboard reachability. A reviewer looking at the diff sees a blue
  square that lost a tick and may well approve it as a deliberate restyle.
- So the honest claim is **not** "invisible to pixels" but "**visible to pixels
  and unclassifiable by them**" — the accessibility regression is legible in the
  semantic capture and is nowhere in the raster.

If the project wants a genuinely camera-invisible defect, this fixture does not
supply one and would have to be rebuilt: `appearance: none` on `.va-toggle` plus a
matching author-drawn checkmark would make `<input>` and `<div>` actually
pixel-identical, and would restore the original claim. That is a change to the
example's design system, not to the mutation, and I did not make it unilaterally.

`noop-refactor` **held**, exactly as declared: inert wrappers and churned
generated class names produce a byte-identical PNG on all fifteen stories. That
is the case where a pixel differ is *right* and a naive structural diff cries
wolf, and it is worth keeping in the record for that reason.

## 2. What a pixel differ can report

```
WHAT A PIXEL DIFFER REPORTS
mutation          layer         declared  shots  wall     PNG      changed  diff px      diff px
                                visible                            stories  (default)    (strict)
token-radius      foundation    true         15  1068ms  116KiB     8/15         1021         7428
token-space       foundation    true         15  1078ms  109KiB    12/15        28986       131555
token-accent      foundation    true         15  1059ms  106KiB     8/15         1908         2640
token-type-scale  foundation    true         15  1076ms  110KiB     9/15        22468       103421
button-padding    design-system true         15  1064ms  106KiB     9/15         3111         7054
filter-reorder    page          true         15  1067ms  106KiB     6/15         5678        20011
broken-toggle     page          false        15  1063ms  106KiB     6/15         5482        11489
noop-refactor     none          false        15  1061ms  106KiB     0/15            0            0
```

`wall` is shoot-plus-diff for that mutation's fifteen screenshots. Baselines cost
a further **15 shots, 996 ms, 106 KiB**, charged once for the whole run and not
once per mutation — a real VR system compares a branch against goldens committed
to the repository, and re-shooting them eight times would have inflated the pixel
arm's cost eightfold with work no honest caller performs. Whole run: **135
screenshots, ~1.2 MiB of PNG, ~9.5 s of screenshotting.**

The `changed stories` column *is the output*. There is no cause, no grouping, no
component name, no layer. Seven of the eight mutations produce a review queue of
6–12 screenshots and no statement about what to look for in them.

## 3. Can the pixel arm tell the layers apart? Empirically: no.

```
token-radius      foundation    ds/button--primary ds/chip--group page/todos--empty page/todos--populated
                                page/todos--active-filter page/todos--completed-filter page/todos--drafting page/footer--counts
token-accent      foundation    ds/button--primary ds/chip--group page/todos--empty page/todos--populated
                                page/todos--active-filter page/todos--completed-filter page/todos--drafting page/footer--counts

INDISTINGUISHABLE: token-radius (foundation) and token-accent (foundation) changed exactly the same stories.
```

Two different foundation edits — a corner radius and a brand colour — change
**exactly** the same eight stories. Given only the set of changed screenshots the
two change sets are the same object. One is `impact: 'paint'` on a shape, the
other is `impact: 'paint'` on a colour, and a reviewer cannot even tell which
token was touched without opening the images.

The other six sets happen to be distinct, and it is worth being precise about
what that does and does not mean:

- `token-space` (12 stories) is wider than `button-padding` (9), which is wider
  than `filter-reorder` (6). A human who already knows the story set can infer
  "something broad" versus "something about Button".
- But that inference is the human's, done by reading fifteen file names. Nothing
  in the pixel output distinguishes `button-padding` (a design-system edit
  reaching every page that uses Button) from `token-type-scale` (a foundation
  edit) — both light up three `ds/*` stories and six `page/*` ones.
- And the inference fails outright on the pair above.

So: **distinct sets are not identified causes.** A distinct set is a distinct
*symptom list*, and the mapping from symptom list to cause is the reviewer's
unpaid work — which is the whole thing this project claims to automate.

## 4. What pixel VR costs

```
WHERE THE TIME GOES — 15 renders per pass, same stories, same page
mount only                       16ms   1.1 ms/story
mount + screenshot              995ms   66.3 ms/story
mount + semantic capture         68ms   4.5 ms/story
=> screenshot 65.4 ms, semantic collection 3.4 ms, on top of a 1.1 ms mount both arms pay
```

Three passes over the same stories in the same process on the same page, so the
cost of a screenshot is a subtraction rather than an assertion.

**A `page.screenshot` costs ~19× a semantic collection** (65.4 ms vs 3.4 ms), and
~60× the mount both arms pay for. Add `pixelmatch` on top: diffing is cheap here
(single-digit ms per mutation across fifteen images) but it is not free and it
scales with image *area*, which grows with the page.

This is the number the checkpoint's "Next" section asked for:

> the only thing that can turn "27x cheaper than relaunching a browser" into
> "cheaper than a screenshot", which is the claim the product is sold on.

**The claim holds, at 19×, on this machine and this corpus.** Two caveats that
belong next to it and not in a footnote:

- Journal 0007 measured a warm chromium capture at 7.5 ms on the kitchen-sink
  corpus; this measures 4.5 ms on todomvc. Different corpus, different subject
  sizes — do not treat these as the same number improving.
- The pixel arm here is running under the *same* persistent-harness optimisation
  we built for ourselves. A pixel arm that relaunched a browser per story would
  look far worse, and quoting that would have been a straw man. This 19× is
  against the strongest version of the opponent.

## 5. Flakiness — the honest finding runs in pixel VR's favour, mostly

```
FLAKINESS — 5 rounds over 15 stories, nothing changed
                                           default policy      strict policy
same-mount (shoot twice, touch nothing):  0, 0, 0, 0, 0       0, 0, 0, 0, 0
remount    (render it again, then shoot): 0, 0, 0, 0, 0       130, 91, 91, 91, 106
stories that moved with no edit at all (worst of any round):
    ds/card--basic                default     0   strict    25
    page/todos--empty             default     0   strict    25
    page/todos--active-filter     default     0   strict    15
    page/todos--drafting          default     0   strict    41
strict noise floor across the story set: 106–130 px
```

Two flavours, because they fail in different places. `same-mount` shoots twice
without touching the page — **byte-identical, every round, every story.** The
camera is not flaky. `remount` tears the story down, renders a different story,
renders it back, and shoots again — the path every number in this journal went
through — and there the strict policy sees **90–130 differing pixels across the
fifteen stories**, on antialiased text edges, landing on a different subset of
stories each round.

At `pixelmatch`'s own defaults (`threshold 0.1`, `includeAA false`) that noise is
**zero, in all ten rounds measured.** The AA-forgiving default is not a fudge —
it is the thing that makes pixel VR usable, and it works.

Two consequences worth writing down:

- **This is why the report quotes two policies.** An earlier revision of the
  runner took the baselines *before* the flakiness rounds, and in that ordering
  `noop-refactor` reported **35 strict pixels** on `ds/button--default` (24) and
  `ds/button--primary` (11) — a mutation that touches neither button. It was
  jitter. I moved the flakiness pass ahead of the baselines so the per-story
  noise floor is known *before* the mutation numbers are read, rather than
  discovered afterwards with the answer already in hand. With that ordering
  `noop-refactor` is 0 at both policies across three runs. **Had I only quoted
  the strict number and only run once, I would have reported a false detection
  on a mutation whose entire purpose is to be a no-op.**
- The first screenshot of a cold page is not the same as the hundredth. The one
  warm-up shot before any clock starts is load-bearing; without it the first
  mutation in iteration order was several pixels off.

## 6. Being fair to pixel VR: three things it catches and we do not

Built rather than conceded. `src/pixel/probes.tsx` holds three fixtures, each a
real user-visible change; each is measured on **both** arms in the same run,
because "pixels caught something we missed" is only a finding if the semantic
render hash is shown to hold.

```
BLIND SPOTS — changes the pixel arm sees
canvas-repaint    not-in-dom          default     857 px   strict    2031 px
                  semantic renderHash HELD (we are blind)   structure held   style held
accent-color      not-in-allowlist    default     114 px   strict     161 px
                  semantic renderHash HELD (we are blind)   structure held   style held
text-stroke       not-in-allowlist    default     463 px   strict    2016 px
                  semantic renderHash HELD (we are blind)   structure held   style held
```

All three: **pixels move, our render hash does not.**

1. **`canvas-repaint` — not a gap in the allowlist, a gap in the observable.**
   A `<canvas>` holds its bitmap in a context, not in the document. Two
   attribute-identical documents paint different pictures and *nothing in a
   snapshot of the tree can reach it*. This is unfixable by adding properties.
   The only honest answers are (a) declare canvas/WebGL/video subtrees out of
   scope and say so loudly, or (b) hash the bitmap via `toDataURL`, which is a
   raster stage by another name and reintroduces every determinism problem
   section 5 measures. The same reasoning covers `<video>`, WebGL, and — with a
   twist — **images fetched from a URL whose bytes changed**: `collect` takes
   `assets` as caller-supplied content hashes, so a swapped image behind a stable
   URL is invisible unless the caller happens to supply them. Nothing in the
   corpus checks that they are.

2. **`accent-color` — not in `STYLE_ALLOWLIST`.** It repaints native controls.
   Note the irony: this is the exact property that would let someone restyle the
   checkbox in `ds/toggle--states`, i.e. a change to the very component the
   `broken-toggle` mutation is about, and we cannot see it.

3. **`-webkit-text-stroke-width` — not in `STYLE_ALLOWLIST`.** Thickens every
   glyph in the subject. 463 changed pixels on one paragraph.

2 and 3 are one line each in `ruleset.ts` plus an `ALLOWLIST_VERSION` bump. I did
not add them: the allowlist is `core`'s, the version bump invalidates every
baseline, and doing it inside the branch that measures the pixel arm would mix a
ruleset change into a measurement. They belong in their own change with the
question asked properly — *what else is missing?* — because these two were found
in an afternoon by a person who went looking, which is weak evidence that they
are the only two.

The general shape of the hole: **the allowlist models what an author declares
about a box, and models the platform's own painting poorly.** Native form
controls, text rasterisation, and anything drawn imperatively are where a camera
beats a tree.

## What I could not do, and what I got wrong

- **One machine, one Chromium, one font stack.** Every number here is from an
  M-series mac at `deviceScaleFactor: 1`. Font metrics decide rects and rects
  decide pixels; a different machine will produce different counts and the
  environment key would not say so — the same limitation journal 0007 records,
  now also true of every pixel count.
- **I got the ordering wrong first, and it produced a false detection.**
  Documented in section 5 rather than quietly fixed. The general lesson matches
  journal 0007's: a measurement whose noise floor is established *after* the
  result is a measurement that chose its own threshold.
- **Screenshots are clipped to `#subject`, not the viewport.** That is the
  strongest honest version of component VR and it is also a choice that flatters
  the pixel arm's byte count. A full-page VR tool would shoot 1280×720 every
  time — roughly 6× the bytes here — and would also report a changed screenshot
  whenever anything above the component moved. I measured the better one.
- **No cross-browser arm.** A large part of what real VR deployments spend on is
  running the same shots on three engines. That multiplies the 65 ms and every
  flakiness number, and it is not measured here.
- **The blind-spot probes are ours.** Three fixtures, written by the person
  arguing the other side. They are real, they are checked on both arms, and they
  are not a survey.
- **`page/harness.html` pins `color-scheme: light` and Playwright's context
  `colorScheme`.** Without both, the pixel arm reports every story as changed on
  a dark-mode host. Real VR deployments discover this the hard way; ours is
  declared. That is a point in favour of *declaring* render inputs, not a point
  about either arm.

## Contradictions with what is written down elsewhere

- **`examples/todomvc/src/mutations.ts`, `broken-toggle`, `visible: false`** and
  its accompanying comment ("Pixel-identical by construction … A camera sees
  nothing"), and the same claim in `ds/components.tsx`'s `Toggle.asDiv`
  documentation ("It is pixel-identical to the correct rendering"): **measured
  false.** 5482 differing pixels at default settings, plus a 4px height change.
  Not edited, per the constraint that ground truth is not adjusted to fit
  results.
- **`docs/context/checkpoint.md` → Next**: "the only thing that can turn '27x
  cheaper than relaunching a browser' into 'cheaper than a screenshot'". That
  item is now answered — 19× — and the checkpoint has not been edited, because
  the semantic arm's own numbers land in the same cycle and one hand should write
  that summary.
- **ADR-0003's opening** treats "cheaper than a screenshot" as the motivating
  intuition. It now has a number behind it on one corpus.

## Verification

```bash
yarn build && yarn test
```

407 passed, 3 skipped, 18 files. The three skips are the two pre-existing
"needs a Chromium download" markers plus the pixel arm's own — that branch is
skipped precisely *because* Chromium was present and the real tests ran. On a
machine with no browser the count inverts and the pixel arm reports one skip
naming the command to fix it, rather than a red suite that means "install
something".
