---
'@variance-authority/sense': minor
---

An update of the source index over a checkout that a running Watchman already watches runs no git when Watchman reports no change since the last update but to paths git ignores, and none of git's own files changed. It reads the listing the last update kept beside the index instead: 22–39 ms against 157–195 ms on Material UI's 41,171 paths. Anything else lists with git as before. Nothing starts a Watchman server or adds a watch.
