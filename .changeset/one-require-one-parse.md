---
"@variance-authority/sense": patch
---

Selection reads `module.require('x')` as the load it is. A file that calls
`module.require` is now a file with a load no name traces, as a bare
`require` already was, so when a module it imports changes, its tests are
selected instead of passed over for reading none of the changed names.
Another object's `require` method is still not a load. The module reader and
the readers of a changed value now ask one definition of what a require is.

The dependency lexicon parses a declaration file that publishes no names once,
not twice: the `export =` reading asks the tree the module record was read
from.
