---
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

`uses` lists every import of a published name, inside its own package and through `import x = require()`

`variance ask uses` answered a published name only from the imports that cross
a package. An import within the publishing package, such as
`import { a, b } from './execution.js'`, was not listed, and a name only its
own package imports read as "nothing in this workspace imports it". The
imports within the package are now read from the source index, as they already
were for a name no entry publishes: every import of the file that declares the
name. An `export { name } from` passes the name on and is not a use; the file
that writes it is followed under the name it exports, so an import through a
barrel is listed and the barrel is not. A same-named export of another file is
not counted. When no source index is published, the answer says that no other
package imports the name and that the imports within its own package were not
read. `symbol` says that the number it gives counts the imports from other
packages.

TypeScript's `import x = require('m')` holds the module whole, like
`import * as x`. The module reader now records `x.name` and `x['name']` after
it as reads of `name` through that request. `uses` lists each one marked
`(namespace, line N)`, and `symbol` counts the package. A type-only
`import type x = require()` holds nothing. The source index format moves to
version 19, so the first `variance index` after upgrading reads every file
again.
