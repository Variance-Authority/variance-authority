---
'@variance-authority/core': minor
'@variance-authority/png': minor
'@variance-authority/observe': minor
---

A region says whether its shape changed or only its colour

A changed region now says whether its drawing changed or only its colour. `DiffRegion` gains `change: 'shape' | 'colour'`, `@variance-authority/png` exports `regionChange`, which reads it from the compared pixels, and the verdict counts the regions apart: `120 pixels differ across 2 regions, 1 changed in shape and 1 only in colour`. A recoloured button reads as colour; a block that moved by a pixel, grew or gained rows reads as shape.
