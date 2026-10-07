---
"@variance-authority/sense": patch
"@variance-authority/help": patch
---

A module's `require` and `import()` requests are read from the code. A
`require('...')` or `import('...')` written in a comment, a string or a
template's text is no longer a request, so a comment such as
`// require('...')` no longer adds a third-party package named `...`.
`` require(`./plain`) `` and `` import(`./plain`) `` are read like their
quoted forms, and `import('a' + 'b')` is a load this cannot read rather than a
request for `a' + 'b`. `module.require('x')` is a request for `x`, and another
object's `require` method or `require.resolve` is not. `import x = require('y')`
is read as a request for `y`.

A declaration package's `export =` is read from the code as well, so an
`export = name` inside a comment publishes nothing, and `export=Name` or
`export = Name` without a semicolon publishes its namespace.

The source index format moves to version 17, so an index written before this
release is rebuilt once instead of keeping the requests it read from comments.
The dependency lexicon moves to version 8: an older lexicon still answers
questions, and the next `variance index` rewrites it in full instead of
carrying its entries forward.
