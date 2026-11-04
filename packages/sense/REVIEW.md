# Reviewing `@variance-authority/sense`

## Contracts

- **A skip is `whole` less `entered`.** Written in
  [README](README.md#what-each-field-means).
- **A stage asked alone answers as it does inside the whole.** Written in
  [README](README.md#ask-one-stage-alone); pinned by
  [composed-stages.test.ts](src/test-selection/composed-stages.test.ts).
- **An unreadable record is absent, never a record of nothing.** Written in
  [README](README.md#where-the-snapshot-lives-and-when-it-is-rebuilt).
- **A walk stops where the record stops.** Written in
  [README](README.md#what-selects-what).
- **A precondition is unconditional.** Written in
  [ADR-0062](../../docs/context/adr/0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md);
  pinned by [select-unread.test.ts](src/test-selection/select-unread.test.ts).
- **What cannot be read is charged, never dropped.** Pinned by
  [index.test.ts](src/test-selection/index.test.ts).
- **The TypeScript reader is the native side's oracle.** Written in
  [ADR-0065](../../docs/context/adr/0065-source-scanning-is-one-native-side.md);
  pinned by [native-update.test.ts](src/native-update.test.ts).
- **Only `knownAs` relates names.** Pinned by
  [lookup.test.ts](src/test-selection/lookup.test.ts).
- **Two checkouts share no bytes but the index turn's two files.**
  `.work/index-turn` and `.work/index-turn.holder` are written by every checkout
  that shares the cache, and record nothing. The layers are pinned by
  [cache-layers.test.ts](src/test-selection/cache-layers.test.ts), the turn by
  [index-turn.integration.test.ts](src/index-turn.integration.test.ts).
- **A held listing is the tree only while Watchman and git's inputs vouch for
  it.** The newest segment's listing stands in for git's only when the same
  server and roots report nothing since its clock but paths git ignores, and no
  file git reads to list changed; anything else lists with git. Written in
  [spec 0107](../../docs/specs/0107-the-index-asks-watchman-what-moved.md); pinned by
  [change-source.integration.test.ts](src/change-source.integration.test.ts).
