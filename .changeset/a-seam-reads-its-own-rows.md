---
'@variance-authority/png': patch
---

Where two paired runs of rows meet, a before pixel's anti-aliasing is read from the rows around the one it came from, not from the rows the pairing set beside it, so an edge on the seam is no longer marked as changed. Near the page's top and bottom edge, those rows run to the before image's own edge, not the after image's.
