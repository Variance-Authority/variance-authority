---
'@variance-authority/png': minor
'@variance-authority/report': minor
'@variance-authority/cli': minor
'@variance-authority/raster': minor
'@variance-authority/observe': patch
---

A faint region is drawn apart from a strong one. The diff image paints a changed
pixel short of `STRONG_GRADE` pale red rather than red, the HTML report draws a
faint region's box dashed and lighter, and the run's JSON carries each region's `grade`.
`raster` exports `isFaint(grade)`, the one test of faint that the picture, the
report and the verdict sentence share.
