---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`ask uses` names every declaration of a name and answers one an installed package declares

`variance ask uses --name reachedFrom` answered the published function and,
further down, the interface member of the same name, without saying at the top
that the name is two declarations. A name more than one declaration carries
now opens with one line for each, what it is and where, and each is answered
after.

`variance ask uses --name parseSync`, a function `oxc-parser` declares, said no
file of the workspace declares it, while `ask symbol` answered it from the
installed package. `uses` now lists every import of such a name out of the
package it is installed from, nearest first, each binding with the lines its
file uses it on as an import from the workspace has, the module-whole reads
and each `export … from` that passes it on marked, and points to
`ask symbol` for the declaration. A name both the workspace and an installed
package carry opens by counting each apart: `render` names 1 declaration and
is imported from 1 installed package.

`variance ask uses --name resolve` said nothing of the hundreds of files that
import `resolve` from `node:path`. A built-in module now counts as one more
source the name is imported from, `node:path` or a bare `path` alike: the
answer opens with `imported from node:path, which the runtime declares` and
lists each import, marked as the runtime's. An `export … from` out of an
installed package or a built-in module is listed as the import it is, and
the workspace reading no longer counts it among the workspace's exports, so
`ask symbol --name readFileSync` no longer answers a workspace file's
`export { readFileSync } from 'node:fs'` as an export of that file. Files whose imports were
not read are counted after every answer, including one with no import from
outside, the first three by name, and declarations or members the source index did not read are named
rather than passed over.

A Rust item's answer now says that a use from JavaScript through a native
binding imports no Rust name, so it is not listed, and to ask for the name the
binding's JavaScript side declares.
