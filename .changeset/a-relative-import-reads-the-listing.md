---
'@variance-authority/sense': patch
---

A relative import is resolved from git's listing, and a failed tsconfig no longer drops imports

A cold index resolves a relative import, such as `./button` or `../util.js`, by looking up its candidates in the listing the walk already holds, in the order the module resolver tries them. The resolver now runs only for what the listing cannot settle: built output, a directory with a `package.json`, or a name git does not list. Files that share a directory and a governing `tsconfig.json` share their answers, so a request is resolved once per directory.

A `tsconfig.json` that failed to load, for example one that extends a package not yet installed, made every relative import in the files it governed resolve to nothing. It now governs nothing, and those imports resolve as if it were absent. On a large monorepo, tens of thousands of imports came back.
