---
'@variance-authority/help': minor
'@variance-authority/sense': patch
'@variance-authority/cli': patch
'@variance-authority/package': patch
---

Search ranks a name by where it holds the words, reaches a name through a word's stem, and answers when nothing is published

`variance ask search --query 'instrumenting modules'` found nothing named
`instrumentModule`, because a word of the question had to start a word of the
name as written. Now a word also reaches a name word that shares its stem, so
`instrumenting modules`, `instrumented module` and `instrumenting` alone
answer `instrumentModule` as an exact match. The stemmer takes one inflection off and then every noun
or agent ending, so a word and its forms share one stem: `instrument`,
`instrumenting` and `instrumentation` meet, and so do `placement`, `place`
and `placed`. An ending needs four letters left, so `comment` stays apart from
`come` and `generation` from `gene`. An `s` after `s` or `u` and an `ed`
after `e` are not inflections, so `process` stays apart from `proceed`. The
dependency lexicon's catalogue is built again at the next `variance index`,
because it stores stems. Until then a catalogue of the version before still
answers every question; only the packages that describe a question by words
are left out, and the answer says so and names `variance index`. A question
by words also reports how many packages describe it when more are held than
shown, which it read under the wrong field name before.

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
and publishes the search, the way every other question does, and the answer
no longer says the checkout was not compared.
`readSearchForAnswer` now returns the search with whether it was read from
the checkout, `{ index, compared }`, instead of the search alone. Only under
`--just-answer` does it refuse, and the refusal names that flag and
`variance index` as the command that publishes one.

A published search or published value that is there and does not open is no
longer passed over in silence. The answer names each one it tried, why it did
not open, and that it read the checkout instead; under `--json` it is
`unopened`, one `{ published, at, reason }` per file. A file that is not there
is still absence, and says nothing.
