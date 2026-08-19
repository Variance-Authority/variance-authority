# Replacing what you have

Four things teams already run, and what taking this instead actually costs and
buys. Each section states the trade in the same shape: what you have, what you
write, what you get that you did not have, and **what you lose** — because in
three of the four there is something.

[`surface.md`](surface.md) answers *how does my suite get in*, [`flows.md`](flows.md)
answers *how much infrastructure do I stand up*. This answers *why would I move*.

Nothing here is a migration guide. The packages are MIT and publishable, but no
tag has been pushed and nothing has reached a registry, so all four still begin
with vendoring this repository — see [surface.md §2](surface.md#2-what-you-install)
and [spec 0015](specs/0015-the-first-published-release.md).

---

## 1. Replacing `expect(page).toHaveScreenshot()`

**What you have.** Playwright's built-in matcher, `.png` files beside the test,
`--update-snapshots` when it goes red, and a `maxDiffPixels` somebody raised
after the third flake and nobody has lowered since.

**What you write.** One additive observation. The helper is
[`@variance-authority/playwright-test`](../packages/playwright-test), and the
test body you already have is the collector — this is the one adoption path in
the project that needs no collector written, because a Playwright test has
navigated, mounted and waited before the observation is made. The package does
not export `test` or `expect`.

```ts
import { test } from '@playwright/test';
import { assertUnchanged, observe } from '@variance-authority/playwright-test';

test('the cart survives an empty basket', async ({ page }, testInfo) => {
  await page.goto('https://example.test/cart');
  await page.getByRole('button', { name: 'Clear' }).click();

  assertUnchanged(await observe(page, page.getByTestId('cart'), testInfo));
});
```

**What you get.** The failure names a component and a file instead of a number.
The measured version of that difference, from
[`examples/todomvc/src/observe.chromium.test.ts`](../examples/todomvc/src/observe.chromium.test.ts):
1530 changed pixels become 5 regions across 3 components, two of which are causes
and one of which merely reflowed around them. You also get `incomparable` — a
baseline painted by another machine is refused rather than diffed, which is the
failure mode `maxDiffPixels` was raised to hide.

**What you lose.**

- **Speed, per subject.** `toHaveScreenshot` takes one screenshot. This acquires
  a document, paints it, and compares — the subject is rendered twice, once by
  your application and once from its document. The reason is in the package
  README: a live-page screenshot has no render identity behind it, and a baseline
  nobody can attribute to a machine is a baseline nobody can decide to discard.
- **Cause-first ordering.** The durable path carries one snapshot, so the docket
  is ordered by area and says so. Ranking needs both revisions.
- **Whole-page shots.** The subject is a `Locator`, deliberately.

---

## 2. Replacing `toMatchImageSnapshot` in jest or vitest

**What you have.** `jest-image-snapshot`, a `__image_snapshots__` directory, and
a CI container pinned to keep the pixels reproducible — which is most of the cost
and all of the reason nobody runs it locally.

**What you write.** A test that mounts the component, `acquireDocument` on the
mounted element, and a renderer that lives somewhere else. jsdom describes;
Chromium paints. Proven byte-identical in-process and across an HTTP hop in
[`examples/todomvc/src/offload.chromium.test.tsx`](../examples/todomvc/src/offload.chromium.test.tsx).

**What you get.** The pinned container stops being the price of admission. The
machine-bound artifact is confined to the one tier that has one, so a unit-test
process with no browser in it can still produce a pixel verdict — and the same
run settles structure, ARIA and token bands in milliseconds before anything is
painted at all.

**What you lose.**

- **The renderer becomes a service you run.** That is the trade in one sentence:
  a container everywhere, or one pinned machine and a socket. See
  [`packages/remote`](../packages/remote).
- **Layout, on the cheap tier.** jsdom has no layout engine, so bands it cannot
  observe report `unobserved` rather than passing. That is a refusal, not a gap —
  but a suite that believed jsdom was checking spacing was believing something
  false, and this is where it finds out.

---

## 2b. Replacing Percy on a set of URLs

**What you have.** `percy snapshot` over a URL list, a sitemap or a static build,
`widths: [375, 1280]` in `.percy.yml`, and a per-snapshot bill that multiplies by
every width you added.

**What you write.** A config. There is no collector to write for this path:
[`@variance-authority/route-collector`](../packages/route-collector) takes the
addresses and reads what is served.

```json
{
  "viewport": { "width": 1280, "height": 800 },
  "subjects": { "kind": "list", "ids": ["home", "cart"], "collector": "./variance.routes.js" }
}
```

```js
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: { home: 'https://staging.example/', cart: 'https://staging.example/cart' },
  widths: [375, 1280],
  ready: { cart: '[data-testid="cart-loaded"]' },
});
```

Two routes at two widths is four subjects — `home@375`, `home@1280`, `cart@375`,
`cart@1280` — each with its own baseline and its own verdict, because a page has
a layout per breakpoint and one green line over three of them is not a result.

**What you get.** Each width is genuinely laid out: the page is re-navigated at
the new size rather than reflowed, so a component that read `matchMedia` when it
mounted decides again. That distinction is asserted rather than assumed — a
collector that recorded the requested viewport while painting at the run's would
produce three baselines of one picture, all green, with nothing anywhere to
notice.

You also get what the wire knows. Every image, font and media response is hashed
into the environment key, so a logo re-exported behind the same URL is a
different baseline rather than a false `unchanged`; animated GIFs are frozen on
the wire before the browser decodes them; and the run waits on what was actually
requested rather than polling `document.images`
([`stabilization.md`](stabilization.md)).

**What you lose.**

- **Cross-browser from one capture.** Percy serializes the DOM once and renders
  it in four engines off your critical path. One engine is selected per run here,
  and a matrix is [explicitly out of scope](specs/0020-a-cross-browser-grid.md).
  This is the largest single thing Percy sells that this does not have.
- **Retroactive rules.** Percy lets you silence a noisy region from the dashboard
  and have it apply to past builds. Here an ignore is a declaration in your
  config and it applies to the next run ([`ignores.md`](ignores.md)) — auditable,
  and slower.
- **A scale factor or a colour scheme per subject.** Both are fixed when the
  browser context opens, so a subject asking for one the run did not open with is
  **refused by name** rather than painted at the wrong one and recorded at the
  right one. Two runs, two configs.
- **A crawler.** A sitemap is read and a built directory is walked and served —
  `sitemap: '…/sitemap.xml'` or `directory: './build'`, with
  `subjects.kind: "collector"` — but nothing follows a link, and a sitemap *index*
  is taken as pages rather than followed, because fetching what a fetched document
  points at is a different product. A page either of them stops listing stops
  being watched, silently; that trade is why `kind: "list"` still exists.

---

## 3. Replacing Percy or Chromatic on a Storybook

**What you have.** A build, an upload, a hosted review UI, and a per-snapshot
bill. The number to beat is about **$283/month** for a 200-component library at
100 PR builds on Chromatic Starter with TurboSnap
([comparison §1](comparison.md#the-one-commercial-fact-worth-isolating)).

**What you write.** Five lines. The collector is shipped —
[`@variance-authority/storybook-collector`](../packages/storybook-collector) —
and what remains yours is a ready selector for any story that defers its own
mount, and the directory your components live in. The hand-written version this
replaced was 341 lines across three files, and the same end-to-end test passes
against both.

**What you get.** The whole workflow, demonstrated end to end over a Storybook
this project did not write — *new (exit 1) → accept (0) → unchanged (0) → 5 of 8
changed (exit 1)* on a build with one component edited, finding exactly the five
stories that render it. Rendering stays yours, storage is a directory or git-LFS,
and there is no per-snapshot meter.

A story that declares its own viewport is read at it — applied to the page
before the story mounts, rather than recorded and ignored, which is the same
correctness rule the URL path states above.

**What you lose.**

- **Time to first verdict.** Theirs is an afternoon from `npx` and a token.
  [metrics.md M6](metrics.md#m6-time-to-first-verdict-on-a-cold-repository)
  records this project's as *unbounded* — not because of the collector, which is
  five lines, but because nothing is published and there is no install path at
  all.
- **A hosted review UI.** [`packages/tribunal`](../packages/tribunal) implements
  builds, a docket and an approval that promotes the candidate the run already
  produced — and has never been deployed to Cloudflare.
- **A hosted anything.** History records and answers — eleven separately
  correct 2px approvals produce a `DRIFT:` line naming the 22px
  ([`history.md`](history.md)) — but the service is one you run, and nobody has
  run the eleven builds that would demonstrate it end to end.

---

## 4. Replacing nothing at all

The case worth stating separately, because it is the one where there is no
incumbent to unseat.

**What you have.** No visual regression, because the team decided the signal was
not worth the bill — and an accessibility lint that reads source, not renders.

**What you write.** One run. No baseline, no store, nothing committed.

**What you get.** The two capabilities in this project that need no past to
compare against: nine inspection rules that read one snapshot and name a
component and a file, and a locale comparison that finds the string nobody
translated and the box that stopped fitting. The first comes from the run; the
second is `compareLocales` in `core/judge`, called from a test that captures the
subject twice ([spec 0008](specs/0008-locale-runs.md)). Both attach to the same
record a comparison would, by the same provenance chain — which is the cleanest
demonstration that the image is not the unit of review.

**What you lose.** Nothing, and that is the point of the rung. What you do not
*gain* is regression detection: rung 0 compares two documents produced by the
same run, so the second revision is the collector's problem — usually a build of
both, which is where the infrastructure this rung saves reappears as build time.
See [flows.md rung 0](flows.md#rung-0--ephemeral-nothing-is-stored).

---

**See also.** [`surface.md`](surface.md) — how a suite gets in ·
[`flows.md`](flows.md) — the storage axis ·
[`comparison.md`](comparison.md) — where each competitor wins ·
[`flakiness.md`](flakiness.md) — the position on variance
