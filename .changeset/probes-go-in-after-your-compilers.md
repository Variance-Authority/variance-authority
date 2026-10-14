---
'@variance-authority/sense': minor
---

A build-time compiler reads your code, not the probes

`testSelectionProbes` ran at `enforce: 'pre'` and handed every later plugin
probed text, so a compiler that reads the syntax it compiles saw a probe where
your code was: Compiled could not extract the styles of a `styled` call that
takes a function, and silently turned a dynamic prop into a runtime CSS
variable, so the recorded build was not the build you ship. The plugin now runs
at `enforce: 'post'`, after every transform of yours. Each module is still cut
from the file on disk — named after it, digested as its text, placed on its
lines — and the probes are written into the transformed text where the
transforms' combined map carries each region. Code a compiler wrote that the
map carries to no region gets no probe.

A file the transforms rewrote with no map back to it, or a region the map
carries to no code, stops the build with an error naming the file and the
region. Ids, digests and regions are unchanged, so existing recordings still
join. The Vitest, Jest and Rstest seams still probe the file first.
