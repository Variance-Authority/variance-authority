---
'@variance-authority/core': minor
'@variance-authority/observe': minor
'@variance-authority/playwright-test': minor
---

A changed region is joined against the baseline's boxes as well as this render's

A change that replaces an element paints over the old element's box and the new
one's, and `attributeRegions` read only one snapshot. On todomvc's broken toggle,
71% of the changed region is inside the checkbox that left and 88.75% inside the
div that arrived. Neither reaches the 0.9 containment, so the region named the
row around both.

`AttributionOptions.before` is now required: the component hashes of the
revision the pixels are compared against, or `undefined`. Each instance root is
joined against the union of its own box and the box the matching instance kept
in `before`. Instances are matched by document order, and only when both sides
count the same number. Every observation passes the before raster's
`components`, so no stored record changes.

A baseline without boxes says so. When a baseline written before component
hashes kept boxes produces a changed verdict with regions, the reason ends
*the baseline records no node boxes, so regions were joined against this
render's boxes alone: accept it again to record them*. Accept such a baseline
once to regenerate it. Two images compared directly get the same clause, naming
the before image, without the remedy.
