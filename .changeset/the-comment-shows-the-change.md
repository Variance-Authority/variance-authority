---
'@variance-authority/png': minor
'@variance-authority/report': minor
'@variance-authority/cli': minor
---

The pull-request comment shows each change at full size

The comment showed a changed subject as its whole before and after images side
by side at half the comment's width, so on a long page the change was a few
pixels tall. `changeImages` in `@variance-authority/png` cuts a window around
each changed region and each removed span, with 32 rows and 48 columns of
context and at least 320 pixels wide, and lays the three heaviest windows out as
before, after and the difference, one window under the next. The before panel is
read through the row alignment, so it shows what the after rows replaced,
removed rows included.

`variance run` writes it beside the before, after and diff images as
`<subject>.change.png` and names it in the report as `images.change`. The comment
embeds that one picture at its own size when the report names it, and the whole
before and after pair otherwise; the image refs carry the same picture, and the
comment's text does not grow.
