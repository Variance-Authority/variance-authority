---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

The dependency lexicon is two binary files, and an edit appends to one of them

`variance index` writes the dependency lexicon as `dependency-lexicon.bin` and
`dependency-lexicon.sites.bin` beside the source index. The first is the
catalogue: the manifests' declared packages, what each installed package offers,
and the names, signatures and JSDoc of every public entrypoint. The second is
the import requests each source file writes, kept as a log. An edit appends the
requests of the files it changed to the log and leaves the catalogue as it is,
unless a manifest, an installed package or a specifier no source file imported
before changed. On a 51,059-pair checkout the two files are 55 MB and 27 MB, and
a refresh after one edited file appends about 450 bytes and takes 0.3 s.

After one edited file, `variance index` prints `dependency lexicon: 1 changed
source file read: …`. The line ends with the path of `dependency-lexicon.bin`.
`refreshDependencyLexicon` and `refreshDependencyLexiconNative` return `sites`,
the path of the log, `appended`, the number of source files whose requests the
refresh recorded, and `rebuilt`, which is true when the log was written whole.

**Breaking:** `dependency-lexicon.json`, `dependency-lexicon.built.json` and
`dependency-lexicon.merge.json` are no longer written or read. Run `variance
index` once to write the new files; the old ones can be deleted. `@variance-authority/help`
no longer exports `readDependencyLexicon`, `DependencyLexicon`, `LexiconEntry`,
`LexiconAvailability` and `LexiconIssue`; `ask search`, `ask symbol` and `ask stack`
read the lexicon. The refresh result no longer has `merged`.
