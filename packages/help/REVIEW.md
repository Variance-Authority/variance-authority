# Reviewing `@variance-authority/help`

## Contracts

- **One value, counted whole.** Written in [search-answer.ts][answer] and
  [search.ts](src/tools/search.ts).
- **A section that did not run is absent.** Written in
  [search-answer.ts][answer].
- **The loose section may only add.** Written in [README][loose]; pinned by
  [`src/tools/search-loose.test.ts`](src/tools/search-loose.test.ts).
- **A row holding each word is shown however it sorts.** Written in
  [described.ts][described]; pinned by
  [`src/tools/search-described.test.ts`](src/tools/search-described.test.ts).
- **The cap never picks the section.** Pinned by
  [`src/tools/search-described.test.ts`](src/tools/search-described.test.ts).
- **A weight does not move with what is left.** Written in
  [described.ts][described] and [ADR-0057][adr57]; pinned by
  [`src/tools/search-weight.test.ts`](src/tools/search-weight.test.ts).
- **An area is a boundary.** Written in [README](README.md).
- **A miss is a miss of the text.** Written in [README][not].
- **Files are uncapped.** Written in [search-answer.ts][answer].
