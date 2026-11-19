---
'@variance-authority/png': patch
'@variance-authority/observe': patch
'@variance-authority/cli': patch
---

A run that writes the diff images draws them from the pixels the comparison decoded and the rows it paired, instead of decoding both images and aligning their rows a second time.
