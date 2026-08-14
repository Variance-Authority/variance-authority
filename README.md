# Variance Authority

**Visual Regression with Verifiable Results.**

Visual regression is good at telling you that something changed. It is much
less useful at telling you why.

A padding token moves. Forty screenshots fail. The tool has found the visual
change, but the next hour still belongs to a reviewer: open the rectangles,
separate the real cause from everything that reflowed around it, and trace the
result back to source.

Variance Authority makes that investigation part of the run. It connects a
changed region to the component that caused it and the `file:line` where that
component lives. The screenshot remains evidence; it stops being the whole
answer.

Variance Authority runs as a local `variance` command in your own CI, against
UI states your Storybook, application, or Playwright tests already know how to
reach. There is no account, no hosted dashboard, and no build to upload.

## One change. One place to look.

The same `Button`, before and after. Only its `background-color` changes; its
content, size, DOM, role, and props stay the same.

| Before | After | Diff |
| --- | --- | --- |
| ![A blue Variance button before the change.](examples/readme-case/artifacts/before.png) | ![The same Variance button in purple after the change.](examples/readme-case/artifacts/after.png) | ![The generated image diff, highlighting the repainted button in red.](examples/readme-case/artifacts/diff.png) |

A pixel diff can show where the image changed. The HTML-aware comparison can
also name what changed and where to review it:

```text
1 root(s): 0 authorized, 1 to review, 0 violation(s).
  [needs-review] Button — Button
      undeclared component change: `Button` (token/paint) reached 1 subject(s)
      examples/readme-case/src/Button.js:9
```

[`examples/readme-case`](examples/readme-case) generates all three images and
that report in the same Chromium run. The generated provenance records the
Chromium engine, the paint-only `background-color` change, and the changed-pixel
count. The displayed diff is derived from the displayed before and after PNGs.

## The document knows what the image cannot

A PNG knows colours and coordinates. It does not know that the changed pixels
came from `Button`, or that only its paint changed while its structure held.

Variance Authority therefore compares the **rendered document**, not just its
image. A run acquires the markup, the CSS that applies to it, the
component ownership chain, and the source provenance available from the
collector. It then asks each question at the cheapest representation that can
answer it:

- structure and authored CSS before a browser is needed;
- semantics under `jsdom` or Chromium;
- pixels only for differences that genuinely require rendering.

That same document can report things no before-and-after screenshot can find:
a control that never had an accessible name, or a string nobody translated.
When a profile cannot observe a band, the report says `unobserved`; it does not
turn missing evidence into a pass.

The result is one report for a person, a pull request, or a coding agent. It can
be JSON, a single HTML file, or an MCP response, and the process exits with a
verdict: `0` for nothing to review, `1` for changes to review, and `2` for an
operator error.

## A real change, a flake, and a neighbour look identical

Three subjects can all report *the pixels moved*, and need three different
people. Telling them apart is a separate job from finding the movement, and it is
the one that decides whether an afternoon is well spent.

A changed subject is therefore collected a second time, twice, each pass varying
exactly one thing:

| | world | time | answers | reported as |
| --- | --- | --- | --- | --- |
| `again` | held | advanced | does this subject move on its own? | `unstable` |
| `alone` | rebuilt | same | did some *other* subject move this one? | `order-dependent` |

Neither is a retry: both outcomes of both are reported, nothing is cleared, and
`variance accept` refuses to promote either — a reading chosen by a race must not
become the thing every later run is measured against. What comes back is not
"this test is flaky" but a component and a band — `Clock (content)` — which is
what a fix can be aimed at.

This is affordable because a green run pays nothing: a subject whose document
digest already matches its baseline's is settled without a render, so the budget
goes to the subjects that moved. The same discipline of one variable runs across
the other axes too — the suite compared to itself at one commit, and a record
across runs kept by a service you deploy.
[`docs/instruments.md`](docs/instruments.md) is the full set, with where each
claim is measured; [`docs/flakiness.md`](docs/flakiness.md) is the position
underneath it, including the four causes of variance nothing here absorbs.

## Evidence, with its limits attached

