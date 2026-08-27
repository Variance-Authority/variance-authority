---
'@variance-authority/cli': patch
---

Stop labelling a changed region with the path of the node that contains it.

A page this project did not write in React carries no component names, and both
docket renderers fell back to the containing node's path. A pull-request comment
led with **`0/1`** in code voice, and a failing Playwright assertion printed
`1510px — 0` three times, the three rows separated only by their pixel counts.
Where no component and no landmark phrase exist, both now print the region's
geometry, which at least finds the rect in the diff image. Collateral counts only
regions that have a component, so a page with none no longer reports "in 1
component(s)".
