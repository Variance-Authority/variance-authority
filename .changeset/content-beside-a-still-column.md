---
'@variance-authority/raster': minor
'@variance-authority/png': minor
'@variance-authority/core': patch
'@variance-authority/observe': patch
---

Content that moves beside a column that stays put, such as a page that grew under a fixed sidebar, is aligned in vertical strips. Each strip that moved is paired on its own, and every span of the alignment carries `columns`, the strip it covers. A page under a fixed sidebar no longer marks everything below the edit as changed. The reason counts the rows a column gained rather than adding up every strip's rows. Rows inserted in one strip join a region only when the region lies inside that strip.
