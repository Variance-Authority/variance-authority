# Visual regression inside a Playwright test

Use this when the thing you want to watch has no URL. A form that has been
submitted, a menu that has been opened, an account that has been logged into —
your test already knows how to get there, and this adds one line that looks at
what it found.

Your suite keeps its own `test` and `expect`. Nothing here replaces the runner.

## 1. Take the first look

```bash
npm install
npx playwright install chromium
npx playwright test
```

Both tests fail, and say why:

```
Error: join/empty: new — no baseline for `join/empty` under this renderer; nothing to compare against
```

Nobody has agreed what these should look like yet. A pass here would let a
subject into the suite that no one had ever looked at.

## 2. Approve what you see

Playwright already has a verb for this, and it is the one you use:

```bash
npx playwright test --update-snapshots=all
npx playwright test
```

Two passed.

## 3. Break it

The error banner in [server.mjs](server.mjs) gets taller — `BANNER_PADDING`
from `10px 12px` to `18px 12px`. Run the tests again:

```
1) tests/join.spec.js:14:1 › the form after submitting nothing

    Error: join/rejected: changed — 9620 pixel(s) differ across 1 region(s), and the subject resized from 468×251 to 468×267
    1 region(s), ordered by area — no causes were supplied, so this
    ordering measures displacement rather than blame:
      9620px — at 24,82 (420×161)
          in main

  1 failed
  1 passed
```

One test failed. The banner is hidden until you submit an empty form, so
`join/empty` never rendered it and is honestly reported as passing — a
screenshot suite that photographed the page instead of the state would have
gone red twice and left you to work out which one meant something.

## Where the pixels are compared

Not by Playwright. `assertUnchanged` is an ordinary assertion over an
`Observation`, so a test can read `verdict`, `regions` or `signals` and decide
for itself before it throws — retry a flaky subject, warn instead of failing,
gate on the count. The default is to throw, because that is what a test is for.

## What this path does not do

It does not name a component. The message above says so itself: *no causes were
supplied*. Pass `source` to `observe` and regions resolve to `file:line`
instead; [the Storybook example](../storybook) shows what that reads like when
the run can see your components.

## What is where

| file | what it does |
|---|---|
| [tests/join.spec.js](tests/join.spec.js) | two tests; the second reaches a state no URL serves |
| [playwright.config.js](playwright.config.js) | ordinary config — `webServer` starts the app |
| [server.mjs](server.mjs) | stands in for your application |
