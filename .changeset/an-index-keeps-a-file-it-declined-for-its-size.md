---
"@variance-authority/sense": patch
"@variance-authority/cli": patch
---

`variance index` keeps a file it declined until the file changes

A file the scan declines by its bytes — over the size it opens (`largestFile`, one megabyte by default), or a module that is not UTF-8 — is recorded with its reason and no edges. That record names the bytes it declined, by Git's object name, so an update over an unchanged checkout keeps it instead of opening the file to decline it again. On Material UI, `packages/mui-icons-material/lib/index.js` is 2.4 MB, and an update of an unchanged checkout reports `0 read again` where it reported `1 read again`. A file that could not be opened or read is tried again on the next update, and so is a declined file Git has no object name for: an ignored file, or any file outside a Git checkout. A scan that passes its own `largestFile` counts that limit as part of its configuration, so raising the limit reads the declined files.
