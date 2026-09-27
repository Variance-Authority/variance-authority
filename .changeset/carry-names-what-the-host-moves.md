---
'@variance-authority/cli': minor
---

`variance carry restore` and `variance carry save` print what a CI host moves between jobs: the path, the cache key and the restore keys of every artifact whose `carry` is `actions-cache`, plus the report, images and review directory to upload. `--format github` writes them as step outputs, so a workflow passes them to `actions/cache` and names no path the config already names. Only a push to a mainline saves a recording. On any other run, and when no mainline can be found, `carry save` prints no key for it and says why.
