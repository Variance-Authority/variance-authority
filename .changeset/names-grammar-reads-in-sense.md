---
'@variance-authority/cli': patch
'@variance-authority/sense': minor
---

`@variance-authority/sense/test-selection` reads the `names` grammar

The `names.axes` grammar is now exported from `@variance-authority/sense/test-selection`:
`parseNameGrammar`, which checks a `names` value and throws `NameGrammarError` naming
the field, `readName`, `nameIndex` and `structuralParent` for a subject id, and
`heldValues`, `outsideVocabulary` and `caseTwins` for what a case said on the same
axes. `variance run` pairs a subject with its parent, and `variance covering
--where` reads a case's axis and twin, through this one implementation, so a
reader outside the CLI holds a case to the same vocabulary and base. The config
refuses what it refused, with the same messages.
