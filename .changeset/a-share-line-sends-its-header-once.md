---
"@variance-authority/store": patch
---

A `git` share line does not send `http.extraheader` twice when the environment already hands the same header over as `GIT_CONFIG_*` variables, as a CI step does after checking out with `persist-credentials: false`.
