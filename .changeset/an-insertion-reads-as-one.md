---
'@variance-authority/png': minor
'@variance-authority/raster': minor
'@variance-authority/observe': minor
'@variance-authority/core': minor
'@variance-authority/playwright-test': patch
---

Content inserted into a page is the inserted rows, not everything under them

Two images of the same width are compared row by row after their rows are
aligned: each row is hashed, runs of equal rows are one token, and Myers finds
the shortest edit between the two sequences. Each after row is then compared
with the before row that shows the same content, and `pixelmatch` still judges
every pairing; a row that moved, came or went is a change in itself, so no
pairing makes a page read as unchanged. A section added to a long page marks that
section, and the content it pushed down matches. A pairing is kept only when it
leaves fewer pixels differing than position does, a row it leaves unpaired
charged in full, so a line that changed in place is not shifted against its
neighbours. The rows a gap grew by are inserted, as the rows it lost are
removed, so a button whose padding grew has a region where it grew. Images of
different widths, or an edit longer than 2,000 runs of rows, are compared
position by position on the union box, as before.

An inserted row is marked edge to edge, since nothing says where its content
begins, so a region inside one is joined by its rows rather than its area: to
the tightest box whose rows span it. `attributeRegions` takes the inserted rows
as `inserted`. Joined by area, every such band went to the subject's root, and
a card whose button grew named the card rather than the button.

`RasterComparison.alignment` carries the pairing as `RowAlignment`: the after
rows `inserted`, the before rows `removed` with the after row they left from,
and the rows `shifted` with how far. A comparison without it was not aligned.

Content that moved is a change. A gap that grew in one place and shrank in
another moves what lies between them and leaves the page as tall as it was, and
every moved row matches the row it came from; such a subject reports `changed`,
never `unchanged` or `ignored`. The reason names the edit:
*120 pixels differ across 1 region; 3 pixel rows inserted in 1 place, moving
the content under them by up to 3 rows, and the subject resized from 40×5 to
40×8*. The Playwright fixture's evidence now writes a diff for a subject that
resized, drawn on the after image.
