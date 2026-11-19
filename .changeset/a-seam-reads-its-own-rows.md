---
'@variance-authority/png': patch
---

Where two paired runs of rows meet, a before pixel's anti-aliasing is read from the rows around the one it came from, not from the rows the pairing set beside it, so an edge on the seam is no longer marked as changed.
