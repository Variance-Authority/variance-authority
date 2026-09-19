# README example

This directory is the executable source of the comparison at the top of the
[repository README](../../README.md), at the smallest scale that still carries
an answer. One `Button` keeps the same text, role, size, props and DOM structure
while its `background-color` changes, and the report names the component and the
line the change was written at.

## What it produces

Running it regenerates the five files in [`artifacts/`](artifacts), all of which
are committed:

| before.png | after.png | diff.png |
| --- | --- | --- |
| ![A blue Variance button.](artifacts/before.png) | ![The same Variance button in purple.](artifacts/after.png) | ![The generated image diff, the repainted button highlighted in red.](artifacts/diff.png) |

[`artifacts/report.txt`](artifacts/report.txt):

```text
1 root(s): 0 authorized, 1 to review, 0 violation(s).
  [needs-review] Button — Button
      undeclared component change: `Button` (token/paint) reached 1 subject(s)
      examples/readme-case/src/Button.js:9
```

A **subject** is one named UI state you asked for and can ask for again — here,
the single button mounted in [`page/harness.html`](page/harness.html) under the
id `component/button`. The `file:line` is not searched for after the fact: it is
the source position of the component that drew the changed pixels.

[`artifacts/provenance.json`](artifacts/provenance.json) records the engine that
painted the two PNGs and the one semantic delta between them:

```json
{
  "generatedBy": "examples/readme-case/scripts/generate.mjs",
  "engine": "chromium@151.0.7922.34",
  "change": {
    "kind": "style-changed",
    "property": "background-color",
    "from": "rgb(31 111 235 / 1)",
    "to": "rgb(130 80 223 / 1)",
    "impact": "paint"
  },
  "changedPixels": 9226
}
```

## Run it

You need a checkout, `yarn install`, `yarn build` (the example imports the
workspace packages from their build output), and a Chromium binary from
`npx playwright install chromium`.

From the repository root:

```bash
yarn workspace @variance-authority/example-readme-case generate
```

It prints the report and rewrites the five files in `artifacts/`. The package is
private and is not published; `generate` is its only script.

The Vitest file re-runs the same comparison and checks the artifacts against it —
that the semantic comparison holds exactly one paint-only `style-changed` delta,
that `diff.png` is the diff actually derived from `before.png` and `after.png`,
and that the committed report and images are the ones the repository README
displays. From the repository root:

```bash
yarn vitest run examples/readme-case/src/readme.chromium.test.ts
```

It skips itself, with a note, when no Chromium binary is installed.

## The files

| Path | What it is |
| --- | --- |
| [`src/Button.js`](src/Button.js) | The one component. Line 9 is the line the report names. |
| [`src/page-agent.js`](src/page-agent.js) | The bundle that runs in the page and mounts each variant. |
| [`page/harness.html`](page/harness.html) | The page the button is mounted into. |
| [`scripts/run-case.mjs`](scripts/run-case.mjs) | The comparison itself: capture, normalize, diff, adjudicate. |
| [`scripts/generate.mjs`](scripts/generate.mjs) | Writes the result to `artifacts/`. |
| [`src/readme.chromium.test.ts`](src/readme.chromium.test.ts) | The Vitest file above. |

## Scope

One Button, one mutation, one engine. It shows the reporting shape and the
relationship between the artifacts; it is not a measurement of attribution
accuracy across an arbitrary application.
