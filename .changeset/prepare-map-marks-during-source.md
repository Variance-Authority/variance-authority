---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`variance index --wait` prepares Git's generated and vendored file metadata during a missing-index build, so the code map can use the completed result.

Avoid an occasional scheduling stall that delayed code-map construction until dependency indexing finished.
