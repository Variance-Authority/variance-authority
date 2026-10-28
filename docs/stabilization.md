# Holding a page still

A spinner caught mid-turn, a web font that arrived late, a scrollbar one machine
draws and another does not: any of them reports a change your code did not make.
A run, one execution of `npx variance run` or one observation in your test,
holds your page still before it reads it, so that two readings of an unchanged
UI agree. Read on for what it does to get your page there, what you
can change about it, and how far into your page it goes.

New here? Start with [your first run](start.md).

**Stabilization is on by default and needs no setup.** Before every capture,
whether or not you knew it was a problem, the default recipe runs nine tricks,
each under the id you name it by: animations are pinned (`pin-animations`),
scrollbars and the text caret are hidden (`hide-scrollbars`, `hide-caret`), the
pointer is off the page (`no-hover`), nothing is focused (`no-focus`), the
browser asks for reduced motion (`reduced-motion`), `Date` reads one fixed
instant (`freeze-clock`), and fonts and images are waited for
(`wait-for-fonts`, `wait-for-images`). GIFs are frozen as they are served. To
read your page without one of them, see [turning one off](#turning-one-off).
Everything else you can change is optional and indexed under
[what you can configure](#what-you-can-configure).

## Turning one off

`stabilize` replaces the default recipe rather than adding to it. To read a
state one trick removes, start from `DEFAULT_STABILIZE`, the ids of the default
recipe, and filter that id out. Every id above filters the same way:
`pin-animations`, `hide-scrollbars`, `no-hover`, any of them. This collector
reads the real clock:

```js
// variance/routes.mjs
import { DEFAULT_STABILIZE, routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: { 'billing/invoice': 'http://localhost:3000/invoice/42' },
  roots: ['#app'],
  stabilize: DEFAULT_STABILIZE.filter((id) => id !== 'freeze-clock'),
});
```

Every baseline records the list it was taken under. A run under a new list
compares each subject, one named UI state such as a story or a route, and names
the moved recipe as the cause of whatever changed; the baseline you accept under
the new list starts over. `@variance-authority/storybook-collector` exports the same
`DEFAULT_STABILIZE` for `storybookCollector`.

The `variance` fixture in `@variance-authority/playwright-test` fixes `Date` on
the `page` it hands every test. To read the real clock in one file, leave
`freeze-clock` out with `test.use`:

```ts
import { DEFAULT_STABILIZE } from '@variance-authority/playwright-test';

test.use({ varianceStabilize: DEFAULT_STABILIZE.filter((id) => id !== 'freeze-clock') });
```

Do the same in a test that installs its own `page.clock`. Its clock replaces the
fixed `Date` either way, and leaving `freeze-clock` out keeps the recipe the
reading records true to the clock it read.

Do the same in a test that waits on a debounce or a throttle that times itself
with `Date.now()`, such as lodash's `debounce`. Under a fixed `Date` no time
passes for it, so it never fires, and a test that types into a debounced search
box waits for results that never arrive.

### What reaches the image

By default the screenshot is not taken from your page. The tool records your
page's markup and the styles that apply to it, then paints that record later in
a fresh browser page that nobody points at or focuses. `routeCollector` and
`storybookCollector` always work this way, and so does the `variance` fixture
unless you choose in-place capture, below. The fresh page gets a fixed set of
tricks of its own, whatever list your page was read under: animations held,
scrollbars and the caret hidden, focus released, even from an `autofocus`, and
fonts and images waited for.

A hover state or a focus ring cannot reach that screenshot: it is the image of
a page nobody is using. Leaving `no-hover` or `no-focus` out changes the record,
not the screenshot. Which `:hover` and `:focus` rules matched while your page
was hovered or focused is recorded and compared, and a difference shows as
`document: changed` among the result's [signals](information.md#verdicts),
beside a verdict that follows the screenshot. Leaving `freeze-clock` or
`reduced-motion` out does reach the screenshot, because the date your page
printed and the styles the motion preference chose are part of the record.

**In-place capture** in `@variance-authority/playwright-test` takes the
screenshot from the page your test is using
([when to choose it](cases.md#existing-playwright-test)). Hover the element
in your test, then observe it with a list that leaves `no-hover` out, and the
image shows its `:hover` style:

```ts
import { test } from '@playwright/test';
import {
  assertUnchanged,
  CHROMIUM_RASTER_ARGS,
  createVariance,
  DEFAULT_STABILIZE,
} from '@variance-authority/playwright-test';

test('checkout, hovered', async ({ page }, testInfo) => {
  const variance = await createVariance(page, testInfo, {
    materialization: {
      kind: 'in-place',
      browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
    },
  });
  try {
    const checkout = page.getByRole('button', { name: 'Checkout' });
    await checkout.hover();
    assertUnchanged(
      await variance.observe(checkout, {
        stabilize: DEFAULT_STABILIZE.filter((id) => id !== 'no-hover'),
      }),
    );
  } finally {
    await variance.close();
  }
});
```

For a focus ring, call `focus()` instead and leave `no-focus` out. The
`browser` you declare must match the launch in your Playwright configuration,
as [in-place capture](../packages/playwright-test/README.md) describes.

## What you can configure

Stabilization runs without any of this. Each entry below is a knob you can turn
once you need it.

| you want to | set | where |
| --- | --- | --- |
| observe a subject untouched | `stabilize: []` | [observing a subject untouched](#observing-a-subject-untouched) |
| choose the tricks yourself | `stabilize: ['pin-animations', …]` | [what runs, and what it absorbs](#what-runs-and-what-it-absorbs) |
| hide decorative images | `stabilize: [… , 'hide-presentational-images']` | [the half the wire cannot decide](#and-the-half-the-wire-cannot-decide) |
| turn one trick off, to read live motion or the real clock | your own `stabilize` list, which replaces the default: every trick you keep, without that one | [turning one off](#turning-one-off) |
| see a hover or a focus ring in the screenshot | in-place capture, and a `stabilize` list without `no-hover` or `no-focus` | [what reaches the image](#what-reaches-the-image) |
| fix the clock at another instant | `now: '2030-01-01T09:00:00Z'` | [hover, focus, motion and the clock](#hover-focus-motion-and-the-clock) |
| serve some images as nothing | `blank` rules | [some images can be served as nothing](#some-images-can-be-served-as-nothing) |
| stop hashing asset bytes | `network: false` / `hashAssets: false` | [what the wire costs](#what-the-wire-costs) |
| record a loading state on purpose | `loading: ['subject-id']` | [the wait, and the decision it forces](#the-wait-and-the-decision-it-forces) |
| skip the Suspense wait | `suspenseTimeoutMs: 0` | [the wait, and the decision it forces](#the-wait-and-the-decision-it-forces) |
| read no components on a site React does not render | `wiring: false` | [hydration, before anything is read](#hydration-before-anything-is-read) |

## Before your first run

If you have not installed the CLI yet:

```bash
npm install --save-dev @variance-authority/cli @variance-authority/route-collector
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

`npx variance doctor` prints which **tier** the run will use before the first
expensive run. A tier is a level of observation: the structure-and-style reading
of a document, which any DOM host produces without a browser, and the painted
image, which only a browser can produce. Stabilization is filtered by tier, so a
jsdom run applies none of it — no layout engine and no animation clock means
there is nothing to hold still.

A subject that is still changing cannot be compared, so every tool in this
category changes the page before it looks. The questions worth asking are
**when**, **what it costs**, and **whether the baseline remembers it happened**.

[Flakiness](flakiness.md) is the position — what kind of thing variance is, and
the four ways a cause gets absorbed. This page is the mechanism.

---

## The failure this exists to prevent

A card fades in over 300ms. Your first run reads it 120ms in, your second reads
it 180ms in, and nothing between the two commits changed a line of code.

Here is what the second run prints:

```
CHANGED  story:card
  root:   Card  (examples/kitchen-sink/src/components/Card.tsx:14)
  band:   texture — opacity 0.4 → 0.6
```

`band` there is the kind of change, not its size. There are five, loudest
first: `a11y` (a role, accessible name or ARIA state changed), `geometry`
(boxes appeared, vanished, moved or resized), `token` (style values changed
while structure stayed the same), `content` (text changed and nothing else did),
`texture` (sub-pixel raster noise).

That is still a false alarm, and a more convincing one. A plain pixel differ
would have printed *1530 pixels moved*, and you would have re-run the job; this
names a component and a file, and you go looking for the edit.
**[Attribution](attribution.md) makes a false alarm credible**, which is why
this project can afford flakiness less than a pixel differ can.

It happens because the computed-style allowlist admits `transform`, `opacity`,
`filter`, `color` and every geometric longhand — and an animation in flight
changes all of them. The allowlist *excludes* `animation-*` and `transition-*` on
the stated grounds that a snapshot is taken with animations already disabled,
which makes disabling them a precondition, not a nicety.
The stabilization recipe meets that precondition before observation begins.

---

## Two recipes, and the wire

A recipe is a named list of tricks applied at one moment. A **collector** is
what does the reading — the Storybook, route, unit or custom adapter you point
at your UI — and it comes with a recipe. There are three moments:
**collection**, when the live page is read; **render**, when the
reading is reconstructed and painted; and **the wire**, where every response
the page is served can be rewritten before the browser sees it.

| | applied to | recipe |
|---|---|---|
| **Collection** | the live page, before the subject is read | `pin-animations`, `hide-scrollbars`, `hide-caret`, `no-hover`, `no-focus`, `reduced-motion`, `freeze-clock`, `wait-for-fonts`, `wait-for-images` |
| **Render** | the reconstructed page, before it is painted | `hold-animations`, `hide-scrollbars`, `no-focus`, `wait-for-fonts`, `wait-for-images`, `hide-caret` |
| **The wire** | every response the page is served | `freezeAnimatedImages`, `hashAssets` — network-observer options rather than recipe ids, because a response body is not something a stylesheet can change |

Where the two differ, a trick would do nothing on the other side.
`hold-animations` is a *screenshot* option, and at collection nobody takes a
screenshot. `no-hover`, `reduced-motion` and `freeze-clock` act on a page whose
scripts run and whose pointer moves. In the reconstructed page the date your
page printed is already text, its `@media` rules were resolved when it was read,
and nothing moves a pointer over it. `no-focus` is in both, because a collected `autofocus` takes focus again.

## What runs, and what it absorbs

Nothing here is a setting you were supposed to find. The table is a reference for
what already happened to your subject.

| trick | absorbs | and the limit, stated here rather than found later |
|---|---|---|
| `pin-animations` | CSS animations and transitions, held at their first frame | the first frame is where a fade-in is *invisible* — deterministic, and not where a user sees the component. CSS stops CSS: `requestAnimationFrame` writing inline styles keeps running |
| `wait-for-fonts` | a font arriving after the subject was read | `document.fonts.ready` covers loads that have *started*; a font requested lazily by a later interaction is not in it. A font still loading after 15 s fails the subject, and the error names its family, and its source when a same-origin stylesheet declares it |
| `wait-for-images` | an image whose intrinsic size had not landed | `document.images` at one moment. Anything appended during the wait is missed — the wire covers that |
| `hide-scrollbars` | a platform and preference difference, and the reflow at the overflow threshold | headless Chromium uses overlay scrollbars, so the classic scrollbar flake does not reproduce in CI at all |
| `hide-caret` | a cursor blinking on its own schedule | a caret paints and does not lay out, so only a reading that takes an image applies it: every render, and a collection whose live page is photographed, as [in-place capture](#what-reaches-the-image) does. A reading that only lays the page out skips it |
| `no-hover` | a `:hover` style left by wherever the pointer rests | the pointer goes to `(-1, -1)`, outside the page. A component that opens on hover is read closed |
| `no-focus` | a `:focus` or `:focus-visible` style on a field your test filled or the page focused | the focused element is blurred, through shadow roots. On a page your test or agent goes on using, focus goes back to that element once the reading is taken |
| `reduced-motion` | a script animation, which a stylesheet cannot stop | only in a page that honours `prefers-reduced-motion`. The page is read as a user who asked for less motion sees it |
| `freeze-clock` | a date or time the page prints from `new Date()`, `Date.now()` or `Intl.DateTimeFormat` | `Date` alone reads one instant; timers, animation frames and `performance.now()` keep the page's own time. Code that measures elapsed time with `Date.now()`, such as a debounce, sees no time pass. `Temporal.Now` and a worker's `Date` are not fixed |
| `freezeAnimatedImages` | an animated GIF, served as its first frame | on the wire, so a cross-origin image is no harder than any other |
| `hashAssets` | *nothing* — it reports rather than absorbs | see [the wire](#the-wire-which-reads-what-the-page-cannot) |

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
be*, which is the flake held still, not removed. The negative
`animation-delay` is what makes it deterministic: it seeks every animation to
(very nearly) its first keyframe before pausing it. `transition-duration: 0s`
collapses a transition to its end state, which is where it was going anyway.

`animation: none` is avoided because removing an animation drops whatever layout
its keyframes contribute — a component whose final position comes from a keyframe
jumps somewhere else. That changes the page instead of stopping it.

At render there is a better option and it is used: `hold-animations` is a
*screenshot* option, so the browser fast-forwards a finite animation to where a
user comes to rest and cancels an infinite one to its first frame. CSS cannot
express that, which is why both tricks exist and not one.

Percy's answer to the JavaScript half is to disable JavaScript entirely on
re-render, which it can afford because it re-renders from a serialized DOM. Here
the page is yours and its JavaScript is the subject.

</details>

## How far an intervention goes

Holding a page still means changing it, and the three ways of doing that cost
you different things. **Every trick shipped here stays in the first row but
one, `freeze-clock`.**

| how far it goes | what it is | what it costs you |
|---|---|---|
| **outside the subject** | injected CSS, screenshot options, a browser setting such as the pointer position or the motion preference, a rewritten response | delete the tool and the intervention is gone |
| **runtime substitution** | replacing `Date`, wrapping `Promise`, replacing a suspense boundary | a difference caused by the patch is indistinguishable from one caused by the code |
| **a contract the subject implements** | a readiness marker in your component | real design damage |

`freeze-clock` is in the middle row, and it pays that row's cost. It removes one
difference, the date and time a page prints, and adds another: code that times
itself with `Date.now()`, such as a debounce or a throttle, sees no time pass and
never fires, which reads as a defect in your code. Leave it out where that
matters ([turning one off](#turning-one-off)). A project that decides another
substitution is worth it can write its own intervention and compose it — see
[composing an observation](compose-observation.md).

The injected stylesheet stays outside the subject in your output too: collection
injects exactly one `<style data-va-stabilize>` and attribution never charges a
rule from it to one of your components. Its rules are `*, *::before, *::after` by
construction, so counting them like any other stylesheet would attach a matched
rule to every node in every subject and put a declaration nobody wrote into the
attribution of a component that did not write it. What survives into your capture
is the recipe's *effect* — `transform` reads its first frame instead of a frame
off the clock — and never the recipe.

## The run reports what it did

```
stabilization: the subject was altered to be observable: animations pinned at
their first frame, which is not where a user sees them; scrollbars hidden,
removing a platform and preference difference — and their width; waited for web
fonts, whose advances change every metric on the page; waited for images to
decode, since their intrinsic size participates in layout
```

Printed near the top of `npx variance report`, before the docket — the report's
list of root causes, one entry per cause even when it reached three hundred
subjects — because it changes how every image below it should be read. A
fade-in captured at its first frame is a correct observation of a page that was
**altered to be observable**, and a reviewer who does not know that is looking
at a component in a state no user ever sees and has not been told.

Each clause comes from the trick's own description, so a trick you write
yourself gets a sentence here without editing anything.

Absent means no collector reported stabilizing: a jsdom collection has nothing
to hold still.

## The baseline remembers

```ts
snapshot.environment.inputs.stabilization  // 'v1:…', or undefined
```

Every baseline is stored under an environment key: a hash of every render
input — engine, viewport, fonts, and the rest — that produced it, so two
captures are only compared when they agree on what made them. That key comes
in two forms:

- **The full key also pins the device's pixel ratio.** It is for the raster
  baseline only a matching device can reproduce.
- **The semantic key omits the pixel ratio.** Layout does not change between a
  retina laptop and a plain CI runner.

The recipe digest is a **render input** itself, in the semantic key as well as
the full one. So:

- A baseline collected untouched and a run collected held still are **two
  baselines**. The run compares them and names the recipe as the cause of
  every change, rather than inventing a component to blame.
- Turning a trick off, adding one, or retuning one is a re-baseline the run
  prints, on the run it happens, instead of a mass diff you have to work out.
  Each change names the recipe digest that moved, the subjects it left
  unchanged say so too, and `variance accept --all` adopts the new images once
  you have looked at them. The reason also says whether a subject's document
  moved in the same run, so a change of yours reads apart from the recipe's.
  An upgrade of variance-authority that changes the recipe reads the same way.
- `undefined` means *observed untouched*, and is absent from the key, not
  present-and-empty — because "no recipe ran" and "an empty recipe ran" are the
  same state and neither should look like a confident value.

**Nobody else in the category does this.** Argos and Percy both stabilize by
default and neither records which stabilizers ran in the identity of what they
produced, so changing one is a silent mass diff attributed to your code. It is
the same reason renderer identity is recorded, applied to the stabilization
recipe instead of the machine.

---

## Observing a subject untouched

An empty `stabilize` turns the whole recipe off for that collector:

```js
// variance/routes.mjs
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: { 'checkout/empty': 'http://localhost:3000/checkout' },
  roots: ['#app'],
  // Observed untouched. The environment key records that, so these baselines
  // do not mix with stabilized ones.
  stabilize: [],
});
```

Use it when your suite's own determinism story is already better than this
one's — it freezes its clock, its data and its animations — and a second
`!important` stylesheet would be damage buying nothing.

Naming a trick that does not exist **throws, and names the tricks that exist**.
A typo is refused rather than skipped, so you never end up with a suite one
trick less stable than you believe it is.

---

## Hover, focus, motion and the clock

Four tricks put your page into the state of a page nobody is using. The pointer
is off the page, so nothing is hovered. Nothing is focused. The browser reports
`prefers-reduced-motion: reduce`. `Date` reads one fixed instant. A stylesheet
cannot do three of these, so the collector applies them through the browser:

- **the pointer** is moved to `(-1, -1)` once per page, before the first
  navigation. `(0, 0)` is not enough, because content at the top left stays
  hovered there. On a page your test goes on using, it is moved there again
  before every observation, which costs a frame each, and it is not put back:
  a menu a script opened on hover is closed for your test's next step;
- **the motion preference and the clock** are set before the first navigation,
  so the page's first script already reads them. Both stay set across
  navigations. The reading records the motion preference among the conditions
  its `@media` rules are resolved against, so a `prefers-reduced-motion` block
  is read as the browser drew it, and a `no-preference` block is not read at
  all. A host that declares its own `prefers-reduced-motion` condition keeps
  its value, and the browser is asked for that one instead;
- **focus** is released in the page, right before the subject is read. On a
  page your test or agent goes on using, it goes back to the same element once
  the reading, and any screenshot of it, is taken. What the page's blur
  handlers did meanwhile, such as a validate-on-blur error, stays.

The clock is `Date` and nothing else. A script added before the page's own
replaces `new Date()`, `Date()` and `Date.now()` with one instant, and gives the
same instant to `Intl.DateTimeFormat`'s `format()` and `formatToParts()` called
without a date. `setTimeout`, `requestAnimationFrame` and `performance.now()`
are the browser's own, so a page that waits on a timer still finishes loading
and a frame's timestamp is the time CSS and Web Animations step by. Playwright's
[`clock.setFixedTime`](https://playwright.dev/docs/api/class-clock#clock-set-fixed-time)
fixes `Date` too, but installs its own `setTimeout`, `requestAnimationFrame` and
`performance` to do it, and its frame timestamps no longer agree with
`document.timeline`. No Playwright clock is installed, so `page.clock` stays
yours: a clock your test installs replaces the fixed `Date`, and the reading
reads your clock.

A fixed `Date` costs code that measures elapsed time with it. A debounce or a
throttle timed with `Date.now()`, lodash's `debounce` among them, sees no time
pass and never fires, and a loop that waits for `Date.now()` to pass a mark
never ends. The default instant is in the past, while the browser's cookie
store keeps real time: a cookie your page's script sets with an expiry counted
from `Date.now()` is already expired and is not stored, so a consent banner
your test dismissed comes back after the next navigation. Leave `freeze-clock`
out of such a page, or set an instant near today
([turning one off](#turning-one-off)).

The default instant is `2024-06-15T12:00:00.000Z`. At noon UTC it is the same
calendar date in every zone from UTC−11 to UTC+11, so a page that prints today's
date prints one date wherever the browser runs. The timezone the page runs in is
pinned as well, to `UTC` unless you declare another
([a timezone and a locale](flakiness.md#the-rest-of-the-family)), so the page
prints one time of day too. To use another instant, set
`now` to an ISO 8601 instant with its zone:

```js
// variance/routes.mjs
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: { 'billing/invoice': 'http://localhost:3000/invoice/42' },
  roots: ['#app'],
  // A date with no zone names a different instant on every machine, so
  // the collector refuses one.
  now: '2030-01-01T09:00:00Z',
});
```

`storybookCollector` takes the same option, and the `variance` fixture in
`@variance-authority/playwright-test` takes it as `varianceNow`. The instant is
part of the recipe the environment key records, so a run read at another
instant than its baseline names the moved instant as the cause, rather than
reporting a change your code made.

### Where each one applies

| host | applies |
| --- | --- |
| `routeCollector` and `storybookCollector` | all four |
| the Playwright renderer | `no-focus`, the one of the four that acts on a page that only paints |
| the `variance` fixture in `@variance-authority/playwright-test` | all four. `reduced-motion` and `freeze-clock` are set on the `page` it hands your test, before the test body runs; `no-hover` and `no-focus` before every observation, and focus goes back after it. Set `varianceStabilize` and `varianceNow` with `test.use` to change the first two. The page opens in `UTC` when your Playwright config sets no `timezoneId` |
| `observe` and `createVariance` in `@variance-authority/playwright-test`, on a page the fixture never handed your test, such as one you opened from your own `browser.newContext()` | `no-hover` and `no-focus`, before every observation, and focus goes back after it. That page loaded before either was called, so set the clock and the motion preference on it before `page.goto()`: `await driveBeforeTest(page)`, from `@variance-authority/playwright-test`, sets both as the fixture does |
| Vitest browser mode, which reads from inside the page and has no driver | `no-focus`, and focus goes back once the reading is taken |
| `@variance-authority/presentation`, which reads through the Playwright `Page` you hand it, a test's or an agent's live browser, and does not drive it: the page and its state are yours | `no-focus`, and focus goes back once the reading is taken. Set the other three on your page yourself: `page.mouse.move(-1, -1)`, and `await driveBeforeTest(page)` before `page.goto()` |

A host that cannot apply a trick leaves it out of the recipe it records, the
same way a tier does. The report and the environment key show what ran on your
page, not what the default recipe asks for.

---

## What is proven

Each row below is checked against a real compositor, not a simulation of one: a
page with a 4s linear infinite animation on `transform` and `opacity`, read
twice about a second apart through the collector you would use.

| | |
|---|---|
| observed untouched | the render hash **changes** |
| under the default recipe | the render hash **stays the same** |
| the two together | different `semanticDigest`, so they are never compared |
| the injected sheet | appears nowhere in the subject |

And for a page nobody is using, through the route collector and the `variance` fixture:

| | |
|---|---|
| a script animation that skips itself under reduced motion | the render hash **stays the same** |
| a page that prints the wall clock | the same date, and the same pixels, on both runs |
| a field the page focused | read as it is with nothing focused |
| the fixed clock | a frame's timestamp is still the time CSS animations step by, and timers still fire |
| a clock your test installs with `page.clock` | is the one the page reads |

And for the wire:

| | |
|---|---|
| an animated GIF, unwatched | screenshots of it **differ** |
| the same GIF, frozen on the wire | three seconds of screenshots, all **identical** |
| an image swapped behind its URL | the environment key **changes**, with no DOM change at all |
| the same run with `network: false` | the asset map is empty, and visibly so |

A GIF that failed to decode paints nothing in *both* runs, so "held still" and
"never arrived" would otherwise have the same signature. Every sampling run
checks the image's intrinsic width before it believes a pair of identical
frames.

---

## The wire, which reads what the page cannot

The wire reads **response bytes the page cannot**: it can freeze cross-origin
animated GIFs and fingerprint assets whose URL stays the same.

Everything above happens *inside* the page, and inside the page is the wrong
place for a whole class of question. `document.images` is a list of nodes that
existed at one moment: it misses an image appended while you were waiting, it
has no entry for a CSS `background-image` (which has no load event at all), and
it cannot show you what the bytes were.

The driver receives every response, so it records each one.

### A URL your build did not name is hashed on the wire

```ts
snapshot.environment.inputs.assets
// { 'https://app.test/logo.png': 'v1:9f3c…', 'https://app.test/Inter.woff2': 'v1:20ab…' }
```

`EnvironmentInputs.assets` keys external assets by request URL and values them
by content hash. Without it, a logo re-exported at a different compression, a
hero image swapped behind a CDN path, or a font replaced under the same URL
produces a different picture under an identical key — and the run reports
`unchanged`. The page cannot close that gap: it can read a URL and not the bytes
behind it. The wire can.

Most of the time your build already closed it. A bundler that emits
`logo.4f2a91.svg` has put the content hash in the URL, and that URL is in the
markup the capture already hashes — hashing the bytes would record the same fact
a second time and pay [what the wire costs](#what-the-wire-costs) to do it. Turn
it off for a build like that. Storybook and Next name assets this way for
anything you `import`; neither does it for what they serve verbatim — a file in
`public/`, a CDN path, a font behind a stable name. Those are what the
wire is for, and why it is on by default.

Hashed: `image`, `font`, `media`. Not hashed: documents, scripts and stylesheets,
whose effect on the render arrives through the capture itself — the DOM, the rule
text — so hashing them buys a second copy of a covered input.

### Animated GIFs are frozen on the wire

A GIF has been animating since it decoded, and no CSS applies to it —
`animation-play-state` governs CSS animations and a GIF is not one.

Argos solves this in the page and the design is careful: build a *fresh* `Image`,
draw it to a canvas, take `toDataURL('image/png')` as frame zero, swap it into
`src`. Fresh, because the element already on the page has been animating since
load and cannot be seeked back. Its documented failure mode is cross-origin: no
CORS grant means a tainted canvas, `toDataURL` throws, and the GIF keeps
spinning.

Doing it on the wire removes the problem instead of handling it. The bytes have
not been decoded yet, so there is nothing to seek back and no second decode to
pay for; cross-origin stops mattering, because the fulfilment is ours and
nothing requires the page to read anything; and the result is **the original
bytes minus some of them** — a GIF truncated to its first image block plus a
trailer, which is a valid single-frame GIF. The palette, the transparency, the
dimensions and the compression are exactly what the author shipped, where a
canvas round-trip re-encodes through RGBA into a different image from the one
under test.

No decoder, no encoder, no dependency. What it will not do is guess: bytes that
are not a GIF, a GIF that already has one frame, and a file whose blocks it
could not parse are all passed through untouched, because a truncation taken from
a position the parse cannot vouch for is a corrupt asset served to a browser.

It also **records what it froze** — `network.frozen` is the list of URLs —
because a stabilizer that rewrites an asset silently can change the picture a
reviewer is looking at with no record that it did.

### Some images can be served as nothing

Not every image on a page is part of what the suite is asserting. A hero
photograph the CMS rotates, an avatar from a third party, a marketing
illustration re-exported at a new compression — each repaints a large area, none
is a regression, and after the fact none is distinguishable from one.

The usual answer is a mask drawn over the region, and it is the wrong shape in
three ways at once. The bytes are still fetched. The *layout* still moves when the
replacement has different dimensions. And the environment key still changes with
the bytes, so the run re-renders every subject the image appears on to
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
original's header, not assumed: an `<img>` with no CSS width lays out at
its intrinsic size, so a 1×1 substitute would collapse the column it was holding
open and the run would report a layout regression this tool caused. A format
whose header cannot be read — SVG, AVIF — is **served unmodified with a
diagnostic**, never blanked at a guessed size.

Transparent, not a flat fill, because what is left is then the page's own
background, which is the honest rendering of "there is nothing here". One
consequence worth knowing: a contrast finding over a blanked image is measured
against whatever is behind it.

A rule matches on `url` (a glob), `minPixels`, `maxPixels`, or any combination —
every matcher present must match. A rule that names none of them is refused rather
than applied to everything, because blanking every image on a site is a real
policy and an illegitimate thing to arrive at by leaving a field out.

**What it does to the environment key is the saving.** A blanked asset is
recorded as `blank:<rule>:<width>x<height>` instead of a digest of its bytes, so
re-exporting the illustration invalidates nothing. The dimensions stay
in the value on purpose: a *resized* illustration moves the layout, and a key
that recorded only the rule id would settle every subject it appears on against a
page whose columns have shifted — a false `unchanged`, which is the one failure
this whole layer exists to prevent.

It records what it removed. `network.blanked` lists the URL, the rule, and the
size for every substitution, so an operator who blanked more than they meant to
can read it back per subject without re-running with the feature off.

### …and the half the wire cannot decide

A request does not identify the element that triggered it.
`role="presentation"`, `alt=""`, a selector, a rendered box — none of those
exists on the wire, and no amount of care there will produce them. That is a
fact about a document, so the trick that uses it is a stylesheet:

```js
// variance/routes.mjs
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: { 'checkout/empty': 'http://localhost:3000/checkout' },
  roots: ['#app'],
  // `stabilize` replaces the recipe rather than adding to it, so list the tricks
  // you still want alongside the one you are adding.
  stabilize: [
    'pin-animations',
    'hide-scrollbars',
    'hide-caret',
    'no-hover',
    'no-focus',
    'reduced-motion',
    'freeze-clock',
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
The other stabilization mechanisms remove something that was never part of the
assertion — a caret, a scrollbar, an animation mid-flight. This one removes page
content, which is a judgement about what a suite is for, and a default that
quietly stopped watching every `alt=""` image would hide real regressions under a
green run.

**It buys the picture, not the key.** The page still fetched the image, so
`assets` still records its digest, so re-exporting a decorative illustration
still invalidates the environment and costs a re-render before the run can
discover the pixels were identical. That is the limit of what a stylesheet can
do from inside a document that already made the request. An operator who wants
the churn gone from the key as well has to name the URL or a pixel-size range,
and blank it.

So the two mechanisms split by what each layer can read, and neither is a
degraded version of the other. The wire decides by URL and intrinsic size, and
gets there before the fetch. The page decides by role, and pays for the fetch it
cannot prevent.

### Waiting on what was actually requested

`network.settle()` resolves when none of the images, fonts and media the page
requested is in flight. Not a poll over the nodes that existed at one moment: a
count of what has been asked for and not yet answered, which is the honest
version of "the images have loaded".

An asset still in flight when the wait runs out refuses the subject, and the
refusal names its URL. Read without it, the subject records bytes nobody
hashed. A long-poll or a streaming `fetch` never holds the wait open, because
only images, fonts and media are counted.

### What the wire costs

Routing disables the browser's HTTP cache for what it routes, and every routed
request makes a round trip into Node. Only asset requests are fetched and read;
everything else is continued without its body. Set `network: false` on the
collector — `hashAssets: false` on the observer — to turn it off, which is the
right call for a build whose URLs already include their own content hash. The
assets map is then empty, and an empty map is visibly a run that recorded nothing
rather than a run that had nothing.

### Which assets belong to which subject

Wired into both collectors, and narrowed per subject on the way in. **The wire
covers a whole page; the result a run reports is about one subject.** Nothing in
a request identifies which story will end up using it, so a Storybook run — one
navigation, three hundred subjects — would give story 200 the page's whole asset
set, which depends on which stories ran before it. That is not
over-invalidation, which would merely be noise. It is **order dependence in the
identity a baseline is stored under**: shard the suite differently and every key
in it changes.

So the two halves are joined where each one has something the other does not.
The driver sends its whole observation into the page; the page narrows it to the
URLs *this subtree* references and puts only those in the key.
`referencedAssets` reads `src`, every `srcset` candidate, SVG `use`/`image`
hrefs, `poster`, `object[data]` — and the computed `background-image`,
`mask-image`, `content` and `cursor` of every element and its
`::before`/`::after`, because a background image is named by no attribute at
all.

Every candidate rather than the one this device would pick, deliberately: which
`srcset` entry loads depends on the device pixel ratio, and a key listing only the
chosen one lets the 2× asset change without changing a 1× runner's key.

A URL nothing requested is **absent, never a placeholder** — an asset served from
the browser's cache before the observation started has bytes nobody here saw, and
an invented entry would record content nobody measured, and no later run could
contradict it.

### The document includes them too, which is what the render skip reads

Putting the assets in the *capture* alone is not enough, and the shortfall has no
symptom. The render skip — `settle()` from `@variance-authority/raster`, not the
`network.settle()` above — skips a render when this run's document digest equals
the digest the baseline was painted from. So a document that omits the assets
produces the same digest after a logo's bytes change, the render is skipped, and
the run reports `unchanged`. That is the false verdict hashing the bytes exists
to close, reappearing one layer in. Both the document digest and the environment
key are computed over the same per-subject asset set.

---

## The framework, which reports when it has finished

The wire answers *have the bytes arrived*. It cannot answer *has the application
finished rendering them*, and those are different questions: a page whose every
request has settled can still be three commits from its final state.

The usual answer is to poll in pixel space — Playwright's `toHaveScreenshot`
takes screenshots until two consecutive ones match. It costs a raster per poll,
and when it gives up it can only report that the page kept changing. React calls
back exactly when it commits, so `@variance-authority/react` subscribes.

### `tapCommits` — which components rendered, and when they stopped

`__REACT_DEVTOOLS_GLOBAL_HOOK__` is a handshake, not a debugging aid: a renderer
looks for that global when its module body runs, and reports every commit to
whatever it finds. `tapCommits()` installs one, wrapping any handler already
there and restoring it on `stop()`.

Each commit records the components that actually rendered, read from the
`PerformedWork` flag React sets on the fibers it worked on — so a memoized
sibling that bailed out is **absent**, not listed as unchanged. `awaitQuiet(tap)`
resolves when no commit has arrived for `quietFor` milliseconds, and on a page
that never settles it names what keeps changing:

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
the same `__reactFiber$…` expando [provenance](attribution.md) already reads — at any time, on a
page nobody instrumented, including in production.

What comes back is not a count. Each boundary comes with the owner chain above it,
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
waiting for hydration, which is a different state to report than a fetch in
flight.

### Hydration, before anything is read

A changed region in a report names the component that rendered it, and the
route collector reads that component off React's tree in the page. A
server-rendered route is complete on screen before React owns it: until React
commits the root the route belongs to, there is no component to read, and
neither `load` nor a settled network says when that commit happens. So the
collector waits for React to hydrate a route for as long as React or the page
can still get it there. A root React cannot finish is refused. A route with no
root is read without its components.

No clock decides how long that is. React's own record does, and the wire:

- **React has work.** While a root has a render React can do, or a commit has
  effects React has not run yet, the collector waits for React. A route React
  has already committed is read as soon as its effects have run.
- **React is stuck on a promise.** While React waits on a chunk or a payload,
  the collector waits for as long as anything the page requested is still
  arriving, however long that takes. A request that fails has stopped arriving.
- **Nothing is arriving.** When React is stuck and nothing is arriving, the
  route is refused at once, counting the roots that had not committed. The
  collector watches what the page receives, not what it schedules, so a promise
  a timer settles is refused too, even when the timer would fire a moment
  later.
- **React has loaded and has no root yet.** The collector waits for as long as
  anything the page requested is still arriving: the client that creates the
  root may be waiting on it. Once nothing is arriving, the route is read with a
  `react-root-absent` warning.
- **React has not loaded.** The collector waits only for scripts still
  arriving, because only a script brings a renderer. It watches React's commits
  from before the page's first script, so it knows when none has loaded. Once
  no script is arriving, the route is read with a `react-root-absent` warning.
- **Not counted.** An event stream, a WebSocket or a playing video is a
  channel, not a response anything waits on. A font or an image is not counted
  either: React waits on neither, and
  [`wait-for-fonts` and `wait-for-images`](#what-runs-and-what-it-absorbs) name
  the one that never answers.

A request that stays open, such as a long poll, counts while React is stuck or
has loaded without a root. The collector cannot tell it apart from the response
React waits on, so one that never closes holds the route until your test
runner's timeout or the job's stops the run, and that failure names the request.
Open the long poll from an effect: an effect runs after the root commits, so the
request opens once nothing waits on the wire. The
[asset wait](#waiting-on-what-was-actually-requested) does the opposite and
reads a page past a long poll. There, the markup is final and only a late image
is missing. Here, the markup on screen is the server's, and the render that
replaces it has not happened.

A route refused uncommitted is refused for the reason an open Suspense boundary
is: the image is not the one the route settles on. The markup the server sent is
on screen, but an effect that runs after hydration — a mounted flag, a theme
read from storage, a layout measured on the client — paints something else, so
a slow machine and a fast one record different pixels:

```
`page/app` stopped hydrating with 1 of 1 React root(s) uncommitted: React had no
work it could do, and nothing the page requested was still arriving to give it
some. A root holds like that on a promise the wire does not settle — one settled
by a timer, one whose request failed, one never settled — read outside any
<Suspense>. An effect that runs after hydration can paint a different image, so
the server's markup is not recorded in its place. Find the promise the first
render holds on.
```

A refusal means the first render React hydrates, the shell, read a promise
outside any `<Suspense>` that the wire does not settle: one a timer settles, one
whose request failed, or one that never settles. Settle a timer's promise from
the request it stands in for, and let a failed request reject, so an error
boundary renders its error instead of the shell waiting on it. Or move the read
under a `<Suspense>` boundary, whose fallback the next section's wait handles.
`loading` and `suspenseTimeoutMs` do not apply here: they decide what a
fallback means, and a root that has not committed has no boundary React has
finished reading. The one setting that skips this wait is `wiring: false`,
which reads no components either.

A route where no root is found is collected, not refused, with a
`react-root-absent` `warn` diagnostic on that subject, which the report
carries. No component could have been read there: either React does not render
it, or its client never created a root, and the warning says which, and is how
you tell that apart from a node no component rendered. When React renders none
of your routes, set `wiring: false`: the collector then reads no components,
waits for nothing and says nothing.

A route that hydrates is read twice: its markup as React's hydration commit
found it, copied in that commit, and again once React has nothing left to do.
The copy is taken at the commit rather than when the collector looked, so a
fast machine and a slow one compare the same two pages. When the two differ,
the route is collected as it ended, the page a visitor is left with, and
carries a `hydration-changed-markup` `warn` diagnostic that quotes both and
names the components that committed after hydrating, in every root that reaches the subject:

```
Hydration changed the markup of page/app: the hydration commit left `<main id="app"><p>early</p></main>`
and the client then left `<main id="app"><p>client</p></main>`. Flip committed after
hydrating. The reading is of the page after hydration; a visitor sees the
server's page first. Render the same markup on the server, or move the
difference into a client-only component.
```

The copy is taken once the hydration commit has written the DOM, so what that
commit writes compares as no change. Two cases are missed that way: a mismatch
React recovers from by rendering the root on the client, and a layout effect
that writes the DOM. React reports the mismatch itself, through
`onRecoverableError`.

The roots read are every root on the subject, above it up to the `Document`,
under it, and behind a portal the subject renders through. No component is read
off a node whose root has not committed, because that render may never reach
the screen.

### The wait, and the decision it forces

Every collector waits for the Suspense reading to come back clean before it
reads the page. `awaitSuspense` runs ahead of stabilization, and in the route collector
right after hydration — content that arrives late brings its own images and fonts, and a
`waitForImages` that ran first would have waited for the fallback's images
instead of the content's.

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
Capturing it
would put a skeleton in the baseline on a slow machine and the component on a
fast one, with every band agreeing that nothing moved and both passes
consistent. The refusal names
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
`loading: true` on the fixture, and throws instead of refusing: in a Playwright
test a failed assertion is what the person who can decide sees.

**The declaration is checked in both directions.** A subject declared as a
loading capture that turns out to have settled is refused too: a declaration
nobody deleted is a baseline that flips with the weather, which is the same flake
arriving from the other side. So is a declared subject that holds no Suspense
boundary at all, such as a spinner an effect renders: it has no fallback to
record on purpose, and what gets recorded depends on how fast the machine is.

`suspenseTimeoutMs: 0` keeps the reading and skips the wait, for a suite whose
own markers already cover its data.

All three behaviours run against a real Storybook build: a boundary that
resolves, a boundary that only appears once the first one has, and a boundary
that never resolves — refused, and then declared.

---

## The order the questions are asked in

The instruments above are not four independent checks. They are one question —
*has this subject stopped drifting* — asked at four prices, and each answer settles
the ones beneath it:

| the reading | what it settles | what it costs |
| --- | --- | --- |
| `pendingSuspense` | whether the subject has arrived at all | a fiber traversal |
| `awaitQuiet` | whether the application has stopped working | a hook installed before React |
| `documentDigest` | whether anything the renderer reads changed | a read of a page already mounted |
| the image | whether the pixels moved | a raster, the most expensive reading here by an order of magnitude |

The implication runs one way. A component tree that did not re-render cannot
have produced a different document, and a document that did not change cannot
paint a different image — so the cheapest reading that answers ends the
question. `settle()` from `@variance-authority/raster` — a different function
from the `network.settle()` above, which waits for requests — is that early
return at the third row: a document byte-identical to the one the baseline was
painted from is not photographed again, and on a suite where nothing changed
that is the whole value of a run.

**The converse is where the findings are.** A row changing while the row above
it agrees is not a wasted check, it is the fact somebody wanted:

- **The fiber changed and the document did not.** The components re-rendered
  and the page did not follow — `refactor` in [parting](parting.md), read
  across a moment instead of across a commit. This is the receipt a refactor
  never gets, and no pixel differ can detect it.
- **The document changed and the image did not.** The renderer read the change
  and absorbed it: sub-pixel geometry, a repeated colour, a rule that lost the
  cascade.
- **Nothing that was read changed and the image did.** Every input the run
  actually looked at agreed and the picture changed anyway — `flake`, which is
  an accusation, and only safe to make because `unread` exists to name the case
  where nothing was read at all.

So this is a ladder of readings, not a settling loop. Climbing until two samples
agree is what a pixel poll does, and it converts a finding into a delay: the run
goes green, the component that would not sit still is never named, and the same
cost is paid again tomorrow. Every row here is *read*, and which row answered is
itself the reading.

---

## What holding a page still costs

The suite prints the figure on every run, so you can take it on your own
hardware. On an Apple M4 Max (Mac16,9), 64 GB, macOS 27.0 on arm64, Node v26.7.0:

```
STABILIZATION COST — 12 collections of one subject, warm
  untouched    2.3 ms/subject
  held still   2.6 ms/subject
  difference  +0.3 ms/subject
```

Within noise, and that is the claim: **on a warm subject, holding the page
still costs no more than the noise between two collections.** The pointer, the
motion preference and the clock are set once, before the first navigation, so
no subject pays for them. Per subject, the recipe injects a sheet, awaits fonts
and images, and releases focus, which costs a page evaluate, plus an animation
frame when the document holds an `[autofocus]`. Then it waits two animation
frames for the pinned state to be in force. On every subject after the first
there is nothing for those frames to wait for. The sheet is
already there, its CSS is unchanged, and an animation paused at its first frame
stays paused.

So the frame wait is skipped when the CSS is unchanged — a condition that reads
off the page rather than a counter somebody has to keep correct. The first
subject still pays, and should: that is the one where the sheet arrives and
something is genuinely moving.

**What the skip saves is arithmetic, not a reading.** Two animation frames on a
60Hz compositor is about 32 ms, so putting them back into every subject would
cost roughly a third of a second on a ten-story Storybook and about six seconds
on two hundred. The suite fails if that regression ever lands, so you see it as
a red build rather than a slow CI job nobody attributes to anything.

---

## What stabilization does not cover

The standard observation path holds CSS animation, fonts, images, scrollbars,
carets, hover, focus and the clock still, asks for reduced motion, reads the
wire for the bytes behind each asset, waits for React to hydrate a
server-rendered route, and checks that Suspense has resolved. It does not
redefine application state, and the only framework hook it installs before the
application loads is React's commit hook, in the route collector.

Content an effect sets after it loads something is outside every wait here. An
effect that starts an import, a request or a timer and then calls `setState`
leaves React with nothing pending, so the subject is read with its placeholder
and no diagnostic. [Content that loads late](late-content.md) shows how to put
that work under `<Suspense>`, or mark the subject ready, so a run waits for it.

The route collector installs `tapCommits` from its page agent before the page's
first script, and reads it only to know whether React loaded, when the effects
a commit scheduled have run, and what the markup was at the hydration commit. No collector calls `awaitQuiet`: silence
is not a reason to stop waiting, and a tap attached after `react-dom` cannot
prove the page is quiet.

Randomized data, `requestAnimationFrame` mutations in a page that ignores
`prefers-reduced-motion`, sticky or fixed positioning during full-page capture,
spellcheck decoration, and subpixel image sizing are not normalized by that
path. Control them in the
host's fixture, express deliberate volatile regions through
[ignore rules](ignores.md), or provide a [custom composition](compose-observation.md) with its own
intervention recipe.

A subject reported `changed` is read again in the same world. Disagreement is
reported as `unstable`, with the component and the frequency band of the
disagreement when those signals are available. [Flakiness](flakiness.md#what-still-gets-through-and-how-it-is-found)
continues from that result. The second readings vary one input at a time so a
timing change cannot be mistaken for an isolation change.

---

**See also.** [Flakiness](flakiness.md) — what kind of thing variance is ·
[Content that loads late](late-content.md) — making late work something a run waits for ·
[Ignore rules](ignores.md) — absorbing what cannot be stabilized ·
[Comparison](compare-visual-review.md) — where each operating model fits
