---
'@variance-authority/isolator': patch
'@variance-authority/package': patch
'@variance-authority/png-sharp': patch
'@variance-authority/sense': patch
---

Runtime dependencies move to what npm publishes now: `oxc-parser` 0.157,
`magic-string` 1.4 and `sharp` 0.35.

`@variance-authority/sense` treats an exported object whose key holds a lone
surrogate as it treats a spread or a computed key: the module's exports are not
known, because no importer can spell that name.
