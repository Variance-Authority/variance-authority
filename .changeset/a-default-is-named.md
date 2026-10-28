---
'@variance-authority/help': patch
---

A default export is answered by a name, never by `default`. `export default function Badge` is `Badge`. An anonymous `export default function ()` takes the local name of the import nearest its file, so `import shout from './anon.js'` makes it `shout`, with every importer's own spelling listed beside its site. Asked for `default`, `ask symbol` and `ask uses` answer only the default exports nothing names, and no longer list a default export's declaration as declared but not exported.