The repository includes a head-to-head case against Playwright's real
`toHaveScreenshot`, using its runner and its default `pixelmatch` comparator
over the same page and clip. Eight changes were declared before either arm ran
and scored on whether a reviewer needed to be told:

```text
  Playwright defaults  3 hit, 3 miss, 1 hold, 1 deferral
  Playwright tolerant  2 hit, 4 miss, 1 hold, 1 deferral
  Variance Authority   6 hit, 1 false alarm, 1 deferral
```

This is evidence, not a universal win rate. The eight scenarios were selected
by this project because they separate the approaches; they are not a
representative sample of anyone else's suite, and they ran on one machine.
[`cases/incumbent-case`](cases/incumbent-case) contains the executable case.
[Journal 0014](docs/context/journal/0014-the-incumbent.md) records the two times
the measurement corrected this project's own expectations.

The broader corpus scores 38/38 under `jsdom` and 39/39 under
Chromium. It remains the only corpus of its kind in the repository. The
measurement and the evidence still missing are tracked in
[`docs/metrics.md`](docs/metrics.md).

## Scope and non-goals

**The technical bargain.**

Variance Authority is not a hosted visual-testing product. That removes an
account, an upload, and a per-snapshot meter. It also moves real responsibility
onto the team adopting it:

| You control | What that means |
| --- | --- |
| **Compute** | Rendering happens on your machines or on a pinned renderer you operate. |
| **Storage** | Baselines can live in a directory, git-LFS, or a service you deploy. Storage location does not change the verdict. |
| **Mounting** | Storybook, served URLs, and Playwright suites have shipped adapters. A custom component environment supplies its own collector and definition of “ready.” |
| **The gate** | The exit code integrates with any CI that runs a command. Pull-request comments and their credentials remain your workflow. |
| **Comparability** | Raster artifacts are keyed by renderer identity. Two incompatible identities are reported as `incomparable`, never `different`. |

This is a strong fit when source attribution, deterministic evidence, and
control of the pipeline matter more than a managed review experience.

Choose an established hosted product instead when you need a hosted dashboard,
retroactive review controls, a managed cross-browser or real-device grid, a
perceptual/ML differ, or an afternoon-from-`npm install` adoption path. The full
decision is in [`docs/gates.md`](docs/gates.md), and
[`docs/comparison.md`](docs/comparison.md) names what Percy, Chromatic, Argos,
and Applitools each do better.

## Choose the shortest path into your suite

Start with the place where your UI already reaches a deterministic, ready
state. Do not rebuild that environment inside Variance Authority.

| Your UI is already ready in | Integration recipe | First complete loop |
| --- | --- | --- |
| A Playwright test | [`@variance-authority/playwright-test`: add an observation](packages/playwright-test/README.md#add-an-observation-to-a-test) | Run → review the `new` candidate → run with `--update-snapshots` → rerun unchanged. |
| A built or served Storybook | [`@variance-authority/storybook-collector`: integrate a Storybook](packages/storybook-collector/README.md#integrate-a-storybook) | `variance doctor` → `variance run` → accept named stories → rerun unchanged. |
| A running application or static build | [`@variance-authority/route-collector`: integrate a route list](packages/route-collector/README.md#integrate-an-explicit-route-list) | Start the app → `variance doctor` → `variance run` → accept named routes → rerun unchanged. |
| A custom renderer, store, or pipeline | [`@variance-authority/observe`: choose the entrypoint](packages/observe/README.md#choose-the-entrypoint) | Call `observePair`, `observeAgainstBaseline`, or `observeRasters`, then handle every returned verdict explicitly. |

If more than one row fits, prefer the highest one: reuse an existing Playwright
test before adding a second navigation harness; otherwise reuse Storybook before
navigating every route independently. Choose routes when the served application
is the artifact that matters.

These are the current package boundaries, not hypothetical presets.
`@variance-authority/playwright-test` is a one-package integration. Storybook
and route adoption require the shared CLI plus one collector package;
the collector owns how the UI becomes ready, while the CLI owns baselines,
reports, acceptance, and CI exit codes.

## Licence

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Mechanic Garden.
