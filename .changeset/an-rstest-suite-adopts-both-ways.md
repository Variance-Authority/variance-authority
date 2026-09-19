---
'@variance-authority/playwright-test': minor
---

An Rstest suite can adopt this, in either of the two shapes it runs in

[Rstest](https://rstest.rs) runs a suite in `jsdom` with no browser, and — since
`@rstest/playwright` — hands a test body a live Playwright `Page`. Those are the
two adoptions this project already has, under one runner, and neither of them
worked.

The deferred half needed nothing new: an Rstest test in `jsdom` writes a capture
with `@variance-authority/unit-test` and a later `variance run` paints it, the
same as any other unit runner. What was missing was the in-place half. A
`@rstest/playwright` body has a `page` and no `TestInfo`, so the five facts an
observation needs about its run — the subject id, the file that owns it, the
colour scheme and scale it was painted at, and whether this run may approve
anything — were not reachable.

`@variance-authority/playwright-test/rstest` exports `runOf`, which reads them
from three of the values the body destructures:

```js
import { describe, test } from '@rstest/playwright';
import { assertUnchanged, createVariance } from '@variance-authority/playwright-test';
import { runOf } from '@variance-authority/playwright-test/rstest';

describe('cart', () => {
  test('empty', async ({ page, task, expect, playwright }) => {
    const variance = await createVariance(page, runOf({ task, expect, playwright }), {
      materialization: { kind: 'in-place', browser: { headless: true } },
    });
    try {
      assertUnchanged(await variance.observe(page.locator('#cart')));
    } finally {
      await variance.close();
    }
  });
});
```

Three values rather than one context because Rstest refuses a test body whose
first parameter is not an object pattern, so there is nothing whole to hand
over. The subject id is the suite chain — `cart > empty` becomes `cart/empty` —
and the file that owns it is the spec relative to the project root, so nothing
in the test spells a name out.

**Approval is `rstest run -u`, and only that.** Rstest's own default for a
snapshot with no baseline is to write one, which is the absence Playwright
spells `missing`; reading it as approval would promote an image out of the
unreviewed run that produced it, so the adapter does not.

No new package. An Rstest e2e test needs Playwright and a browser binary, which
is what `@variance-authority/playwright-test` already asks of an adopter, and a
second box would be a second name for one requirement.

`cases/rstest-case` drives the real `rstest` CLI through both loops — capture,
`variance accept`, `unchanged`; then failure, `-u`, agreement — and
[`docs/start-rstest.md`](https://variance-authority.dev/docs/start-rstest) is
the walkthrough.
