# ADR-0088 — a page is read as nobody is using it

**Status:** accepted
**Date:** 2026-10-10
**Amends:** [ADR-0012](0012-observability-and-the-damage-boundary.md) — §2, which
declined runtime substitution, now makes one: `Date`; and §3, whose cheapest
tier a focus ring or a printed date would put in jsdom, where neither is held;
[ADR-0029](0029-a-page-is-held-still-before-it-is-read.md) — §1, the two recipes
now differ by more than one trick, and *What this does not close*, which a page
that honours reduced motion now leaves;
[ADR-0030](0030-two-second-passes-one-variable-each.md) — the eighth story stays
unstable, for a reason the fixed clock does not reach
**Relates to:** [`packages/core/src/format/drive.ts`](../../../packages/core/src/format/drive.ts),
[`packages/core/src/format/stabilize.ts`](../../../packages/core/src/format/stabilize.ts),
[`packages/playwright-test/src/untouched.chromium.test.ts`](../../../packages/playwright-test/src/untouched.chromium.test.ts),
[`docs/stabilization.md`](../../stabilization.md#hover-focus-motion-and-the-clock),
[prior art](../prior-art.md#a-page-nobody-is-using)

## Context

Four second readings of one subject come from something other than the code
under review: where the pointer rests, what holds focus, whether the browser
says motion is welcome, and what time it is. A test that hovered before it
observed reads a hovered menu; an `autofocus` reads an outlined field; a motion
library runs its script animation, which no stylesheet stops; a component that
prints today's date prints another one tomorrow.

None of the four could be fixed by the recipe as it stood. Its tricks were a
stylesheet, a screenshot option or a settle step, and three of the four belong
to the browser rather than the document: a media preference is emulated, the
pointer is moved by the driver, and `Date` is read by the page's first script,
before any stylesheet or settle step exists. Each was left to the author, as
the hosted services leave it ([prior art](../prior-art.md#a-page-nobody-is-using)).

## Decision

**The default collection recipe reads a page nobody is using: the pointer off
the page, nothing focused, reduced motion, and `Date` at one instant, which is
part of the environment key.**

- **Four tricks, in every default collection recipe.** `no-hover`, `no-focus`,
  `reduced-motion` and `freeze-clock` are `UNTOUCHED`, and `COLLECT_RECIPE`
  holds all four. An `Intervention` gains a fourth way to be applied, a
  `driver` request, declared as data so a host with no driver can tell which
  tricks it cannot honour.
- **Recorded only where they held.** A host passes the ids it drove, and
  `forDriver` drops the rest from the ids and the digest. Vitest browser mode
  has no driver: its test runs inside the browser it would have to drive.
  `@variance-authority/presentation` holds the caller's Playwright `Page`, a
  test's or an agent's, and reads through it without driving it, because the
  caller goes on using that page and the pointer, the emulated media and the
  clock are the caller's. Both record `no-focus` alone, which a page does to
  itself. The route and Storybook collectors' page agents are driven by the
  Playwright harness that opened their page, and record all four.
- **Who drives when.** The harness sets the motion preference and the clock
  before its first navigation. The `variance` fixture in
  `@variance-authority/playwright-test` sets them through `driveBeforeTest`,
  before the test body runs; it leaves `no-hover` out, because a test moves the
  pointer as it goes, and moves the pointer off the page through
  `driveBeforeRead` before each observation instead. That move costs a frame,
  ~14 ms, on every observation: measured in Chromium, `:hover` matches nothing
  from script after a Playwright hover, so the page cannot say the move is not
  needed. The pointer is not put back, and the move fires `mouseleave`: a menu
  a script opened on hover is closed for the test's next step.
- **The motion preference has one owner.** With `reduced-motion` applied, the
  reading declares `prefers-reduced-motion: reduce` among the conditions its
  `@media` rules are resolved against, so a rule the live page applied is read
  as applied. A host that declares its own `prefers-reduced-motion` keeps it,
  and the browser is asked for that value, so the declaration and the
  emulation cannot disagree; a declared `no-preference` drops the
  `reduced-motion` id, so the recipe does not claim a hold the page never had.
- **Reduced motion is on, and the other branch is unread by default.** Every
  rule under `@media (prefers-reduced-motion: no-preference)`, and every script
  that switches on the preference, is left out of the default reading, so a
  regression there is not seen. That is the price of the one trick that
  reaches a script animation, which no stylesheet stops. ADR-0012 §5 asks for
  the gap to stay visible, and it is: `reduced-motion` is in the recorded
  recipe and its digest, and the media features the reading resolves against
  say `reduce`. A project whose motion branch is the one under review leaves
  `reduced-motion` out of its list, or declares `no-preference`.
- **Focus is given back.** A host that reads a page somebody goes on using —
  the fixture's test, an agent's browser, a Vitest browser test — returns focus
  to the element that held it once the reading, and any screenshot of it, is
  taken. A collector that owns its page does not. Only focus is given back:
  the blur ran the page's `blur` and `focusout` handlers, and what they did — a
  validate-on-blur error, a combobox closed — stays, while the refocus runs the
  `focus` handlers again.
- **The clock is `Date` alone.** A script added before the page's own replaces
  `new Date()`, `Date()` and `Date.now()`, and gives the same instant to
  `Intl.DateTimeFormat`'s `format()` and `formatToParts()` without a date.
  `setTimeout`, `requestAnimationFrame` and `performance` stay the browser's.
  This amends ADR-0012 §2, which declined runtime substitution because a
  difference the patch causes cannot be told from one the code causes. That
  failure needs the substitute to behave unlike the original where the code
  depends on it, and a fixed `Date` does: code that measures elapsed time with
  `Date.now()`, a debounce or a throttle such as lodash's `debounce`, sees no
  time pass and never fires. The substitution is accepted for `Date` anyway.
  What it removes is a second reading in every page that prints a date; what it
  adds is confined to code timed by `Date`, which a test can opt out of, and the
  clock is in the key, so a reading without it is `incomparable`, never
  `changed`. The timers, which every settle step and animation depends on, are
  not touched.
- **The instant has one owner, the clock's id.** `freeze-clock` is the clock at
  `DEFAULT_NOW`; any other instant is `freeze-clock@<instant>`, so an instant
  is spelled in the id only when it is not the default. The recipe digest folds
  ids, so the instant is in the key without a second field to agree with it,
  and a baseline taken at one instant reads `incomparable` against a run at
  another.
- **The timezone and the locale are pinned, and in the environment key.** The
  collectors' harness and the renderer open each page in the timezone and
  locale the project declares, or in `UTC` and `en-US`, never the host's.
  `varianceFixtures` redefines Playwright's `timezoneId` as `UTC` when the
  suite declares none, so every test of a suite extended with it opens in
  `UTC`, including a test that never calls `variance`. Playwright Test already
  defaults the locale to `en-US`.
  `createVariance` reads a page the caller opened and cannot pin it; it keys
  whatever that page runs in. Both values are environment inputs and enter both
  digests, the full and the semantic, because text is laid out and another date
  or language moves the box tree; the renderer's `rasterization` names them
  too, since the page's scripts run there. They belong with the clock: a fixed instant is one date
  and one time of day only in one timezone. `DEFAULT_NOW`, noon UTC on 15 June,
  is 22:00 that day in Sydney and midnight on 16 June in Auckland, so a fixed
  `Date` in the host's timezone prints the host's time of day, and east of
  UTC+11 the host's date. This reverses spec 0008, which kept the locale a
  collector input and out of the key: the base locale is now the key's, and the
  other locales of a `locales` list stay collector inputs, compared within one
  run.
- **Render paints under `no-focus` alone.** A painted document still honours a
  collected `autofocus`, and the browser applies it at the next rendering
  update, so the blur waits a frame when the document holds one. The other
  three have nothing to act on there: the date the page printed is already text
  in the document, its `@media` rules were resolved when it was read, and
  nothing moves the pointer over it. ADR-0029 §1's two recipes now differ in
  these three and in the animation trick.
- **`needs: 'layout'`, argued against ADR-0012 §3.** §3 says a trick declares
  the cheapest tier that can observe its effect, and a focus ring or a printed
  date can be observed by the semantic reading. The semantic tier is also the
  one whose host has no browser: in jsdom the test is the page, its clock is
  the test's fake timers, and its focus is the test's own arrangement. Holding
  them there would change what the test set up, so `SEMANTIC_RECIPE` stays
  empty and no jsdom key moves. The Playwright fixture holds the same two on a
  test's page, and does not change what the test set up: it holds them before
  the test body runs, so a focus or a `page.clock` the test arranges comes
  after and wins, and the focus a reading releases is given back. In jsdom
  there is no moment before the test that the reading owns. It is called from
  inside the test, into the global the test's fake timers already replaced, so
  any hold would land on top of the arrangement rather than under it.

## Alternatives

- **Playwright's `clock.setFixedTime`.** It fixes `Date`, and installs its own
  `setTimeout`, `requestAnimationFrame` and `performance` to do it. Measured in
  `untouched.chromium.test.ts`: under it a frame's timestamp no longer equals
  `document.timeline.currentTime`, the time CSS and Web Animations step by. It
  also takes `page.clock` from the test; the init script leaves it, and a clock
  the test installs replaces the fixed `Date`.
- **`clock.install()` and `pauseAt()`.** Stops the timers, and a page that
  settles on a timer never settles.
- **The instant as an environment input of its own.** Two owners for one value:
  the recipe would say `freeze-clock` and a field would say when, and nothing
  makes them agree.
- **`Date` left real, `freeze-clock` opt-in.** A debounced test keeps
  working, and every page that prints a date reads `changed` the day after its
  baseline, with nothing naming the clock. The debounce cost falls on the tests
  that wait on one, each of which can leave `freeze-clock` out in one line; the
  date cost falls on every reading of every adopter. The two failures do not
  read alike: a date shows in the diff, and a debounce that never fires names
  nothing. The default takes the second because it reaches only tests that wait
  on `Date`-timed code, and the documentation names it where a reader looks for
  a debounce that stopped firing.
- **A fixed `Date` in the collectors only, opt-in in the fixture.** The
  collectors own their pages, and the fixture's page is the test's, so the
  fixture's costs (a debounce, a cookie, a closed hover menu) would stay out of
  user tests. But the fixture's in-place capture photographs that page, and a
  date it prints reads `changed` the day after its baseline as a collector's
  would. Presentation is left undriven for another reason: it is handed a page
  that has already loaded and read the time, and an init script reaches only
  the next navigation, while the fixture drives its page before the test body
  loads anything.
- **A `Date` that advances from the fixed instant.** A debounce would fire, but
  the time a component prints would then depend on how long the page took to
  reach it, which is the second reading the trick exists to remove.
- **Reduced motion off, as Chromatic leaves it.** The `no-preference` branch
  would be read, and a script animation would run into every reading, with no
  trick that reaches it.
- **`DEFAULT_NOW` in the future.** A cookie the page sets with an expiry
  counted from `Date.now()` would be stored, and a client that compares a
  token's `exp` with `Date.now()` would refuse today's tokens as expired. One
  of the two breaks whichever side of today the instant sits on; a past one
  keeps "expired" stable across runs.
- **The host's timezone and locale, keyed.** Every reading on a laptop outside
  `UTC` would be `incomparable` against a baseline made in CI, which is a
  baseline nobody can check locally.
- **The timezone and locale in the full digest only.** The semantic key would
  then match two readings whose text differs, and the box tree is built from
  that text.
- **Opt-in, as before.** Leaves four sources of a second reading to every
  author, and the run reports each as `changed` against a component.
- **Disabling script.** The page is the adopter's, and disabling its script is
  disabling the subject (ADR-0029).

## Consequences

Every layout and raster baseline made before this reads `incomparable` once:
the recipe digest moved. Semantic baselines do not, since `SEMANTIC_RECIPE`
stayed empty. The ruleset version did not move. Shipped in one release with any
other change that makes baselines `incomparable`, an adopter re-accepts once.

A `page.clock.install()` the test makes wins, but the recorded recipe still
names `freeze-clock`, a hold the page no longer had; nothing in the fixture sees
the install. The documentation says to leave `freeze-clock` out of
`varianceStabilize` when the test owns the clock, and a `FIXME` in
`driveBeforeTest` marks the gap.

A fixed `Date` stops a debounce or a throttle timed with `Date.now()`. The
fixture fixes `Date` before the test body runs and leaves it fixed until the
test ends, so a test that types into a debounced search box and waits for the
results can stop getting them after the upgrade, with nothing in the failure
naming the clock. The documentation and the changeset name the cost and the way
out: `varianceStabilize: DEFAULT_STABILIZE.filter((id) => id !== 'freeze-clock')`.

A fixed `Date` also stalls code that waits on it: a loop that spins until
`Date.now()` passes a mark never ends and hangs the page, and an animation
timed by `Date`, such as jQuery's `animate`, never calls its `complete`.

`DEFAULT_NOW` is in the past, and the browser's cookie store keeps real time.
A cookie a page script sets with an expiry counted from `Date.now()`, such as
js-cookie's `Cookies.set(key, value, { expires: 365 })`, expires in 2025 and
is never stored: a consent banner the test dismissed comes back after the next
navigation, and a client-side "remember me" does not stick. A client that
checks a token's `nbf` or `iat` against `Date.now()` can refuse a token issued
today. Cookies a server sets keep real time and are not affected. The way out
is a `varianceNow` near today, or `freeze-clock` left out.

A test that asserts a date formatted in the host's timezone, on a host outside
`UTC`, reads `UTC` after the upgrade; a `timezoneId` in the suite's `use` keeps
its own. That reaches every test of a suite extended with `varianceFixtures`.

Not closed:

- `Temporal.Now` and `Date` inside a worker read the real time (a `TODO` in
  `freezeDate`).
- The ticking story ADR-0030 names stays unstable: it counts its own
  `setInterval`, which the fixed clock leaves running on purpose.
- A `<script>` inside a subject root is carried into the render document and
  runs there under the real clock (a `TODO` at `LAYOUT_RECIPE`).
- A document is painted under the render recipe whatever recipe it was read
  under, so a reading taken without `no-focus` is still painted blurred (a
  `TODO` at `LAYOUT_RECIPE`).
- `createVariance` reads a page its caller opened and cannot pin it. It keys
  the timezone and locale that page runs in, which are the host's when the
  caller's context set none, so its readings on a host outside `UTC` are
  `incomparable` against CI's. Vitest browser mode paints in
  `UTC` and `en-US` whatever its tab ran in, and neither it nor jsdom writes a
  timezone or locale to the key (a `FIXME` at each site).
