---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`ask search` answers a description by any of its words. When no name or doc holds the query as written, the repository's own names and files that hold any of its stems come back, ranked as before: the most words held first, then the most in the name, then the phrase the doc writes. Before, a name had to hold at least half of them, so a three-word query whose best match held one word was reported as nothing. When those names, or the ones the loose reading adds, follow, the answer opens with "No name or doc in this repository writes `<query>` as typed. The nearest follow." instead of "Nothing in this repository is named or documented with `<query>`". That line still opens an answer that has nothing of the repository's own to show.
