# Review a visual change

A screenshot suite tells you that pixels moved; this path gets you to which
component moved them, whether anyone meant it, and a build that gates on the
answer. Start from the harness you already use, keep the comparisons steady,
read a change down to its `file:line`, explain what that line cannot, and then
decide what the build blocks on.

[Variance Authority](README.md) runs each step on your own build machine,
against baselines in your own repository. This page orders the steps and links
the page that owns each one.

## 1. Connect the harness that already reaches the state

Whichever tool already puts the app in the state you want to review — a
Playwright spec, a built Storybook, a served route, a jsdom unit test, Vitest
browser mode or Rstest — has a guide that ends the same way: that state gets a
baseline you approved, and a later run that moves pixels reports what drew
them. Adopt one harness at a time, and keep the `toHaveScreenshot` assertions
that already work.

[Choose your integration](start.md)

## 2. Keep the comparisons steady

A change your code did not make costs the same review as one it did. The run
holds the page still before it reads it, and when a subject still moves it
varies one condition at a time to say whether time, the environment, the
component or leaked state moved it — evidence, never a retry.

[Holding a page still](stabilization.md), then
[Trace instability to its owner](flakiness.md).

## 3. Read a change down to the line that drew it

A pixel count cannot be assigned to anybody. Attribution turns it into a
region, the component that rendered it, its place in the page, and the source
line it was written at, so a reviewer opens the file instead of the image.

[From a pixel to a line](attribution.md)

## 4. Explain what the line does not

The run keeps each state's text, accessibility tree, layout, styles and pixels
apart, and each is one reading of it. Sometimes the component is known and the
reason is not: an input changed, the layout moved while the pixels did not, or
the region was never the subject. One table says which reading answers each.

[Explain variance](explain-variance.md)

## 5. Decide what the build gates on

With changes explained and noise owned, the build can block on what changed
and hand the rest to whoever owns it.

[Gate a build on what changed](gates.md) and
[Add Variance Authority to what you already use](replacing.md).
