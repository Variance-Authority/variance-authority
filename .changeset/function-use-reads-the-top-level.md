---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`function-use` reads a top-level change as `region-use` does

The `function-use` precision is documented as it selects: the top level is read as at `region-use` and each charged region is widened to its function, so a changed top-level value runs every test that entered a function reading it, and only a change that runs as the module loads runs every test that loaded the file.
