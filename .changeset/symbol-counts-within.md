---
"@variance-authority/help": patch
---

`ask symbol` counts the imports of a name inside its own package, so its count agrees with the places `ask uses` lists. The closing line names the total and splits it in two: the imports from other packages, and those inside the package that declares the name, even when a package that re-exports it is the one most imported. The places that may read the name, off the module's `default` or with the module passed on whole, are counted as no import, as `ask uses` counts them, and the header names them once, from the same sites `ask uses` lists, including the ones inside the name's own package. The header's count now says it counts imports by published path only. A name that only its own package imports no longer reads as unused. When the source index does not read, the closing line says so and gives the reason instead of leaving the inside count out.
