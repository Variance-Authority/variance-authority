# Reviewing `@variance-authority/help`

Answers what a workspace name is, who imports it and which name does a job, from
the source index `sense` produces; `variance ask`, `variance serve` and
`variance-authority-help` call it. This file covers `search` and its caps.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/help/`.

## Contracts

- **One value, counted whole.** Text and `--format json` read one
  `SearchAnswer`; every `total` counts the whole match, so `N more not shown` is
  `total` minus `shown`, and a published name is never repeated below. Written
  in [search-answer.ts][answer] and [search.ts](src/tools/search.ts).
- **Absent is not empty.** A refused start point carries no sections; `loose`
  and `described` are absent when an exact section answered, and a total of zero
  when they ran and found nothing. Written in `SearchAnswer`
  ([search-answer.ts][answer]).
- **The loose section may only add.** It never reorders or removes a row above,
  never offers one back, stays inside the area, and prints nothing when it has
  nothing. Written in the [README][loose] and `src/tools/search-loose.test.ts` ›
  "what it may never do".
- **A row holding each word is shown however it sorts.** Every word a described
  row holds is held by a row shown; its best holder takes the place of the last
  row whose words another shown row holds. Written in [described.ts][described]
  and `src/tools/search-described.test.ts` › "shows a name holding the one word
  nothing shown holds, past more names holding another word than the section
  shows".
- **The cap never picks the section.** A name holding fewer than half the stems
  that the loose pass reaches by every word is loose's, however many names sort
  before it. Written in `src/tools/search-described.test.ts` › "is the loose
  section's however few names sort before it, so the rows shown never decide
  which section tells it".
- **A weight does not move with what is left.** A word's rarity is counted over
  everything reached, other sections included, in integers. Written in
  [described.ts][described], [ADR-0057][adr57] ("A float in any sort key") and
  `src/tools/search-weight.test.ts` › "weighs a word by how many of everything
  the description reached hold it, not only the rows left to show".
- **An area is a boundary.** `--from`/`--to` remove names outside the closure,
  union the directions, and refuse a path the tree does not hold rather than
  widen. Written in the [README](README.md) ("A path is a path").
- **A miss is a miss of the text.** No match is said first, the nearest follow
  under their own counted heading. Written in [README][not].
- **Files are uncapped.** `intersection` gets every file `search` matched, not
  the rows shown. Written in `searchedFiles` ([search-answer.ts][answer]).
