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

It happens because the computed-style allowlist admits `transform`, `opacity`,
`filter`, `color` and every geometric longhand — and an animation in flight moves
all of them. The allowlist *excludes* `animation-*` and `transition-*` on the
stated grounds that a snapshot is taken with animations already disabled, which
makes disabling them a precondition rather than a nicety.
[ADR-0029](context/adr/0029-a-page-is-held-still-before-it-is-read.md) is where
that precondition is met.

---

## Two recipes, and the wire

| | applied to | recipe |
|---|---|---|
| **Collection** | the live page, before the subject is read | `pin-animations`, `hide-scrollbars`, `wait-for-fonts`, `wait-for-images` |
| **Render** | the reconstructed page, before it is painted | `hold-animations`, `hide-scrollbars`, `wait-for-fonts`, `wait-for-images`, `hide-caret` |
| **The wire** | every response the page is served | `freezeAnimatedImages`, `hashAssets` — network-observer options rather than recipe ids, because a response body is not something a stylesheet can reach |

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
| `freezeAnimatedImages` | an animated GIF, served as its first frame | on the wire, so a cross-origin image is no harder than any other |
| `hashAssets` | *nothing* — it reports rather than absorbs | see [the wire](#the-wire-which-knows-what-the-page-cannot) |

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

Absent means no collector reported stabilizing: a jsdom collection has nothing
to hold still.

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

The driver sees every response. So it watches.

### Every asset is hashed into the environment key

```ts
snapshot.environment.inputs.assets
// { 'https://app.test/logo.png': 'v1:9f3c…', 'https://app.test/Inter.woff2': 'v1:20ab…' }
```

`EnvironmentInputs.assets` keys external assets by request URL and values them
by content hash. Without it, a logo re-exported at a different compression, a
hero image swapped behind a CDN path, or a font replaced under the same URL
produces a different picture under an identical key — and the run says
`unchanged`. The page cannot close that gap: it can read a URL and not the bytes
behind it. The wire can.

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

### Some images can be served as nothing

Not every image on a page is part of what the suite is asserting. A hero
photograph the CMS rotates, an avatar from a third party, a marketing
illustration re-exported at a new compression — each repaints a large area, none
is a regression, and after the fact none is distinguishable from one.

The usual answer is a mask drawn over the region, and it is the wrong shape in
three ways at once. The bytes are still fetched. The *layout* still moves when the
replacement has different dimensions. And the environment key still changes with
the bytes, so the run re-renders every subject the image appears on in order to
discover that the difference was going to be masked anyway.

Blanking answers all three before the browser has decoded anything:

```json
{
  "blank": [
    {
      "id": "illustrations",
      "reason": "marketing re-exports these weekly and none of it is under test",
      "url": "https://cdn.example/art/**",
      "minPixels": 40000
    }
  ]
}
```

The response is replaced with a **fully transparent PNG of the original's own
intrinsic dimensions**, so every box on the page resolves exactly as it would
have. That is the difficult part and the reason the size is read from the
original's header rather than assumed: an `<img>` with no CSS width lays out at
its intrinsic size, so a 1×1 substitute would collapse the column it was holding
open and the run would report a layout regression this tool caused. A format
whose header cannot be read — SVG, AVIF — is **served unmodified with a
diagnostic**, never blanked at a guessed size.

Transparent rather than a flat fill, because what is left is then the page's own
background, which is the honest rendering of "there is nothing here". One
consequence worth knowing: a contrast finding over a blanked image is measured
against whatever is behind it.

A rule matches on `url` (a glob), `minPixels`, `maxPixels`, or any combination —
every matcher present must hold. A rule that names none of them is refused rather
than applied to everything, because blanking every image on a site is a real
policy and an illegitimate thing to arrive at by leaving a field out.

**What it does to the environment key is the saving.** A blanked asset is
recorded as `blank:<rule>:<width>x<height>` instead of a digest of its bytes, so
re-exporting the illustration invalidates nothing. The dimensions stay
in the value on purpose: a *resized* illustration moves the layout, and a key
that recorded only the rule id would settle every subject it appears on against a
page whose columns have shifted — a false `unchanged`, which is the one failure
this whole layer exists to prevent.

It says what it removed. `network.blanked` lists the URL, the rule, and the size
for every substitution, so an operator who blanked more than they meant to can
read it back per subject without re-running with the feature off.

### …and the half the wire cannot decide

A request carries no idea which element wanted it. `role="presentation"`,
`alt=""`, a selector, a rendered box — none of those exists on the wire, and no
amount of care there will produce them. That is a fact about a document, so the
trick that uses it is a stylesheet:

```ts
routeCollector({
  routes: { … },
  // The default recipe, plus one. Naming a recipe replaces it, so the tricks you
  // still want are listed — a `stabilize` that only added would make "observed
  // untouched" unsayable.
  stabilize: [
    'pin-animations',
    'hide-scrollbars',
    'wait-for-fonts',
    'wait-for-images',
    'hide-presentational-images',
  ],
});
```

`visibility: hidden`, never `display: none`, for exactly the reason above: a
hidden element still occupies the box it would have. It covers
`img[role="presentation"]`, `img[alt=""]`, and images inside a `presentation` or
`none` role.

It is **opt-in and in no default recipe**, and it is the only trick here that is.
Everything else on this page removes something that was never part of the
assertion — a caret, a scrollbar, an animation mid-flight. This one removes page
content, which is a judgement about what a suite is for, and a default that
quietly stopped watching every `alt=""` image would hide real regressions under a
green run.

**It buys the picture, not the key.** The page still fetched the image, so
`assets` still records its digest, so re-exporting a decorative illustration
still invalidates the environment and costs a re-render before the run can
discover the pixels were identical. That is the limit of what a stylesheet can
do from inside a document that already made the request. An operator who wants
the churn gone from the key as well has to name the URL or the size band, and
blank it.

So the two mechanisms split by what each layer can know, and neither is a
degraded version of the other. The wire decides by URL and intrinsic size, and
gets there before the fetch. The page decides by role, and pays for the fetch it
cannot prevent.

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

### Which assets belong to which subject

Wired into both collectors, and narrowed per subject on the way in.
**The wire sees a page; a verdict is about a subject.** A request carries no idea which story will end up using it, so a
Storybook run — one navigation, three hundred subjects — would give story 200 the
page's whole asset set, which depends on which stories ran before it. That is not
over-invalidation, which would merely be noise. It is **order dependence in the
identity a baseline is stored under**: shard the suite differently and every key
in it changes.

So the two halves are joined where each one knows something the other cannot. The
driver sends its whole observation into the page; the page narrows it to the URLs
*this subtree* references and puts only those in the key. `referencedAssets` reads
`src`, every `srcset` candidate, SVG `use`/`image` hrefs, `poster`, `object[data]`
— and the computed `background-image`, `mask-image`, `content` and `cursor` of
every element and its `::before`/`::after`, because a background image is named by
no attribute at all.

Every candidate rather than the one this device would pick, deliberately: which
`srcset` entry loads depends on the device pixel ratio, and a key holding only the
chosen one lets the 2× asset change without moving a 1× runner's key.

A URL nothing requested is **absent, never a placeholder** — an asset served from
the browser's cache before the observation started has bytes nobody here saw, and
an invented entry would be a claim about content that no later run could
contradict.

### The document carries them too, which is what `settle` reads

Putting the assets in the *capture* alone is not enough, and the shortfall has no
symptom. `settle` skips a render when this run's document digest equals the digest
the baseline was painted from — so a document that omits the assets produces the
same digest after a logo's bytes move, the render is skipped, and the run reports
`unchanged`. That is exactly the false verdict hashing the bytes exists to close,
reappearing one layer in. Both keys carry the same scoped set, asserted in
`packages/route-collector/src/network.chromium.test.ts`.

**What is not yet proven by a browser**: the Storybook path runs the same page
agent and the same narrowing as the route path, which is what the chromium tests
exercise, but no test yet drives a *Storybook story* whose image changes behind
its URL.

---

## The framework, which knows when it has finished

The wire answers *have the bytes arrived*. It cannot answer *has the application
finished rendering them*, and those are different questions: a page whose every
request has settled can still be three commits from its final state.

The usual answer is to poll in pixel space — Playwright's `toHaveScreenshot`
takes screenshots until two consecutive ones match. It costs a raster per poll,
and when it gives up it can only report that the page kept changing. React knows
exactly when it commits and will say so, so `@variance-authority/react` asks.

### `tapCommits` — which components rendered, and when they stopped

`__REACT_DEVTOOLS_GLOBAL_HOOK__` is a handshake, not a debugging aid: a renderer
looks for that global when its module body runs, and reports every commit to
whatever it finds. `tapCommits()` installs one, wrapping any handler already
there and restoring it on `stop()`.

Each commit records the components that actually rendered, read from the
`PerformedWork` flag React sets on the fibers it worked on — so a memoized
sibling that bailed out is **absent**, not listed as unchanged. `awaitQuiet(tap)`
resolves when no commit has arrived for `quietFor` milliseconds, and on a page
that never settles it names what is moving:

```ts
{ settled: false, commits: 41, restless: [{ name: 'Ticker', commits: 39 }] }
```

A component that rendered once at mount and never again is not in that list at
all, which is the difference between a diagnostic and a stack of everything.

**It must exist before `react-dom` does.** That is the whole operational
constraint, and it has a sharp failure mode: a tap installed one script too late
hears nothing, and hearing nothing is indistinguishable from a page that has
gone quiet. So `tapCommits` looks for a React container in the document and
refuses if it finds one — `attached: false`,
`reason: 'react-already-loaded'` — and an unattached tap returns `settled: false`
from `awaitQuiet`, always. **Silence is never reported as quiet.**

### `pendingSuspense` — the boundary that has not arrived, by name

Reading Suspense needs no hook and no advance warning. A Suspense fiber's
`memoizedState` is `null` while it shows its children and an object while it
shows its fallback, so the state of every boundary is reachable by traversal from
the same `__reactFiber$…` expando provenance already reads — at any time, on a
page nobody instrumented, including in production.

What comes back is not a count. Each boundary carries the owner chain above it,
innermost first, the component that wrote the `<Suspense>`, its key, and how many
boundaries enclose it:

```ts
{ state: 'pending', owners: ['Panel', 'Page'], createdBy: 'Panel', depth: 0 }
```

Nested boundaries report separately, so an outer boundary that never fell back
reads `resolved` while the inner one reads `pending` — reporting both would send
a reader to the wrong `<Suspense>`. And the walk is scoped to the subject: a
spinner in an `<aside>` is not this `<section>`'s problem.

`dehydrated` is a third state, distinct from `pending`: server-rendered markup
waiting for hydration, which is a different thing to be told than a fetch in
flight.

### The wait, and the decision it forces

Every collector waits for that reading to come back clean before it reads the
page. `awaitSuspense` is the *first* thing a page agent does, ahead of
stabilization — content that arrives late brings its own images and fonts, and a
`waitForImages` that ran before it waited for the fallback's.

```ts
{ outcome: 'settled' | 'pending' | 'unobserved', waitedMs, boundaries, pending }
```

Three outcomes, not a boolean: a subject with no React under it reports
`unobserved` and never `settled`, because a bundle that failed to load must not
be able to declare itself fully arrived.

**Settled means two consecutive clean readings.** A boundary that resolves
commits children that may immediately suspend on a boundary that did not exist a
moment earlier, so the first clean reading of a waterfall lands exactly in the
gap between them. A subtree with no boundary at all returns on the first reading
and pays nothing, which is almost every subject.

**A boundary still pending when the wait runs out is refused, not captured.**
That is the whole point, and it is a position — see
[ADR-0037](context/adr/0037-a-subject-still-arriving-is-refused.md). Capturing it
would put a skeleton in the baseline on a slow machine and the component on a
fast one, with every band agreeing and both passes consistent. The refusal names
the subject, the open boundaries, the component that wrote each one, and the two
things a person can do:

```
`story:case-surface--suspense-stalled` was still waiting when it was read:
1 Suspense boundary(s) had not resolved after 5000ms — <Suspense> inside
Stalled ← StalledFeed, written by StalledFeed. This is a flake source: the
same subject records a fallback on a slow run and its content on a fast one,
and nobody wrote that difference. Fix what the boundary is waiting for, or
declare this subject as a loading-state capture to record the fallback
deliberately.
```

The second half of that sentence is the escape hatch, and the only one. A
collector's `loading: ['some-subject']` says the skeleton *is* what the baseline
is over; a declared subject then waits for nothing, because paying the timeout to
be told the boundary is open costs five seconds to learn what the declaration
already said. `@variance-authority/playwright-test` takes the same declaration as
`loading: true` on the fixture, and throws instead of refusing — that surface
returns an `Observation`, and a failed assertion is what reaches the person who
can decide.

**The declaration is checked in both directions.** A subject declared as a
loading capture that turns out to have settled is refused too: a declaration
nobody deleted is a baseline that flips with the weather, which is the same flake
arriving from the other side.

`suspenseTimeoutMs: 0` keeps the reading and skips the wait, for a suite whose
own markers already cover its data.

All three properties run against a real Storybook build in
[`cases/storybook-case/src/suspense.chromium.test.js`](../cases/storybook-case/src/suspense.chromium.test.js)
— a boundary that resolves, a boundary that only appears once the first one has,
and a boundary that never resolves, refused and then declared.

---

## What holding a page still costs

Measured, because a stabilization claim is only free if you do not check.

```
STABILIZATION COST — 12 collections of one subject, warm
  untouched    2.3 ms/subject
  held still   2.6 ms/subject
  difference  +0.3 ms/subject
```

Within noise. Waiting unconditionally costs **25.8 ms/subject** instead — eleven
times the cost of the reading itself, spent watching a page that is already
still. The recipe injects a sheet, awaits fonts and images, and then waits two
animation frames for the pinned state to be in force; the two frames are the
whole cost, and on every subject after the first there is nothing for them to
wait for. The sheet is already there, its CSS is unchanged, and an animation
paused at its first frame stays paused.

So the frame wait is skipped when the CSS is unchanged — a condition that reads
off the page rather than a counter somebody has to keep correct. On a
two-hundred subject suite that is five seconds a run.

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
- **`settle()` does not consult the commit tap.** Suspense is wired in — every
  collector waits for boundaries and refuses a subject that has not arrived — but
  `tapCommits` is still an export you call yourself, and a page that is quietly
  re-rendering forever is caught by the second pass rather than by the wait. The
  reason is the constraint above: the tap must be installed before `react-dom`
  loads, which a collector navigating to somebody else's page cannot guarantee,
  so an unattached tap would refuse every subject on a page it simply arrived at
  too late. Suspense had no such precondition, which is why it went first.
- **`srcset` re-resolution** on a viewport change can leave a fractional height
  difference, because browsers reuse a cached candidate. Argos parses `srcset`
  and pins a single candidate; this does not.
- **Dates, clocks and dynamic content** are absorbed by *policy*, not here — see
  [`ignores.md`](ignores.md), which masks the element or the shape of the
  difference rather than a coordinate region.
- **Hover state** is not reset before a subject is read.
- **Sticky and fixed positioning** are not neutralized for a full-page capture.
- **Spellcheck squiggles** and **subpixel image sizing** are not addressed.

Hover, sticky and fixed positioning, spellcheck squiggles and subpixel image
sizing are all tricks Argos ships and this does not, and none of them is hard —
they are `Intervention` values nobody has written yet. The registry is
open precisely so that adding one is a value and not a fork.

**What gets past all of it is caught rather than tolerated.** A subject the run
calls `changed` is read a second time in the same world, and one that disagrees
with itself is reported `unstable` — with the component and the frequency band
that moved, not a page to go and read. That is where this page hands over to
[`flakiness.md`](flakiness.md#what-still-gets-through-and-how-it-is-found) and to
[ADR-0030](context/adr/0030-two-second-passes-one-variable-each.md).

---

**See also.** [`flakiness.md`](flakiness.md) — what kind of thing variance is ·
[`ignores.md`](ignores.md) — absorbing what cannot be stabilized ·
[`comparison.md`](comparison.md) — where each competitor wins ·
[ADR-0029](context/adr/0029-a-page-is-held-still-before-it-is-read.md) — the
decision and what it does not close
