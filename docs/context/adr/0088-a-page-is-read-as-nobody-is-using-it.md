# ADR-0088 — a page is read as nobody is using it

**Status:** accepted
**Date:** 2026-10-10
**Amends:** [ADR-0012](0012-observability-and-the-damage-boundary.md) — §2, which
declined runtime substitution, now makes one: `Date`;
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
  `forDriver` drops the rest from the ids and the digest. The two hosts with no
  driver, Vitest browser mode and `@variance-authority/presentation`, record
  `no-focus` alone, which a page does to itself. The route and Storybook
  collectors' page agents are driven by the Playwright harness that opened
  their page, and record all four.
- **Who drives when.** The harness sets the motion preference and the clock
  before its first navigation. The `variance` fixture in
  `@variance-authority/playwright-test` sets them through `driveBeforeTest`,
  before the test body runs; it leaves `no-hover` out, because a test moves the
  pointer as it goes, and moves the pointer off the page through
  `driveBeforeRead` before each observation instead.
- **The motion preference has one owner.** With `reduced-motion` applied, the
  reading declares `prefers-reduced-motion: reduce` among the conditions its
  `@media` rules are resolved against, so a rule the live page applied is read
  as applied. A host that declares its own `prefers-reduced-motion` keeps it,
  and the browser is asked for that value, so the declaration and the
  emulation cannot disagree.
- **Focus is given back.** A host that reads a page somebody goes on using —
  the fixture's test, an agent's browser, a Vitest browser test — returns focus
  to the element that held it once the reading, and any screenshot of it, is
  taken. A collector that owns its page does not.
- **The clock is `Date` alone.** A script added before the page's own replaces
  `new Date()`, `Date()` and `Date.now()`, and gives the same instant to
  `Intl.DateTimeFormat`'s `format()` and `formatToParts()` without a date.
  `setTimeout`, `requestAnimationFrame` and `performance` stay the browser's.
  This amends ADR-0012 §2, which declined runtime substitution because a
  difference the patch causes cannot be told from one the code causes. That
  failure needs the substitute to behave unlike the original where the code
  depends on it. `Date`'s real value is a second reading by definition; the
  substitute removes a difference rather than adding one, and it is in the key,
  so a reading without it is `incomparable`, never `changed`. The timers are
  where the failure ADR-0012 names would live, and they are not touched.
- **The instant has one owner, the clock's id.** `freeze-clock` is the clock at
  `DEFAULT_NOW`; any other instant is `freeze-clock@<instant>`, so an instant
  is spelled in the id only when it is not the default. The recipe digest folds
  ids, so the instant is in the key without a second field to agree with it,
  and a baseline taken at one instant reads `incomparable` against a run at
  another.
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
- The collectors and the renderer open each page in `UTC` and `en-US`, or in
  the pair the project declares, and key both. Vitest browser mode paints in
  `UTC` and `en-US` whatever its tab ran in, and neither it nor jsdom writes a
  timezone or locale to the key (a `FIXME` at each site).
