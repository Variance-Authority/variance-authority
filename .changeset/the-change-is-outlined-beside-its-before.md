---
'@variance-authority/png': minor
'@variance-authority/report': patch
'@variance-authority/cli': patch
---

The change image shows before beside after, the change outlined on both

The change image stacked before, after and a red pixel difference one under
the next, so a reviewer had to find a reflowed paragraph by comparing panels a
screen apart, and the red covered every line the paragraph pushed down.
`changeImages` now lays each window out as its before beside its after, row for
row through the alignment, with striped filler opposite rows only one side has.
The windows, their context and the before panel read through the alignment are
as they were. What changed is outlined on both panels, red on the before and
green on the after, with a white ring either side so the line reads on a dark
page and on a light one. Rows that only moved are not outlined: a blue bar with
chevrons in the gutter between the panels runs beside them. A blank gap that
grew or shrank by more than a row gets a window while the changes leave one
free, and a blue line across the gutter instead of an outline; one that changed by a single
row is rounding and is left out.

`AlignedRows`, exported from `@variance-authority/png/mask`, carries two more
required spans for this: `grown`, the inserted rows that only repeat a run of
identical rows that got taller, and `shrunk`, the removed rows such a run lost.
Code that builds an `AlignedRows` itself has to supply both.
