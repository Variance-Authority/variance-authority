---
'@variance-authority/sense': patch
---

A test that loaded a build of a types-only module stays recorded whole after a run that did not load it

For a module that declares only types, `tsc` writes `export {};` and a source
map with no positions in it. Variance Authority records that build under its own
path. A Vite dev server hands the build to the plugin with its
`sourceMappingURL` comment blanked, and the record took its digest from that
blanked text, which matches no file on disk. A later run that did not load the
build checked the digest against the file on disk and treated the build as
edited. It cut the build again and demoted every test that had loaded it. The
next run of those tests recorded the blanked text again, so the cycle repeated
with every run that skipped them. In this repository, each run after a one-line
edit demoted the 98 test files that load `packages/core/dist/artifact.js`, and
the run after it ran all 98 again.

A module recorded under its own path is now digested and cut from the file on
disk. Blanking the comment moves no offset and no line, so its regions are the
same. Coverage written before this release still holds the old digest. The first
run that lands over it demotes the tests on such a module one last time.
