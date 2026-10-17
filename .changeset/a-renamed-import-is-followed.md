---
'@variance-authority/sense': minor
'@variance-authority/package': minor
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

`ask symbol` follows a renamed import in both directions

`import { greet as hail } from './greet.js'` binds `hail` to `greet`, and the
binding the parser read is now what ties the two. `ask symbol --name hail`
answers with that import and then with `greet`: its declaration and import line
when an entry publishes it, the file and line that export it when none does, or
the installed declaration when the specifier names a dependency. Before, it
answered that nothing declares `hail`.

`ask symbol --name greet` names every file and line that imports it as
something else, and `ask uses --name greet` marks each such site `(as hail)`,
the way it already marked an import of a renamed re-export. A use row now
carries the local name, and `@variance-authority/sense` exports `aliasesOf`,
which lists the imports that bind a given local name to another export.
