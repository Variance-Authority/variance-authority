---
'@variance-authority/cli': patch
---

`variance share --publish` publishes a suite's record only under the commit the record names, because its regions are line numbers in that commit's text. A record made at another commit, one that names no commit, and one that does not read are left out, and the publish names each with the reason: `left out suite-v1/unit: its record at <path> was recorded at <commit>, not at <commit>.` The rest of the run is still published.
