---
'@variance-authority/core': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
'@variance-authority/report': patch
---

A source index another release wrote is no longer reported as damaged

After an upgrade, the first command that read the source index said it was
damaged and read only up to its first bad segment, and in CI it refused with
the same words. The segments were whole: an earlier release had written them in
another format version. Now the reader names both versions, for example that
the index was written in format version 15 and this release reads version 18.
On a workstation it rebuilds the index and says so, and `variance index` prints
`source index rebuilt over one written in format version 15`. In CI the refusal
names both versions and asks you to run `variance index` with this release
before the command that reads it. `ask orient --files` over such an index says
which version wrote it and that `variance index` rebuilds it.
