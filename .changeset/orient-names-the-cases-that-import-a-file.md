---
"@variance-authority/help": minor
"@variance-authority/sense": minor
---

`variance ask orient --files` names the cases that ran a file by importing it, and gives every share and package flow as counts

The recording credits no case with code that ran while a module was evaluated. For such a file, `orient --files` finds the recorded test files that import it, over the source index, and counts their cases: `5 cases ran it, 3 of them by importing it`. When the source index names no importers, the line says so. In the packages part, every share has its count beside it, and a share over fewer than 10 uses is printed as the count alone, for example `3 of 7`. The package flows of the recorded cases are headed `Observed:` and count the packages each case ran code in together, as combinations and not as calls from one package to another. A `variance ask search` answer that lists exported names ends with the `variance ask orient --files` question for the first file it names. `orientAround` in `@variance-authority/sense` reads the packages and the external dependencies around a set of files in one pass.
