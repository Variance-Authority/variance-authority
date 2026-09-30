---
"@variance-authority/sense": patch
---

`variance index` keeps a file it declined until the file changes

A file the scan declines by its bytes — over the size it opens (`largestFile`, one megabyte by default), or a module that is not UTF-8 — is recorded with its reason and no edges. That record names the bytes it declined, by Git's object name, so an update over an unchanged checkout keeps it and reports `0 read again`, without opening the file to decline it again. On Material UI that file is `packages/mui-icons-material/lib/index.js`, at 2.4 MB. A decline for size holds only while the checked-out file is still over the limit, because under `core.autocrlf` or LFS Git's object is other bytes than the file. A file that could not be opened or read is tried again on the next update, and so is a declined file Git names no bytes for: one reached through a symbolic link, an ignored file, or any file outside a Git checkout. A scan that passes its own `largestFile` counts that limit as part of its configuration, so raising the limit reads the declined files.
