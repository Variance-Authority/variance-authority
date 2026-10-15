---
'@variance-authority/png': minor
'@variance-authority/report': patch
'@variance-authority/cli': patch
---

The change image shows before beside after, labelled, the change marked on both

The change image stacked before, after and a red pixel difference one under
the next, so a reviewer had to find a reflowed paragraph by comparing panels a
screen apart, and the red covered every line the paragraph pushed down.
`changeImages` now lays each window out as its before beside its after, row for
row through the alignment, with striped filler opposite rows only one side has.

The sheet reads as one picture. Every window is cut as wide as the widest,
framed, on a neutral canvas with a margin around and between the windows. A
window's top and bottom move out of any line of text they would cut. Each column
is labelled, `Before` in red and `After` in green, and a new optional `labels`
argument sets the subject over both and where each side came from beside its
label; the CLI passes the subject's id, `baseline` and `this run`. The text is
Inter, drawn from glyphs the package ships, under the SIL Open Font License 1.1
in `glyphs/inter-LICENSE.txt`.

What changed is washed in red on the before and green on the after, with an
edge of the same colour just outside it, widened to the space either side of
the words it starts and ends in, so it covers no neighbouring letter. Rows that
only moved are not marked on the panels: a blue arrow in the gutter runs beside
them, its head the way they went. A blank gap that grew or shrank by more than a
row gets a window while the changes leave one free, and a blue line across the
gutter instead of a mark; one that changed by a single row is rounding and is
left out.

`AlignedRows`, exported from `@variance-authority/png/mask`, carries two more
required spans for this: `grown`, the inserted rows that only repeat a run of
identical rows that got taller, and `shrunk`, the removed rows such a run lost.
Code that builds an `AlignedRows` itself has to supply both.
