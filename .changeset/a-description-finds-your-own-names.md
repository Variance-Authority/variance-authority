---
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

A description finds this repository's own names before an installed package's

`variance ask search --query 'tsconfig custom conditions'` answered only with
the installed packages whose descriptions hold those words. The repository's
own names were matched by the phrase, or by every word in the name, and an
installed package describing the words stopped the search for anything looser.

Now, when nothing in the repository holds the query as written, the names
holding at least half of its words — stemmed and stopworded by the rule the
installed packages are read by — come first, each with the words it holds:
`customConditionsFor … [holds: conditions, custom]`. They are ordered by how
many of the words the name itself holds, then how many it holds at all. The
installed packages that describe the words follow them, and the loose reading
of the words runs whether or not a package describes them. `--format json`
carries the section as `described`, each row with its `words`.

`@variance-authority/sense` exports `describedWordsNative` and
`wordStemsNative`: a question's stems, and a word's stem, by the addon's rule.
