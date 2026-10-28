---
'@variance-authority/sense': patch
'@variance-authority/help': patch
---

A word a doc writes in a code span is found by that word

The search file split a doc on spaces and punctuation. A backtick is neither,
so a doc that wrote `@testOnly` in a code span held the word with its
backtick still attached, and `variance ask search --query "testonly production"`
never reached the name that doc describes. A backtick now ends a word in a
doc, in a name and in a query, so that doc holds `testonly` and `production`.

The search file moves to version 4. The first question after the upgrade
names the earlier file as unopened, answers from the published value, and
writes the search again beside it.
