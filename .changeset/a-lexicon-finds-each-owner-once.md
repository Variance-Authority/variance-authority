---
'@variance-authority/sense': patch
---

A dependency lexicon refresh finds a file's workspace by walking up to its manifest

A refresh compared each file's directory with every workspace's to find the
one that owns it. On a checkout of 812,428 paths with about 2,000 workspaces
that took 10 s of every refresh. It now walks up to the nearest manifest, once
per directory, as the source index already does, and takes 0.1 s.
