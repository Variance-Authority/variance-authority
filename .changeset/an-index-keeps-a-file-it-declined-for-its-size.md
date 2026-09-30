---
"@variance-authority/sense": patch
"@variance-authority/cli": patch
---

`variance index` keeps a file it declined for its size until the file changes

A file over the size the scan opens (`largestFile`, one megabyte by default) is recorded with its reason and no edges. That record now names the bytes it declined, by Git's object name, so an update over an unchanged checkout keeps it instead of opening the file to decline it again. On Material UI, `packages/mui-icons-material/lib/index.js` is 2.4 MB, and every update of an unchanged checkout reported `1 read again`; it now reports `0 read again`. A file that could not be read is still tried again on the next update. A scan that passes its own `largestFile` counts that limit as part of its configuration, so raising the limit reads the declined files.
