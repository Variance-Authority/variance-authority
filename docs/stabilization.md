# Holding a page still

**This is on by default and there is nothing to set up.** Animations are pinned,
GIFs are frozen, fonts and images are waited for, scrollbars are hidden — before
your subject is read, on every run, whether or not you knew it was a problem.

You are on this page for one of three reasons, and none of them is configuration:

- **Something still moved.** Go to [what is still not
  here](#what-is-still-not-here). It is a short list and it is honest.
- **You want to know what was done to your page.** The run tells you — see [the
  run says what it did](#the-run-says-what-it-did) — and the table below is the
  reference.
- **You are deciding whether to trust this.** Then the two sections worth your
  time are [what the baseline remembers](#the-baseline-remembers), which is the
  thing nobody else in the category does, and [what it
  costs](#what-holding-a-page-still-costs), which is measured.

A subject that is still changing cannot be compared, so every tool in this
category reaches into the page before it looks. The interesting questions are not
*whether* to do that. They are **when**, **what it costs**, and **whether the
baseline remembers it happened** — and the third is where the category stops
answering.

[`flakiness.md`](flakiness.md) is the position — what kind of thing variance is,
and the four ways a cause gets absorbed. This is the mechanism.

---

## The failure this exists to prevent

A card fades in over 300ms. Your first run reads it 120ms in, your second reads
it 180ms in, and nothing between the two commits changed a line of code.

Here is what the second run says:

```
CHANGED  story:card
  root:   Card  (src/components/Card.tsx:14)
  band:   texture — opacity 0.4 → 0.6
```

That is a false alarm wearing a name badge. A plain pixel differ would have told
you *1530 pixels moved* and you would have shrugged and hit re-run; this tells
you a component and a file, and you go looking for the edit. **Attribution makes
a false alarm credible**, which is why this project can afford flakiness less
than a pixel differ can.

It happened because the computed-style allowlist admits `transform`, `opacity`,
`filter`, `color` and every geometric longhand — and an animation in flight moves
all of them. The allowlist *excludes* `animation-*` and `transition-*` on the
stated grounds that a snapshot is taken with animations already disabled. Until
2026-08-06 nothing disabled them.
[ADR-0029](context/adr/0029-a-page-is-held-still-before-it-is-read.md) is the
repair.

---

## Two stages, two recipes

| | applied to | recipe |
|---|---|---|
| **Collection** | the live page, before the subject is read | `pin-animations`, `hide-scrollbars`, `wait-for-fonts`, `wait-for-images` |
| **Render** | the reconstructed page, before it is painted | `hold-animations`, `hide-scrollbars`, `wait-for-fonts`, `wait-for-images`, `hide-caret` |
| **The wire** | every response the page is served | `freeze-gifs`, `hash-assets` |

The collection and render recipes differ in exactly one trick and it is not a
preference: `hold-animations` is a *screenshot* option, and at collection nobody
takes a screenshot, so it would be a trick that silently does nothing.

Filtered by tier, so a jsdom collection applies **nothing** — no layout engine and
no animation clock means there is nothing to hold still, and a `fonts.ready` wait
per subject on the rung that exists to be cheap is the trade that rung refuses.

## What runs, and what it absorbs

Nothing here is a setting you were supposed to find. The table is a reference for
what already happened to your subject.

| trick | absorbs | and the limit, stated here rather than found later |
|---|---|---|
| `pin-animations` | CSS animations and transitions, held at their first frame | the first frame is where a fade-in is *invisible* — deterministic, and not where a user sees the component. CSS reaches CSS: `requestAnimationFrame` writing inline styles keeps running |
| `wait-for-fonts` | a font arriving after the subject was read | `document.fonts.ready` covers loads that have *started*; a font requested lazily by a later interaction is not in it |
| `wait-for-images` | an image whose intrinsic size had not landed | `document.images` at one moment. Anything appended during the wait is missed — the wire covers that |
| `hide-scrollbars` | a platform and preference difference, and the reflow at the overflow threshold | headless Chromium uses overlay scrollbars, so the classic scrollbar flake does not reproduce in CI at all |
| `hide-caret` | a cursor blinking on its own schedule | a screenshot option, so it applies at render and not at collection — a tier that never rasterizes cannot see a caret and must not pay to hide it |
| `freeze-gifs` | an animated GIF, served as its first frame | on the wire, so a cross-origin image is no harder than any other |
| `hash-assets` | *nothing* — it reports rather than absorbs | see [the wire](#the-wire-which-knows-what-the-page-cannot) |

<details>
<summary>How <code>pin-animations</code> works, and why it is not <code>animation: none</code></summary>

```css
*, *::before, *::after {
  animation-play-state: paused !important;
  animation-delay: -0.0001s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
```

`animation-play-state: paused` alone freezes an animation *wherever it happens to
be*, which is the flake held still rather than removed. The negative
`animation-delay` is what makes it deterministic: it seeks every animation to
(very nearly) its first keyframe before pausing it. `transition-duration: 0s`
collapses a transition to its end state, which is where it was going anyway.

`animation: none` is avoided because removing an animation drops whatever layout
its keyframes contribute — a component whose final position comes from a keyframe
jumps somewhere else. That changes the page rather than stopping it.

At render there is a better option and it is used: `hold-animations` is a
*screenshot* option, so the browser fast-forwards a finite animation to where a
user comes to rest and cancels an infinite one to its first frame. CSS cannot
express that, which is why both tricks exist rather than one.

Percy's answer to the JavaScript half is to disable JavaScript entirely on
re-render, which it can afford because it re-renders from a serialized DOM. Here
the page is yours and its JavaScript is the subject.

</details>

## Where the damage lands

Ordered by cost, earliest sufficient option first. **Every trick shipped here is
in the first band.**

| band | what it is | cost |
|---|---|---|
| **outside the subject** | injected CSS, screenshot options, a rewritten response | delete the tool and the intervention is gone |
| **runtime substitution** | wrapping `Promise`, replacing a suspense boundary | a difference caused by the patch is indistinguishable from one caused by the code |
| **a contract the subject implements** | a readiness marker in your component | real design damage |

The middle band is deliberately **not shipped** and deliberately **expressible**.
A project that decides the trade is worth it writes an `Intervention` and composes
it; that is what an open set is for.

### The one sheet, and why you cannot see it

Collection injects exactly one `<style data-va-stabilize>` and the collector's
stylesheet index **skips it**.

Not tidiness. The recipe's rules are `*, *::before, *::after` by construction, so
collecting them like any other sheet would attach a matched rule to every node in
every subject, churn every hash, and put a declaration nobody wrote into the
attribution of a component that did not write it. Skipping it is what makes the
first band of the table literally true.

What survives into your capture is the recipe's *effect* — `transform` reads its
first frame instead of a frame off the clock — and never the recipe.

## The run says what it did

```
stabilization: the subject was altered to be observable: animations pinned at
their first frame, which is not where a user sees them; scrollbars hidden,
removing a platform and preference difference — and their width; waited for web
fonts, whose advances change every metric on the page; waited for images to
decode, since their intrinsic size participates in layout
```

Printed near the top of `variance report`, before the docket, because it changes
how every image below it should be read. A fade-in captured at its first frame is
a correct observation of a page that was **altered to be observable**, and a
reviewer who does not know that is looking at a component in a state no user ever
sees and has not been told.

Each clause comes from the trick's own `because`, so a project that writes its
own gets a sentence here without editing anything, and a trick whose description
is wrong is wrong in exactly one place.

Absent means no collector reported stabilizing — which is a real state and not a
missing feature: a jsdom collection has nothing to hold still.

## The baseline remembers

```ts
snapshot.environment.inputs.stabilization  // 'v1:…', or undefined
```

The recipe digest is a **render input**, in the semantic key as well as the full
one. So:

- A baseline collected untouched and a run collected held still are **two
  baselines**. They are never compared, and the run says `incomparable` rather
  than inventing a component to blame.
- Turning a trick off, adding one, or retuning one is a re-baseline you are told
  about, on the run it happens, instead of a mass diff you have to work out.
- `undefined` means *observed untouched*, and is absent from the key rather than
  present-and-empty — because "no recipe ran" and "an empty recipe ran" are the
  same state and neither should look like a confident value.

**Nobody else in the category does this.** Argos and Percy both stabilize by
default and neither records which stabilizers ran in the identity of what they
produced, so changing one is a silent mass diff attributed to your code. It is
the same argument as ADR-0011's machine identity, applied to the tricks instead
of the machine.

---

## Turning it down

You almost certainly should not. Two callers legitimately want to:

```ts
routeCollector({
  routes: { … },
  // Observed untouched. The environment key records that, so these baselines
  // do not mix with stabilized ones.
  stabilize: [],
});
```

- A suite whose own determinism story is better than ours — it already freezes
  its clock, its data and its animations — where a second `!important` sheet is
  damage buying nothing.
- This repository's own test for what happens *without* it, which has to be able
  to ask for nothing and get nothing.

Naming a trick that does not exist **throws, and names what it knows**. The quiet
alternative — skip what cannot be resolved — turns a typo into a suite one trick
less stable than its operator believes, discovered later as a flake they had
already paid to prevent.

---

## What is proven

[`packages/route-collector/src/stabilization.chromium.test.ts`](../packages/route-collector/src/stabilization.chromium.test.ts),
against a real compositor rather than a simulation of one: a page with a 4s
linear infinite animation on `transform` and `opacity`, read twice about a second
apart through the real collector.

| | |
|---|---|
| observed untouched | the render hash **moves** |
| under `COLLECT_RECIPE` | the render hash **holds** |
| the two together | different `semanticDigest`, so they are never compared |
| the injected sheet | appears nowhere in the subject |

And for the wire, in
[`packages/playwright/src/network.chromium.test.ts`](../packages/playwright/src/network.chromium.test.ts)
and
[`packages/route-collector/src/network.chromium.test.ts`](../packages/route-collector/src/network.chromium.test.ts):

| | |
|---|---|
| an animated GIF, unwatched | screenshots of it **differ** |
| the same GIF, frozen on the wire | three seconds of screenshots, all **identical** |
| an image swapped behind its URL | the environment key **moves**, with no DOM change at all |
| the same run with `network: false` | the asset map is empty, and visibly so |

The GIF fixture is built byte by byte in the test, with real LZW, and every
sampling run first asserts `naturalWidth === 8` — because a GIF that failed to
decode paints nothing in *both* arms, and "held still" and "never arrived" would
otherwise have the same signature.

The first row is asserted as a *reproduction*: if the flake ever stops
reproducing, that test goes red rather than quietly guarding nothing. Every other
instability measurement in this repository simulates its cause — a smoothing mode
standing in for a GPU driver, a second browser context for a second runner. This
one does not.

---

## The wire, which knows what the page cannot

Everything above happens *inside* the page, and inside the page is the wrong
place for a whole class of question. `document.images` is a list of nodes that
existed at one moment: it misses an image appended while you were waiting, it
has no entry for a CSS `background-image` (which has no load event at all), and
it cannot tell you what the bytes were.

The driver sees every response. So since 2026-08-06 it watches.

### Every asset is hashed into the environment key

```ts
snapshot.environment.inputs.assets
// { 'https://app.test/logo.png': 'v1:9f3c…', 'https://app.test/Inter.woff2': 'v1:20ab…' }
```

`EnvironmentInputs.assets` has existed since the format did, documented as
"external assets keyed by request URL, valued by content hash", with its own
warning that an uncovered input is a false `unchanged`. **It was filled by
nobody.** Every run in this repository's history hashed an empty object, so a
logo re-exported at a different compression, a hero image swapped behind a CDN
path, or a font replaced under the same URL produced a different picture under an
identical key — and the run said `unchanged`.

That is the one failure this product exists to prevent, and it was open the whole
time because the field that closes it had no source. A page cannot be that
source: it can read a URL and not the bytes behind it.

Hashed: `image`, `font`, `media`. Not hashed: documents, scripts and stylesheets,
whose effect on the render arrives through the capture itself — the DOM, the rule
text — so hashing them buys a second copy of a covered input.

### Animated GIFs are frozen on the wire

A GIF has been animating since it decoded, and no CSS reaches it —
`animation-play-state` governs CSS animations and a GIF is not one.

Argos solves this in the page and the design is careful: build a *fresh* `Image`,
draw it to a canvas, take `toDataURL('image/png')` as frame zero, swap it into
`src`. Fresh, because the element already on the page has been animating since
load and cannot be seeked back. Its documented failure mode is cross-origin: no
CORS grant means a tainted canvas, `toDataURL` throws, and the GIF keeps
spinning.

Doing it on the wire removes the problem rather than handling it. The bytes have
not been decoded yet, so there is nothing to seek back and no second decode to
pay for; cross-origin stops mattering, because the fulfilment is ours and nothing
asks the page to read anything; and the result is **the original bytes minus some
of them** — a GIF truncated to its first image block plus a trailer, which is a
valid single-frame GIF. The palette, the transparency, the dimensions and the
compression are exactly what the author shipped, where a canvas round-trip
re-encodes through RGBA into a different image from the one under test.

No decoder, no encoder, no dependency. What it will not do is guess: bytes that
are not a GIF, a GIF that already holds one frame, and a file whose blocks it
could not parse are all passed through untouched, because a truncation taken from
a position the parse cannot vouch for is a corrupt asset served to a browser.

It also **says what it froze** — `network.frozen` is the list of URLs — because a
stabilizer that rewrites an asset silently can change the picture a reviewer is
looking at with no record that it did.

### Waiting on what was actually requested

`network.settle()` resolves when nothing is in flight. Not a poll over the nodes
that existed at one moment: a count of what has been asked for and not yet
answered, which is the honest version of "the images have loaded".

On timeout it does not throw. A page holding a long-poll open is a normal page,
so the outstanding URLs become a diagnostic and the subject is read anyway —
recorded, which is what the reader of a surprising diff needs.

### What the wire costs

Routing disables the browser's HTTP cache for what it routes, and every routed
request makes a round trip into Node. Only asset requests are fetched and read;
everything else is continued without its body. Set `network: false` on the
collector to turn it off — the assets map is then empty, and an empty map is
visibly a run that recorded nothing rather than a run that had nothing.

Wired into the route collector today. **Not yet into the Storybook collector**,
and the reason is worth stating: a Storybook run is one navigation and N
subjects, so the wire cannot tell which story an image belonged to, and every
story would carry the whole page's asset set. That over-invalidates rather than
under-invalidates — the safe direction — but it is noise, and the fix is for the
page to report which URLs its subject actually references.

---

## What holding a page still costs

Measured, because a stabilization claim is only free if you do not check.

```
STABILIZATION COST — 12 collections of one subject, warm
  untouched    2.5 ms/subject
  held still   2.3 ms/subject
  difference  -0.2 ms/subject
```

Nothing, within noise — and it was **25.8 ms/subject** until the run that
measured it. The recipe injects a sheet, awaits fonts and images, and then waits
two animation frames for the pinned state to be in force; the two frames are the
whole cost, and on every subject after the first there is nothing for them to
wait for. The sheet is already there, its CSS is unchanged, and an animation
paused at its first frame stays paused.

So the frame wait is skipped when the CSS is unchanged — a condition that reads
off the page rather than a counter somebody has to keep correct. Eleven times the
cost of the reading itself, removed, on every subject but one. On a two-hundred
subject suite that is five seconds a run.

The first subject still pays, and should: that is the one where the sheet arrives
and something is genuinely moving.

Produced by
[`packages/route-collector/src/stabilization.chromium.test.ts`](../packages/route-collector/src/stabilization.chromium.test.ts),
which also holds the regression to under 20 ms — so putting the two frames back
into every subject fails the suite rather than showing up as a slow CI job
nobody attributes to anything.

---

## What is still not here

Stated rather than left for you to find.

- **CSS `background-image`** is fetched and therefore *hashed*, but nothing pins
  a subject's wait to it specifically; `settle()` covers it only because it
  covers every request.
- **`srcset` re-resolution** on a viewport change can leave a fractional height
  difference, because browsers reuse a cached candidate. Argos parses `srcset`
  and pins a single candidate; this does not.
- **Dates, clocks and dynamic content** are absorbed by *policy*, not here — see
  [`ignores.md`](ignores.md), which masks the element or the shape of the
  difference rather than a coordinate region.
- **Hover state** is not reset before a subject is read.
- **Sticky and fixed positioning** are not neutralized for a full-page capture.
- **Spellcheck squiggles** and **subpixel image sizing** are not addressed.

The last four are all tricks Argos ships and this does not, and none of them is
hard — they are `Intervention` values nobody has written yet. The registry is
open precisely so that adding one is a value and not a fork.

---

**See also.** [`flakiness.md`](flakiness.md) — what kind of thing variance is ·
[`ignores.md`](ignores.md) — absorbing what cannot be stabilized ·
[`comparison.md`](comparison.md) — where each competitor wins ·
[ADR-0029](context/adr/0029-a-page-is-held-still-before-it-is-read.md) — the
decision and what it does not close
