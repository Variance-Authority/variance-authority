---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`uses` and `discover --imports` list a name read off a module that CommonJS code loads with `require`. `const { A } = require('./a')`, renamed or not, `require('./a').A`, and `const a = require('./a')` with `a.A` read after it were no use of `A`, at the top level or in a function, so `uses` said that nothing imports a name whose only readers are such files. Each is now listed on the line that reads the name, as a read off an awaited `import()` is. A `typeof import()` cast written on a `require` no longer decides which module it reads: the `require` does. A `require` whose module goes on whole, held or in place, as in `module.exports = require('./a')`, is listed as passing the module on whole. A `require` of a computed specifier, and another object's `require`, still record no name.

`variance index` rebuilds the source index once: its format version is 52, in which a request made with `require` carries the names read off it.
