---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`uses` and `discover --imports` list a name read off a module that CommonJS code loads with `require`. `const { A } = require('./a')`, renamed or not, `require('./a').A`, and `const a = require('./a')` with `a.A` read after it were no use of `A`, at the top level or in a function, so `uses` said that nothing imports a name whose only readers are such files. Each is now listed on the line that reads the name. A `require` of a computed specifier, and a function called `require` that is not the module system's, still record no name.

`variance index` rebuilds the source index once: its format version is 52, in which a request made with `require` carries the names read off it.
