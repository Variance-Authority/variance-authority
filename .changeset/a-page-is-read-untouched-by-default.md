---
'@variance-authority/core': minor
'@variance-authority/dom': minor
'@variance-authority/playwright': minor
'@variance-authority/playwright-test': minor
'@variance-authority/route-collector': minor
'@variance-authority/storybook-collector': minor
'@variance-authority/presentation': minor
'@variance-authority/vitest-browser': minor
---

A subject is read with nothing hovered, nothing focused, motion reduced and `Date` fixed

Every layout and raster baseline made before this release is compared under a
moved recipe once; a semantic baseline, read in jsdom, does not move. The
default recipes gained tricks, so the stabilization digest every reading records
has changed, and each subject names that recipe as the cause of whatever it
reports. Review the changes and adopt them with `variance accept --all`, as for
any recipe change.

The standard collection recipe now also holds:

- `no-hover`: the pointer is moved to `(-1, -1)`, off the page, once per page
  before it loads. On the `variance` fixture's page it is moved again before
  every observation, a frame each, and not put back: a menu a script opened on
  hover is closed for your test's next step.
- `no-focus`: whatever holds focus is blurred before the subject is read,
  including an element inside a shadow root. On a page your test or agent goes
  on using, focus goes back to that element once the reading and any screenshot
  of it are taken, so a test types where it left off. The blur still ran the
  page's blur handlers, and what they did, such as a validate-on-blur error,
  stays.
- `reduced-motion`: the browser reports `prefers-reduced-motion: reduce`, which
  stops the script animations of a page that honours it, and the reading
  declares the same preference among the conditions its `@media` rules are
  resolved against. A `prefers-reduced-motion` condition you declare through
  `createHarness`'s `features` wins, and the browser is asked for that value;
  a declared `no-preference` is not recorded as `reduced-motion`. Rules under
  `@media (prefers-reduced-motion: no-preference)` are not read by default;
  leave `reduced-motion` out to read them.
- `freeze-clock`: `Date` reads one instant. A script added before the page's
  own replaces `new Date()`, `Date()` and `Date.now()`, and gives the same
  instant to `Intl.DateTimeFormat`'s `format()` and `formatToParts()` called
  without a date. Timers, animation frames and `performance.now()` are the
  browser's own, so a page that settles on a timer still settles. No Playwright
  clock is installed, so `page.clock` stays yours, and a clock your test
  installs replaces the fixed `Date`; the reading still records `freeze-clock`,
  so leave it out of the list when your test owns the clock. `Temporal.Now` and
  `Date` inside a worker are not fixed. The default instant is in the past, and
  the browser's cookie store keeps real time: a cookie your page's script sets
  with an expiry counted from `Date.now()` is already expired and is not
  stored, so a dismissed consent banner can come back after the next
  navigation. Set `varianceNow` or `now` near today, or leave `freeze-clock`
  out.

The render and layout recipes gain `no-focus` alone, because a painted document
still honours a collected `autofocus`. The other three have nothing to act on
there: the date the page printed is already text in the document, and its
`@media` rules were resolved when it was read. A `<script>` inside a subject
root is carried into the render document and runs there under the real clock.
Every document is painted under the render recipe, so a reading taken without
`no-focus` is still painted blurred.

The instant defaults to `DEFAULT_NOW`, `2024-06-15T12:00:00.000Z`, exported
from `@variance-authority/core/format`. `routeCollector` and
`storybookCollector` take a `now` option to choose another. It must be an ISO
8601 instant with its zone; anything else is refused before a browser opens.
An instant other than the default is spelled in the clock's id,
`freeze-clock@<instant>`, so it is part of the environment key, and a baseline taken at one instant is compared
with a run at another with the moved instant named as the cause.

To read a subject hovered, focused, animated or at the real time, pass your own
`stabilize` list without that trick: `DEFAULT_STABILIZE`, the ids of the
default recipe, filtered, as in
`DEFAULT_STABILIZE.filter((id) => id !== 'freeze-clock')`. It is exported from
`@variance-authority/core/format`, `@variance-authority/route-collector`,
`@variance-authority/storybook-collector` and
`@variance-authority/playwright-test`. `storybookCollector` and `observe` in
`@variance-authority/playwright-test` now take `stabilize`, as `routeCollector`
already did.

A trick needs a browser driver to apply it, and is recorded only where one did.
The collectors apply all four. So does the `variance` fixture in
`@variance-authority/playwright-test`: it sets `reduced-motion` and
`freeze-clock` on the `page` it hands your test, before the test body runs, and
takes the pointer off the page and releases focus before every observation,
giving focus back after it. Two new fixture options, `varianceStabilize` and
`varianceNow`, choose what it sets and the instant, and are set with
`test.use`; `varianceDriven` holds the ids it set. A fixed `Date` stops code
that times itself with `Date.now()`: a debounce or a throttle, such as lodash's
`debounce`, sees no time pass and never fires, so a test that types into a
debounced search box can stop getting results after this upgrade. A loop that
waits for `Date.now()` to pass a mark hangs the page, an animation timed by
`Date`, such as jQuery's `animate`, never calls its `complete`, and a client
that checks a token's `nbf` or `iat` against `Date.now()` can refuse a token
issued today. None of these failures names the clock. Leave
`freeze-clock` out for such a test, and for one that sets `page.clock` itself:

```ts
import { DEFAULT_STABILIZE } from '@variance-authority/playwright-test';

test.use({ varianceStabilize: DEFAULT_STABILIZE.filter((id) => id !== 'freeze-clock') });
```

On a page the fixture never handed your test,
such as one opened from your own browser context, call the new
`driveBeforeTest(page)` before `page.goto()` to set the same two; `observe` and
`createVariance` there apply `no-hover` and `no-focus`.
`@variance-authority/vitest-browser` reads from inside your page and has no
driver; `@variance-authority/presentation` reads through the Playwright `Page`
you hand it, a test's or an agent's live browser, and does not drive it. Both
apply `no-focus` only, giving focus back once the reading is taken. A trick left out is absent from the
reading's ids and digest, as a trick a tier cannot reach already is.
`stabilizeForObservation` in `@variance-authority/dom` takes `driven`, the ids
your driver applied, and returns `refocus()`, which gives focus back to the
element the reading released. `stabilizeAsRequested` takes the recipe by id, as
a page agent receives it. `createHarness` in `@variance-authority/playwright`
takes a `stabilize` recipe to drive its page before the first navigation, and
reports the ids it applied as `driven`. `createObservedHarness` opens one with
`observeNetwork` started before its first navigation, as both collectors do.

`createPlaywrightRenderer` no longer couples `no-focus` to `waitForFonts`:
`waitForFonts: false` turns off the waits alone.

`@variance-authority/core/format` exports `DEFAULT_STABILIZE`, `DEFAULT_NOW`,
`driveBeforeLoad` and `driveBeforeRead`, which apply the driver tricks to a
Playwright `Page`, `forDriver`, which drops the ones a host did not apply,
`featuresOf`, which declares the motion preference a recipe drove, and
`recipeToDrive`, which resolves a `stabilize` list and checks `now` before a
browser opens.
