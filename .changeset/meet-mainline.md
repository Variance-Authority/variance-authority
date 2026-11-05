---
'@variance-authority/isolator': patch
'@variance-authority/package': patch
'@variance-authority/playwright': patch
'@variance-authority/png-sharp': patch
'@variance-authority/sense': patch
---

Runtime dependencies move to what npm publishes now: `oxc-parser` 0.157,
`magic-string` 1.4, `sharp` 0.35, `yaml` 2.9.1 and `playwright` 1.64. An install of
`@variance-authority/playwright` drives the Chromium that Playwright 1.64 ships, and
a browser change can move pixels, so a baseline drawn by the older one may report a
change on its first run.

`@variance-authority/sense` treats an exported object whose key holds a lone
surrogate as it treats a spread or a computed key: the module's exports are not
known, because no importer can spell that name.
