---
'@variance-authority/sense': patch
'@variance-authority/help': patch
---

`export default name` records `name` as the export's `local`, where it recorded `default`. The exported name already says `default`, and the identifier is what joins the default to the file's own declaration or to the import it republishes, through that request's bindings. A default that is an expression or an anonymous declaration still has no `local`. Stored parses are read again once, because the source index they are kept in moves to a new version.

Help follows `export default name` to its import by that `local`, so a comment between `default` and the name no longer stops it with "no declaration there says what it is". A name the file declares is still answered by its declaration: `export const logger = OriginalLogger` is a `const`, as TypeScript's declaration emit publishes it.
