---
'@variance-authority/cli': patch
'@variance-authority/core': patch
'@variance-authority/observe': patch
'@variance-authority/raster': patch
---

A subject holding a canvas or video is photographed in place

A canvas or video keeps its bitmap outside the markup the document digest
covers, so a digest match could report `unchanged` for a changed drawing.
Such a subject now renders on every run: it neither settles on a digest hit nor
reads or writes the render cache, and the reason names the box.
