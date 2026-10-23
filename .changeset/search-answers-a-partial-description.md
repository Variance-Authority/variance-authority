---
'@variance-authority/help': patch
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`ask search` answers a description by any of its words. When no name or doc holds the query as written, the repository's own names and files that hold any of its stems come back, ranked as before: the most words held first, then the most in the name, then the phrase the doc writes. Before, a name had to hold at least half of them, so a three-word query whose best match held one word was reported as nothing. Their heading now reads "hold words of `<query>`" rather than "hold at least half the words of `<query>`". Installed packages still answer only when they hold half the words. A name holding fewer than half the stems, which this section did not hold before, is left to the loose reading when that reading reaches it by every word, as it was before. So `cache entriee magazie` still offers `cacheEntriesMagazine` loosely however many names holding `cache` this section shows.

When those names, or the ones the loose reading adds, follow, the answer opens with "No name or doc in this repository writes `<query>` as typed. The nearest follow." instead of "Nothing in this repository is named or documented with `<query>`". With `from`/`to` it opens with "No name or doc in reach of that start point writes `<query>` as typed", still says to ask again without `from`/`to`, then gives the nearest in reach. The *nothing* line still opens an answer that has nothing of the repository's own to show.

`declaredDescribedOf` no longer takes `needed`: a declaration or file answers when it holds any of the stems asked.
