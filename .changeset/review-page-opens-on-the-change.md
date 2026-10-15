---
'@variance-authority/cli': patch
---

The review page opens on the change at its own size

A full-page capture is tens of thousands of pixels tall, and the review page
scaled it to fit its frame, so a sentence of the page was a grey line and a
long page was a strip a few pixels wide. The page now opens each subject on the
crops the run cut around its largest regions — before, after and the
difference, one image pixel per screen pixel — under a new first mode,
`change`, and falls back to `regions` when the run cut none. The other modes
show the pages at full width in a frame that scrolls, the wipe handle runs the
page's full height, clicking a region's row in the table — or pressing Enter on
it — scrolls to its box and marks it, and the number keys reach every mode.
Clicking a region's row no longer hides every subject: the cause filter
listens to its own buttons only.
