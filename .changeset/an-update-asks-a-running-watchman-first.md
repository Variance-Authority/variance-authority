---
'@variance-authority/sense': minor
---

An update of the source index over a checkout that a running Watchman already watches runs no git when Watchman reports no change since the last update but to paths git ignores, and none of git's own files changed. It reads the listing the last update kept beside the index instead: 13 ms against 140 ms on a 3,768-file checkout. Anything else lists with git as before. Nothing starts a Watchman server or adds a watch.
