---
'@variance-authority/sense': patch
---

A workspace library loaded from its build is recorded as its source

The probes asked `include` about the module id before they followed the map
back to the file it was built from. The default include refuses `dist`, so a
library an application imported through its `tsc` build got no probes, and a
change to its source selected nothing that ran it. Now a module `include`
refuses is asked again under the source its map leads to, when the map names
exactly one source outside `node_modules`, and it is instrumented and recorded
under that source. `testSelectionProbes` decides this way on a Vite dev server,
and so do the Vitest, Jest and Rstest seams. A bundle whose map names several
sources, a build with no map back, and a dependency are left out as before.
`vite build` hands the plugin no map back to the source, so a production build
still leaves the library out.
