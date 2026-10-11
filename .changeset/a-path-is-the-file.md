---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
'@variance-authority/playwright-test': patch
---

A path names one file, and a path that ends like it is another file

Four places related two names by how they end or what they spell, and each is
now exact.

A built module's lines are read back through its map only from the source that
resolves to the file, as the Source Map specification resolves one: behind
`sourceRoot`, beside the map. A source that ends like the file but resolves
elsewhere, such as `src/a.ts` in a map beside `dist/a.js`, is another file and
its segments are not read. A map with no source that resolves to the file used
to have every segment read as the file's lines; the module is now recorded as
the text that was handed over, under its own name.

`variance ask symbol` and `ask uses` with `--package` naming one file of a
package, such as `@acme/lib/src/internal/math`, answer from the file an import
of that specifier resolved to. When nothing imports it, the file it names is
not known, and the name is refused with that reason, rather than answered from
a file whose path ends like the specifier.

A Playwright test's name, in its recorded coordinate and in the vantage
listing, is its `titlePath` after the file, the first entry. A describe that
spells the file, its leaf name or the project is no longer dropped from the
name.
