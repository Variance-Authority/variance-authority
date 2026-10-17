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
package it is installed from, nearest first and with the module-whole reads
and each `export … from` that passes it on marked, and points to
`docs_symbol` for the declaration. A name both the workspace and an installed
package carry opens by counting each apart: `render` names 1 declaration and
is imported from 1 installed package. Files whose imports were not read, and
declarations or members the source index did not read, are named rather than
passed over.

A Rust item's answer now says that a use from JavaScript through a native
binding imports no Rust name, so it is not listed, and to ask for the name the
binding's JavaScript side declares.
