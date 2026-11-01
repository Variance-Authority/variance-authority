---
'@variance-authority/png': patch
---

Every pixel comparison is cheaper: fully transparent pixels are found with a loop rather than a callback per pixel, which was most of the cost of comparing two equal images. At 1920×1080 an unchanged pair takes about half as long under either decoder, and a changed pair about a third less.
