---
'@variance-authority/cli': minor
---

`variance coverage --format badge` prints the share of regions the text output leads with, every suite together, as a shields.io endpoint: `{"schemaVersion":1,"label":"regions run","message":"90.3%","color":"blue"}`. With no region counted it prints nothing and exits `2` with the reason. The review action's new `badge` input publishes that file on a push to the default branch, as the one file of a parentless commit at `refs/badge/<branch>`, for a public repository's README badge; the job needs `contents: write`.
