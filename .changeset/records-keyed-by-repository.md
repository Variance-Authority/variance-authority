---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A recording made from a package is found from the repository root

The coverage snapshot, the module-name table and every record store are now kept
under the repository the directory you pass sits in, not under that directory
itself. The recorders already wrote there. The readers — `variance select`,
`variance covering`, the recording position `variance run` reports, and
`testCoverageFile(root)` itself — used
the directory they were given, so a suite recorded from a package-level config
read as unrecorded from anywhere but that package, and a run from the package
could not find a recording made from the root. `repositoryLayers(root)`, exported
from `@variance-authority/sense/test-selection`, returns the directories a record
of that repository lives in. The source index is still kept per scan root.
