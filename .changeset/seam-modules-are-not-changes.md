---
'@variance-authority/sense': patch
---

The modules the Vitest and Rstest seams write are no longer reported as changes

`withTestSelection` writes its setup and case-runner modules under
`.variance-authority/` in the configuration's directory, and they stay there
until the run's journals are folded. Unless your ignore file named that
directory, git listed them as untracked, so everything that asks git what a
change touched listed them too: the record the run itself lands, the source
scan, and `variance review`, whose *What this change might do* counted the tree
as edited. Your change gained a `test-selection-*.mjs` file you never wrote.

The directory now carries its own `.gitignore`, written before the first
module, which names the seam's modules and itself and nothing else, so a file
you keep beside them is what it was to git before the run. It comes off with
the last module, so the directory is left as the run found it. A `.gitignore`
you keep in that directory yourself is never written over, and it decides
alone, so it has to name `test-selection-*` if it does not already ignore
everything. Your own ignore line for `.variance-authority/` is no longer needed
for the modules.
