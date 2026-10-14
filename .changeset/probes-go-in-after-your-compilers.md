---
'@variance-authority/sense': minor
---

A build-time compiler reads your code, not the probes

Every seam probed a module before your own transforms ran, so a compiler that
reads the syntax it compiles saw a probe where your code was: Compiled could not
extract the styles of a `styled` call that takes a function, and silently turned
a dynamic prop into a runtime CSS variable, so the recorded build was not the
build you ship. `testSelectionProbes` and the Vitest, Jest and Rstest seams now
place the probes after every transform of yours: in Vite at `enforce: 'post'`,
in Jest around the transformer you configured, in Rstest with a second loader at
`enforce: 'post'`. Each module is still cut from the file on disk — named after
it, digested as its text, placed on its lines — and the probes are written into
the transformed text where the transforms' combined map carries each region.

A file the transforms rewrote with no map back to it, or a region the map
carries to no code, stops the run with an error naming the file and the region.
A region whose own code the map names no origin for is recorded with the code in
front of it, so it can be reported present when it did not run, never missing
when it did. A file that names its own source map, such as a built package, is
probed before the transforms, as before. Ids, digests and regions are
unchanged, so existing recordings still join. A configuration assembled by hand
for Rstest names the new `@variance-authority/sense/rstest-after-loader` too.
