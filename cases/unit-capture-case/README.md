# Capture in jsdom, paint in Chromium later

**[Variance Authority](../../README.md)** is a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source.

This case is the end-to-end check that a jsdom unit test can put a component
into that review without a browser anywhere near it. An ordinary Vitest process
mounts a button and writes a **capture** — the markup, the CSS that applies to
it, and the bytes of every resource it references, so a later renderer needs no
access to the origin it came from. A second, separate CLI process reads that
file, opens Chromium once, paints it, and compares.

It is not Vitest browser mode. The unit test has exited before Chromium starts.

## The files

```
capture/button.capture.test.mjs   the jsdom test — mounts a button, calls capture() and writeCapture()
capture/vitest.config.mjs         the capture run's own Vitest config, separate from the repository suite
collector/index.mjs               captureCollector() — how `variance run` finds the written captures
src/workflow.chromium.test.js     the outer test: drives both processes and asserts on the report
```

`@variance-authority/case-unit-capture` is `"private": true` and declares no
scripts of its own. `src/workflow.chromium.test.js` is picked up by the
repository suite's `cases/*/src/**/*.test.{js,ts,tsx}` glob, so the case runs as
part of `yarn test` and can be run on its own by path.

## Run it

You need a checkout, `yarn install`, the workspace built (`yarn build` — the
case shells out to `packages/cli/dist/bin.js`), and Chromium
(`npx playwright install chromium`). Without either the case skips loudly and
prints the command that fixes it.

From the repository root:

```bash
yarn vitest run cases/unit-capture-case/src/workflow.chromium.test.js
```

```
 ✓ cases/unit-capture-case/src/workflow.chromium.test.js (1 test) 3033ms
   ✓ unit capture in one process, browser rendering in another > records and then re-observes the browserless artifact 1972ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

## What the two processes print

The outer test builds a throwaway config and captures directory and drives the
sequence below, asserting on `run.json` at the end. Running the same steps by
hand, the jsdom half leaves one file:

```
captures/button%2Fsave.va-capture.json
```

`variance run` then has a subject and no baseline for it:

```
1 subject(s) observed, durable run at 2026-09-17T21:23:13.498Z
rendered by playwright-chromium (chromium@151.0.7922.34, darwin/arm64, 1x)
1 new

[new] button/save: no baseline for `button/save` under this renderer; nothing to
compare against; the collection of this subject reported unverified-fonts (warn)
×2, portals-not-resolved (warn), so what was compared may be less than the whole
subject

no component named in 1 subject(s) — these subjects carry no component
provenance, so a change in them can be located in the image but not attributed
to what rendered it
```

`variance accept --all` approves that first image, and a second `variance run`
compares against it:

```
accepted 1 subject(s)
  [accepted] button/save — images/button%2Fsave.after.png
```

```
1 subject(s) observed, durable run at 2026-09-17T21:23:14.564Z
rendered by playwright-chromium (chromium@151.0.7922.34, darwin/arm64, 1x)
1 unchanged

nothing to review
```

That verdict is what the outer test asserts on, from `run.json`:

```json
{
  "subject": "button/save",
  "verdict": "unchanged",
  "because": "the document this run assembled is byte-identical to the one the baseline was painted from, under the same renderer identity, so no image was produced; the collection of this subject reported unverified-fonts (warn) ×2, portals-not-resolved (warn), so what was compared may be less than the whole subject",
  "changedPixels": 0
}
```

## What it does not cover

jsdom has no layout engine, so the capture carries structure and declared style
and nothing computed. Pixels and a verdict come back, but a changed region is
located in the image and not attributed to the component that drew it — the
`no component named` line above is that limit reporting itself. Attribution
needs the browser inside the test; see
[`cases/storybook-case`](../storybook-case) and
[`cases/playwright-additive-case`](../playwright-additive-case) for the paths
that have it.

The adopter-facing walkthrough of this workflow is
[`docs/start-unit.md`](../../docs/start-unit.md).
