---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/package': patch
'@variance-authority/sense': patch
---

A default export is answered by a name, never by `default`. `export default function Badge` is `Badge`. An anonymous `export default function ()` takes the local name of the import nearest its file, so `import shout from './anon.js'` makes it `shout`, with every importer's own spelling listed beside its site, and every local name an import gives it answers it; when nothing imports it, the nearest export that passes it on under a name, `export { default as Thing }`, names it. A local name of a default says the declaration it imports, `imports shout (its default) as far`, and an export passing a default on says the name it passes on. Asked for `default`, `ask symbol` and `ask uses` answer only the default exports nothing names, never one passed on from a named default, and no longer list a default export's declaration as declared but not exported. The source index binds an anonymous default to its declaration, so its kind and signature are read like any other's; the index moves to version 39 and an older one is read again. Every export the package stage reads now carries `bound`, the name it binds in its own file (`default` for an anonymous default, none for `export … from`), so a declaration is keyed without reading the source index again; the help snapshot moves to version 10 and an older one is read again. The skill's workspace reference says how a declaration, and a default, is named.
