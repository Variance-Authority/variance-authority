# Holding a page still

**This is on by default. There is nothing to configure unless you want less of
it.** The page below is a reference for what already happened to your subject,
and an argument about which of it is honest.

A subject that is still changing cannot be compared, so every tool in this
category reaches into the page before it looks: it holds animations, waits for
fonts, hides a caret, suppresses scrollbars. The interesting questions are not
*whether* to do that. They are **when**, **what it costs**, and **whether the
baseline remembers it happened.**

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

## What runs, and when

Two stages, two recipes. The difference between them is one trick, and it is not
a preference.

| | applied to | recipe | contains |
|---|---|---|---|
| **Collection** | the live page, before the subject is read | `COLLECT_RECIPE` | `pin-animations`, `hide-scrollbars`, `wait-for-fonts`, `wait-for-images` |
| **Render** | the reconstructed page, before it is painted | `RASTER_RECIPE` | `hold-animations`, `hide-scrollbars`, `wait-for-fonts`, `wait-for-images`, `hide-caret` |

`hold-animations` is a *screenshot option* — it asks the browser to settle
animations for the image it is about to take. At collection nobody takes an
image, so it is a trick that would silently do nothing. `pin-animations` is the
same intent expressed in CSS, which works where there is no camera, and the two
stay separate values because they leave the page in **different states**: a
browser settling animations fast-forwards a finite one to where a user comes to
rest, and CSS pinning holds it at its first frame.

Filtered by tier, so a jsdom collection applies **nothing**. No layout engine and
no animation clock means there is nothing to hold still, and a `fonts.ready` wait
per subject on the rung that exists to be cheap is the trade that rung refuses.

---

## The tricks

Each is a value with an id, the tier that can observe what it fixes, what it
costs in one sentence a report can print, and the property it governs. They are
an **open registry**, not a struct of booleans: a project with a need nobody
anticipated adds one rather than forking.

### `pin-animations` — CSS animations and transitions

```css
*, *::before, *::after {
  animation-play-state: paused !important;
  animation-delay: -0.0001s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
```

**How it works.** `animation-play-state: paused` alone freezes an animation
*wherever it happens to be*, which is not deterministic — it is the flake, held
still. The negative `animation-delay` is what makes it deterministic: it seeks
every animation to (very nearly) its first keyframe before pausing it, so two
runs a second apart read the same frame. `transition-duration: 0s` collapses a
transition to its end state, which is where it was going anyway.

**Why not `animation: none`.** Removing an animation drops whatever layout its
keyframes contribute, so a component whose final position comes from a keyframe
jumps somewhere else. That changes the page rather than stopping it.

**Limits.** The first frame is where a fade-in is *invisible*, which is
deterministic and is not where a user sees the component. And CSS reaches CSS: an
animation driven by `requestAnimationFrame` writing inline styles, or by the Web
Animations API, keeps running and reaches the representation exactly as before.
Percy's answer is to disable JavaScript entirely on re-render, which it can
afford because it re-renders from a serialized DOM. Here the page is yours and
the JavaScript is the subject.

### `wait-for-fonts` — web fonts

Awaits `document.fonts.ready`. A font that arrives after the subject was read
changes every advance, and therefore every rect, on the page.

**Limits.** `document.fonts.ready` resolves against loads that have *started*. A
font requested lazily — by a rule that only matches once some later interaction
happens — is not in it. Fonts are also in the environment key by identity, so a
substituted font is `incomparable` rather than a silent diff; see
[`flakiness.md`](flakiness.md).

### `wait-for-images` — images that have not decoded

Awaits `load` or `error` on every `document.images` entry that is not
`complete`. An image's intrinsic size participates in layout, so a subject read
before decode has a different box tree.

**A 404 counts as settled**, deliberately. A broken image is a stable state and
blocking on it turns a missing asset into a timeout with no cause.

**Limits.** `document.images` at the moment of the wait. Anything appended while
the wait is running is missed, and CSS `background-image` has no load event at
all, so it is not covered here. Both are answered a layer down, on the wire —
see [the wire](#the-wire-which-knows-what-the-page-cannot).

### `hide-scrollbars` — scrollbar width

```css
* { scrollbar-width: none !important }
*::-webkit-scrollbar { display: none !important }
```

Removes a platform difference, a user-preference difference, and the reflow that
happens when content crosses the overflow threshold.

**Limits.** Headless Chromium uses overlay scrollbars, so the classic
scrollbar-reflow flake does not reproduce in CI at all — a blind spot shared with
every headless pipeline, [written up](context/journal/0012-instability.md)
rather than deleted.

### `hide-caret` — the text cursor

A screenshot option (`caret: 'hide'`). A caret paints and does not lay out, so a
tier that never rasterizes cannot see it and must not pay to hide it — which is
why it is in `RASTER_RECIPE` and not in `COLLECT_RECIPE`.

### `hold-animations` — animations, at render

A screenshot option (`animations: 'disabled'`). The browser settles animations
for the image: a finite animation is fast-forwarded to completion — the state a
user comes to rest on — and an infinite one is cancelled to its first frame and
replayed afterwards. **That is better than `pin-animations`** and CSS cannot
express it, which is why both exist.

---

## Where the damage lands

Ordered by cost, earliest sufficient option first. Every trick shipped here is in
the first band.

| band | what it is | cost |
|---|---|---|
| **outside the subject** | injected CSS, browser screenshot options | delete the tool and the intervention is gone |
| **runtime substitution** | wrapping `Promise`, replacing a suspense boundary | a difference caused by the patch is indistinguishable from one caused by the code |
| **a contract the subject implements** | a readiness marker in your component | real design damage |

The middle band is deliberately **not shipped** and deliberately **expressible**.
If a project decides the trade is worth it, it writes an `Intervention` and
composes it; that is what an open set is for.

### The one sheet, and why you cannot see it

Collection injects exactly one `<style data-va-stabilize>` and the collector's
stylesheet index **skips it**.

That is not tidiness. The recipe's rules are `*, *::before, *::after` by
construction, so collecting them like any other sheet would attach a matched rule
to every node in every subject, churn every hash, and put a declaration nobody
wrote into the attribution of a component that did not write it.

What survives into your capture is the recipe's *effect* — `transform` reads its
first frame instead of a frame off the clock — and never the recipe. This is what
lets the first band of the table above be literally true.

The sheet is rewritten rather than appended, so a session running thirty subjects
through one document does not accumulate thirty of them. It is also left in place
between subjects on purpose: removing it would restart every animation just
before the next subject is read.

---

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

### What it costs

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
