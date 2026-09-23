# @variance-authority/vitest-browser

## 0.6.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.10

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.9

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.8

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.7

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

### Minor Changes

- 740f2af: The tab reads, and the run judges

  A Vitest browser-mode test has already done the expensive half of a visual
  observation. It mounted the component in a real engine with the real
  stylesheets, and the locator it awaited is the evidence the thing arrived. What
  it cannot do is judge: the baseline is on a disk the tab cannot reach, and
  painting a document is a browser the tab cannot launch.

  `@variance-authority/vitest-browser` is those two halves either side of Vitest's
  command protocol. In the tab, `variance(subject)` settles the subject's Suspense
  boundaries, holds animation still, and reads the mount once — markup, applicable
  CSS, component provenance, framework wiring, and the bytes of every resource it
  references, fetched with the page's own `fetch`. In the Vitest process,
  `variancePlugin()` registers the command, holds one renderer and one store open
  for the run, paints the captured document, and answers with the verdict and the
  sentence a failing assertion prints.

  The document is painted rather than screenshotted, with the tab's own browser
  sitting right there. A live screenshot carries no render identity — nothing that
  can say which machine, which scale, which font stack — so a baseline made from
  one is reproducible on no other machine, starting with the CI runner that judges
  it next.

  Media queries resolve against the tester iframe rather than the browser tab,
  because that is the frame the subject was laid out in.

  `@variance-authority/unit-test` publishes `capture` on its own entrypoint,
  `@variance-authority/unit-test/capture`, carrying nothing that touches a
  filesystem. Resource bytes are encoded without `Buffer`, which the subject's own
  realm does not always have; in a browser tab the previous spelling threw while
  closing the first resource a fixture referenced, and arrived as a capture that
  could not see images rather than as a missing global.
