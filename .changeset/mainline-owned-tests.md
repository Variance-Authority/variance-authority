---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`select` over a record behind the merge base leaves to the mainline every test only the mainline's commits since the record reach. A test still runs when imports reach it from a file the checkout changed from the merge base or from a package it bumped, and, when the change removes a path, from a file whose imports the scan could not all read. Nothing is left on the mainline's own tip. The answer names how many it left.
