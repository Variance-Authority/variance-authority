# One runner, two adoptions

**[Variance Authority](../../README.md)** is a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source.

[Rstest](https://rstest.rs) is a Rspack-native test runner. It can run a suite
in `jsdom` with no browser anywhere, and — through `@rstest/playwright` — it can
hand a test body a live Playwright `Page`. Those are the two ways a suite adopts
this system, and this case drives both against the real `rstest` CLI in the same
package.

**Deferred.** A `jsdom` test mounts a button and writes a **capture** — markup,
the CSS that applies to it, and the bytes of every resource it references. The
test exits. A separate `variance` process reads that file, opens Chromium once,
paints it, and compares. No browser is installed for the suite's sake.

**In place.** A `@rstest/playwright` test drives a page it already knows how to
reach, and asks for the observation inside the body. The verdict is an assertion
the runner reports, and approval is Rstest's own `-u`.

## The files

```
capture/button.capture.test.mjs   the jsdom test — mounts a button, calls capture() and writeCapture()
capture/rstest.config.mjs         testEnvironment: 'jsdom', and nothing else
collector/index.mjs               captureCollector() — how `variance run` finds the written captures
e2e/cart.e2e.test.mjs             the in-place test — createVariance(page, runOf({ task, expect, playwright }))
e2e/rstest.config.mjs             definePlaywrightConfig() — colour scheme, scale and launch flags
src/workflow.chromium.test.js     the outer test: drives every process and asserts on what it printed
```

`@variance-authority/case-rstest` is `"private": true` and declares no scripts
of its own. `src/workflow.chromium.test.js` is picked up by the repository
suite's `cases/*/src/**/*.test.{js,ts,tsx}` glob, so the case runs as part of
`yarn test` and can be run on its own by path.

## Run it

You need a checkout, `yarn install`, the workspace built (`yarn build` — the
deferred half shells out to `packages/cli/dist/bin.js`), and Chromium
(`npx playwright install chromium`). Without either the case skips loudly and
prints the command that fixes it.

From the repository root:

```bash
yarn vitest run cases/rstest-case/src/workflow.chromium.test.js
```

```
 ✓ cases/rstest-case/src/workflow.chromium.test.js (2 tests) 4529ms
   ✓ an rstest suite that defers the browser > captures in jsdom and re-observes
     what a later CLI process painted 1814ms
   ✓ an rstest suite that drives playwright > refuses an unapproved image,
     accepts under -u, and then agrees 2715ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
```

## What the deferred half prints

The `jsdom` run imports no browser package and takes 280ms:

```
### Passed

- button.capture.test.mjs :: captures a mounted component for a later browser job
```

It leaves one file behind, under the directory the config's collector reads:

```
captures/button%2Fsave.va-capture.json
```

`variance run` then has a subject and no baseline for it:

```
1 subject(s) observed, durable run at 2026-09-19T03:17:11.103Z
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
1 subject(s) observed, durable run at 2026-09-19T03:17:11.885Z
rendered by playwright-chromium (chromium@151.0.7922.34, darwin/arm64, 1x)
1 unchanged

nothing to review
```

That verdict is what the outer test asserts on, from `run.json`:

```json
{
  "subject": "button/save",
  "verdict": "unchanged",
  "changedPixels": 0
}
```

## What the in-place half prints

Three `rstest` processes over one baselines directory. The first has nothing to
compare against, so `assertUnchanged` throws and Rstest reports it as an
ordinary failure — file, name, frame and all:

```
### [F01] cart.e2e.test.mjs :: cart > empty

"message": "cart/empty: new — no baseline for `cart/empty` under this renderer; nothing to compare against",
"topFrame": { "file": ".../packages/playwright-test/src/matcher.ts", "line": 48, "method": "assertUnchanged" }
```

Exit code 1. The second run is the same command with `-u`, which is the flag a
reader already uses for Rstest's own snapshots, and the only thing that promotes
an image — the absence of a flag is never approval. The third run is the bare
command again and agrees:

```
### Passed

- cart.e2e.test.mjs :: cart > empty
```

The subject name in those messages is `cart/empty`, which is the suite chain
Rstest joins with ` > `. Nothing in the test spells the name out.

## What it does not cover

The deferred half runs in `jsdom`, which has no layout engine, so the capture
carries structure and declared style and nothing computed. Pixels and a verdict
come back, but a changed region is located in the image and not attributed to
the component that drew it — the `no component named` line above is that limit
reporting itself. The in-place half has the browser inside the test and does not
share that limit.

Both halves render one subject on one Chromium. This case says nothing about
Rstest's own watch mode, its browser-mode plans, or a suite large enough for
sharding to matter.

The adopter-facing walkthrough of both modes is
[`docs/start-rstest.md`](../../docs/start-rstest.md).
