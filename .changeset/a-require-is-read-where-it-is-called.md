---
"@variance-authority/sense": patch
---

A module's `require` requests are read from the code. A
`require('...')` written in a comment, a string or a template's text is no
longer a request, so a comment such as `// require('...')` no longer adds a
third-party package named `...`. `require.resolve` is still not a request.
`` require(`./plain`) `` is read like `require('./plain')`, and
`import x = require('y')` is read as a request for `y`. A declaration
package's `export =` is read from the code as well, so an
`export = name` inside a comment publishes nothing.

The source index format moves to version 17, so an index written before this
release is rebuilt once instead of keeping the requests it read from comments.
