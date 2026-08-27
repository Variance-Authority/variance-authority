# Visual regression for a Storybook

Every story becomes a page to watch. When one changes, you get told *which
component* did it — not just which stories look different.

Three stories here, two of which render the same `Button`.

## 1. Take the first look

```bash
npm install
npx playwright install chromium
npm run build-storybook
npx variance run
```

```
3 subject(s) observed, durable run at 2026-08-27T21:49:30.480Z
rendered by playwright-chromium (chromium@151.0.7922.34, darwin/arm64, 1x)
3 new

[new] story:button--neutral: no baseline for `story:button--neutral` under this renderer; nothing to compare against
[new] story:button--primary: no baseline for `story:button--primary` under this renderer; nothing to compare against
[new] story:panel--settings: no baseline for `story:panel--settings` under this renderer; nothing to compare against
```

Exit code `1`. You have not approved anything yet, so there is nothing to
compare these stories against.

A run prints more than this — what it had to hold still before measuring, and
which components render the same output in more than one story. The lines above
are the ones you act on.

## 2. Approve what you see

```bash
npx variance accept story:button--neutral story:button--primary story:panel--settings
npx variance run
```

Exit code `0`.

## 3. Change one component

Round `Button`'s corner — `borderRadius: 6` to `14` in
[src/Button.jsx](src/Button.jsx) — then rebuild and run:

```
3 changed

[changed] story:button--neutral — V: 93 pixel(s) differ across 3 region(s) in V
[changed] story:button--primary — V: 82 pixel(s) differ across 4 region(s) in V
[changed] story:panel--settings — V: 43 pixel(s) differ across 4 region(s) in V
```

Three stories moved. Only one of them is a `Button` story — `Panel` renders a
`Button` too, and it moved for the same reason.

## 4. Ask what caused it

```bash
npx variance comment
```

```
## Visual variance — 3 subject(s) need review

playwright-chromium (chromium@151.0.7922.34, darwin/arm64, 1x) · durable retention · 2026-08-27T21:49:45.835Z

### Causes

1. **`V`** — the cause in 3 subject(s), 86px
    `src/Button.jsx:4`
    in `button "Save"`
    seen in `story:button--neutral`, `story:button--primary`, `story:panel--settings`

Collateral: 8 further region(s) (132px) in 1 component across 3 subject(s) moved
with the changes above. Counted and not listed — displacement is not an edit, and
a line each would bury the causes.
```

One cause, three stories, pointed at the line you edited. Everything that merely
shifted because a button got wider is counted and kept out of your way. That is
the reason to run this against a Storybook rather than a folder of pages: the
review starts from the component, not from three images.

This is also the body you post on a pull request — and it prints nothing at all
when the run is green.

## Why the component is called `V`

Because that is its name in the built bundle. `storybook build` minifies, and
by the time the browser renders it there is nothing left called `Button` —
which is why the line above leads with `src/Button.jsx:4`.

That file and line come from
[`.storybook/main.js`](.storybook/main.js), which adds a plugin that stamps
every element with where it was written. Without it a run can still tell you
three stories changed; it cannot tell you they changed for one reason.

## What is where

| file | what it does |
|---|---|
| [.storybook/main.js](.storybook/main.js) | ordinary Storybook config, plus the plugin that preserves file and line |
| [variance.config.json](variance.config.json) | reads `storybook-static/index.json` for the story list |
| [variance/storybook.mjs](variance/storybook.mjs) | tells the run which folders hold your components |
| [src/](src) | two components, three stories |
