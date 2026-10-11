---
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

`uses` lists every import of a published name, inside its own package, through a barrel and through `import x = require()`

`variance ask uses` answered a published name only from the imports that cross
a package. An import within the publishing package, such as
`import { a, b } from './execution.js'`, was not listed, and a name only its
own package imports read as "nothing in this workspace imports it". The
imports within the package are now read from the source index, as they already
were for a name no entry publishes: every import of the file that declares the
name.

An `export … from` passes the name on and is not a use. The file that writes it
is followed under the name it exports, so an import through a barrel is listed
and the barrel is not, in another package as well as in its own. This includes a bare `export *`, which passes on every
name but `default`. An import of a renamed re-export ends `(as <name>)`, and a name an entry
publishes under another name than its declaration is read from that entry. A
type-only re-export, `export { type name } from`, passes nothing on and is
listed as a type use where it is written. A read through an `export * as`
namespace, and a call through a qualified path, are not counted, and every
answer that read the source index ends by saying so. A same-named export of
another file is not counted. With `--package` naming one subpath specifier, an
import through another specifier of the same package is left to that one.

When the source index is missing, or does not read, `uses` for a published name
still lists the imports from other packages and says why the rest were not
read; it no longer fails. `symbol` names both halves of what `uses` lists. For a
name a file exports and no entry publishes, `symbol` counts an import through a
barrel once, under the file that declares it, and no longer shows the barrel as
a second export.

TypeScript's `import x = require('m')` holds the module whole, like
`import * as x`. The module reader now records `x.name` and `x['name']` after
it as reads of `name` through that request. `uses` lists each one marked
`(namespace, line N)`, and `symbol` counts the package. A type-only
`import type x = require()` holds nothing. The source index format moves to
version 19, so the first `variance index` after upgrading reads every file
again.

`@variance-authority/sense`'s `importersOf` returns `{ uses, through }`: each
use carries the name it takes, and `through` names the files that pass the
name on.
