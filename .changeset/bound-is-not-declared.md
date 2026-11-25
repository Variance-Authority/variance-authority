---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

A name a file only binds is no longer reported as declared there. `symbol` and `uses` said "declared, not exported" of a name a file destructures out of a value, such as `const { A } = require('./a')`, and of one set to a whole module, `const a = require('./a')`. They now say "bound, not declared", after the files that declare the name and without counting among them, and when no file declares the name the answer says so and lists the files that bind it. `classify` names no such file as the one that declares it, whether or not the file exports the name. `symbol` and `uses` answer an exported name as exported, as before; one set to a whole required module has kind `binding`, where it had `const`.

`variance index` rebuilds the source index once: its format version is 51, in which a top-level name set to a `require` of a constant specifier has kind `binding`.
