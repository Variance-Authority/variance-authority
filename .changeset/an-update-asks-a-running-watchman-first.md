---
'@variance-authority/sense': minor
---

An update of the source index over a checkout that a running Watchman already watches reads the listing the last update kept beside the index, and runs no git, when Watchman reports no change since that update and none of git's own files changed: 22 ms against 121 ms on Material UI's 41,171 paths. When all Watchman reports are paths git ignores, the update asks git only `check-ignore`. Anything else lists with git as before, 5–29 ms slower under a watch than without one. Under a watch, an update with nothing to publish still rewrites its working segment, to carry the listing. Nothing starts a Watchman server or adds a watch.
