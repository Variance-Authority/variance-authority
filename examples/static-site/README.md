# Visual regression for a built static site

The command-line path: point Variance Authority at a directory of built HTML,
and every page in it becomes a subject a run compares against an approved
baseline. No test framework, no server, no service — the exit code is the whole
CI integration.

Two pages, one shared stylesheet, four commands.

## 1. Nothing is a baseline until you say so

```bash
npm install
npx playwright install chromium
npx variance run
```

```
2 subject(s) observed, durable run at 2026-08-27T21:29:43.287Z
rendered by playwright-chromium (chromium@151.0.7922.34, darwin/arm64, 1x)
2 new

[new] checkout.html: no baseline for `checkout.html` under this renderer; nothing to compare against
[new] pricing.html: no baseline for `pricing.html` under this renderer; nothing to compare against
```

Exit code `1`. There is nothing to compare against yet, and the run says so
rather than inventing agreement by accepting whatever it saw first.

## 2. Approve what you see

```bash
npx variance accept checkout.html pricing.html
npx variance run
```

Exit code `0`. Named subjects rather than `accept --all`, because `--all`
cannot tell a baseline nobody has ever reviewed from one that just changed.

## 3. Break it

Both pages render the same `.card`. Widen its corner in one place —
`border-radius: 6px` to `14px` in [site/style.css](site/style.css) — and run
again:

```
2 changed

[changed] checkout.html: 110 pixel(s) differ across 8 region(s)
[changed] pricing.html: 110 pixel(s) differ across 8 region(s)
```

Exit code `1`. One declaration, two subjects. The run names the pages and
counts the regions, so a reviewer knows the blast radius before opening a
single image.

Accept it and the new renderings become the baselines; revert the stylesheet
and the next run is green with nothing to approve.

## Why the baselines are not in this repository

A baseline belongs to the renderer that produced it. The identity above —
`chromium@151.0.7922.34, darwin/arm64` — is part of where it is stored, so a
baseline recorded on a laptop is not found by a run on a Linux CI image, which
correctly reports `new` rather than blaming a font stack for a diff it cannot
explain.

That is why baselines are generated where the pipeline runs, usually in a
pinned container image, and committed from there. An example that shipped one
person's macOS baselines would go red on the first machine that cloned it.

## What is where

| file | what it does |
|---|---|
| [variance.config.json](variance.config.json) | the whole configuration: viewport, browser, where baselines land |
| [variance/routes.mjs](variance/routes.mjs) | turns every `.html` under `./site` into a subject, narrowed to its `<main>` |
| [site/](site) | stands in for your build output — replace it with yours |

## What this path does not do

It compares whole pages. It does not name the component that caused a change,
because built HTML no longer records which source file produced which element
and nothing in the browser can recover that afterwards. When the cause matters
more than the diff, the run needs source provenance — which is what the
Storybook and React paths carry.
