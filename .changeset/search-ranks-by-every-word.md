---
'@variance-authority/help': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

Search ranks a name by where it holds the words, reaches a name through a word's stem, and answers when nothing is published

`variance ask search --query 'instrumenting modules'` found nothing named
`instrumentModule`, because a word of the question had to start a word of the
name as written. Now a word also reaches a name word that shares its stem, so
`instrumenting modules` and `instrumented module` answer `instrumentModule`
as an exact match. The stemmer runs to a fixed point, so a word and its
inflections share one stem: `instrument`, `instrumenting` and
`instrumentation` meet, and so do `placement`, `place` and `placed`. The
dependency lexicon's catalogue is built again once, because it stores stems.

A published or exported match is ordered by where it holds the question
first: in its name, then in its doc's opening paragraph, then later in its
doc. Importers order only within that. Before, `--query instrument` put a
type third whose doc said "instrument" only in its second paragraph, ahead of
names that hold the word.

When nothing holds the question as written, a name holding a word of it in
its own name now comes before one whose doc holds the words and whose name
holds none. The phrase the doc writes settles the order after that.

With no published search, `search` refused and told you to drop
`--just-answer`, even when you had not passed it. Now it reads the checkout
and publishes the search, the way every other question does. Only under
`--just-answer` does it refuse, and the refusal names that flag and
`variance index` as the command that publishes one.
