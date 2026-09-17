# See what changed in the UI, and what changed it

**Variance Authority** is a visual regression system you run yourself: it
renders a UI state, compares it against the baseline you approved, and reports
what changed in the vocabulary of your source. `toHaveScreenshot`, Percy,
Chromatic and Argos answer a red build with a pixel count and two images, which
leaves somebody to find the changed region by eye, work out which component drew
it, and guess whether a person authored that change or the state is simply
unstable. Here a changed region carries the component that rendered it and the
`file:line` it was written at; a state that changed is captured a second time
before the result is reported, so an authored change arrives separately from one
that disagrees with itself; and an image painted under a different browser,
platform, scale factor or font stack comes back `incomparable`, naming what
differs, instead of as a page of red pixels you triage by hand.

## Try it on one state

Each comparison is keyed by a **subject id** — one named UI state you can ask
for again, such as `cart/empty`. In a Playwright test you already have, add one
call and one assertion; the test keeps its runner, navigation, fixtures and
existing assertions.

```bash
npm install --save-dev @variance-authority/playwright-test @playwright/test
npx playwright install chromium
```

```ts
import { test } from '@playwright/test';
import { assertUnchanged, observe } from '@variance-authority/playwright-test';

test('the cart survives an empty basket', async ({ page }, testInfo) => {
  await page.goto('https://example.test/cart');
  await page.getByRole('button', { name: 'Clear' }).click();

  const observation = await observe(page, page.getByTestId('cart'), testInfo, {
    subjectId: 'cart/empty',
  });

  assertUnchanged(observation);
});
```

The first run reports `new`, because no baseline has been approved for that id
yet. Promote the image that run produced, and the next run reports `unchanged`.
Nothing accepts a first baseline on your behalf.

Storybook, application routes, unit tests and custom collectors run the same
loop from the CLI instead:

```bash
variance run --config variance.config.json
variance accept --config variance.config.json cart/empty
```

[Observe one state](start.md) takes one subject through capture, review and
acceptance end to end, and chooses the harness to start from.

## Why a passing test is not the whole answer

A good test describes behaviour at a level that survives implementation changes.
It does not fail because a function moved or a component was wrapped.
[Test Desiderata](https://testdesiderata.com/) names that balance through
properties such as behavioural, structure-insensitive and predictive.

The same restraint leaves a blind spot. A high-level assertion passes while
presentation, execution, component state, dependencies, or an unasserted part of
the interface changed. That can be harmless, intentional, or damage, and the
pass alone does not separate them.

So after changing code you need two answers, and neither substitutes for the
other: the codified path still holds, and the edit produced the effect you
intended. Preserving the path while producing no effect means the work did not
land; producing the effect while breaking the path means it landed badly. A
passing assertion supplies the first answer only.

Variance Authority observes beside the assertion and retains what changed in the
interface, execution, component state and source. The rendered comparison
establishes the effect. [Attribution](attribution.md) connects that effect to the
component and line that caused it, and [composition](composition.md) shows every
other observed state the same component reached. The test stays readable and
structure-insensitive; the nuance is available when a person or an agent needs
it, rather than turned into a failure.

## Where to go next

<div class="doc-link-grid doc-link-grid--capabilities">
<a class="doc-link-card doc-link-card--compact" href="better-tests.md">
<span>Improve</span>
<strong>Make the suite earn its cost</strong>
<p>Keep useful work and evidence; remove work that serves no decision.</p>
<em>Build better tests →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="run-relevant-work.md">
<span>Select</span>
<strong>Run what the change can reach</strong>
<p>Use source reach and recorded execution to choose the work that matters.</p>
<em>Run relevant work →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="evidence-field.md">
<span>Understand</span>
<strong>Ask more of a run</strong>
<p>Read source, execution, interface and history without forcing one pipeline.</p>
<em>Use the available evidence →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="explain-variance.md">
<span>Explain</span>
<strong>Connect effect, cause and impact</strong>
<p>Find where readings parted, what caused the fork, and how far it reached.</p>
<em>Explain variance →</em>
</a>
</div>

Start from the harness that already reaches the state you want to review:
[Playwright](start-playwright.md), [Storybook](start-storybook.md),
[application routes](start-routes.md), [Jest or Vitest](start-unit.md),
[Vitest browser mode](start-vitest-browser.md), [a custom
collector](start-custom.md), or [the CLI lifecycle](start-cli.md).

Or enter by the question in front of you: [find the subject you
mean](locate.md), [trace a visible change to source](attribution.md), [trace
instability to its owner](flakiness.md), [fit into an existing screenshot
suite](replacing.md), [compare operating models](comparison.md) against Percy,
Chromatic, Argos and Applitools, or follow [the reasoning
loop](reasoning.md) from a question to a bounded observation.
