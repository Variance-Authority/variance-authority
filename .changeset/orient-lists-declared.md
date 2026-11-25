---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`ask orient --files` lists what a file declares, however many names it binds first. A name a file only binds, such as `const { A } = require('./a')` or `const a = require('./a')`, took one of the 40 rows, so a file that opens with more than 40 of them showed none of its functions and classes. Such a name now takes no row unless the file exports it, and one line counts the names bound and not declared. A file that only binds names says that it declares nothing at the top level, with that count. `FileDeclarations` carries the count as `bound`, and `exportsKept` says whether the index kept the file's exports. `ask classify --query <path>` reads the same outline, so it lists more of the functions of a file that binds many names.
