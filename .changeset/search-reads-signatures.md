---
'@variance-authority/help': minor
'@variance-authority/package': minor
'@variance-authority/sense': minor
---

`ask search` reads the words an exported declaration's signature writes: its parameter names, the type names they are written with, and its return type — never a comment or a string default in it, and nothing of a type alias, whose text after `=` is its body. They rank a declaration below the words of its name and its doc, so an undocumented `matchTrees(baseline: SemanticNode, candidate: SemanticNode)` answers "matching between baseline and candidate trees". A word only a signature holds reaches no declaration and shows none on its own. Each exported row of the Help value carries its `signature`; the Help snapshot moves to version 11 and the search index to version 5, so an older one is written again rather than answering without signatures.
