---
'@variance-authority/help': patch
---

`ask symbol` and `ask uses` answer each declaration of a name apart. A declaration is the file that declares it and the name that file exports it under, so two published declarations that share a name are two answers, each with the import that reaches it and its own count, and so are an entry's `export { greet as salute }` and the file's own `salute`. "Also published by" lists only the other entries of the same declaration, and a declaration published or declared under another name than the one asked says that name. One binding its file exports under two names, `export default greet` beside `export { greet }`, is one declaration keyed by its named spelling, never `default`, and its importers under either name are its uses. Snapshots written before this read again.
