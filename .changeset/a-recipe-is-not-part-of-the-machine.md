---
'@variance-authority/playwright': minor
---

The rasterization key stops reading the recipe

`RenderIdentity` carries two digests over a render's inputs, and they overlapped.
`stabilization` names the recipe by which tricks are present, so a trick that
changes how it reaches the page is the same recipe and keeps the same digest.
`rasterization` was digesting `{ type: 'png', ...recipeScreenshot(recipe) }`,
which put the recipe's spelling into a second key that has no opinion about
recipes — and the two then disagreed about whether anything had changed.

0.2.0 is what that costs. `hideCaret` moved from `screenshot: { caret: 'hide' }`
to a `caret-color` stylesheet, because the driver's caret switch writes `style`
back onto every focusable element and the in-place path reads the DOM on both
sides of a screenshot. Same trick, same id, and the images come out
byte-identical — verified against a stored baseline from 0.1.1. Every baseline
went `incomparable` anyway, over a key that moved for a reason no pixel could
have shown.

`rasterization` now covers what the machine decides and no recipe asked for:
which engine, launched headless or not, with which ordered launch arguments,
photographed into which format. The recipe's contribution reaches the image
through `screenshot` exactly as before and reaches the identity through
`stabilization`, once.

The key therefore moves once more, and stored baselines are `incomparable`
against this version — `accept` them and it stops happening. A run that reports
`incomparable` is reporting correctly: an identity it cannot compare has never
been a diff, and the verdict machinery behaved throughout. What was wrong was
the key.
