---
"@variance-authority/sense": patch
"@variance-authority/cli": patch
---

A test run recorded over an edit keeps the text it ran over

A run's line ranges count lines in the text on disk while the suite ran, and the commit the recording names holds a different text whenever the tree was dirty. Selection used to charge every region of such a module and ask for a recording over a clean tree, so the ordinary loop — edit, `yarn test`, then revert or commit — ran every test that ever entered each file it touched. On Zod that was 2 of 199 test files skipped where 197 could be.

Landing a run now keeps the text of every recorded module git reports as changed, in the cache under `.texts/`, named by the digest the recording already holds. `variance select`, `variance covering` and `yarn test:since` read a change to such a module from the kept text to the text on disk. A module is still charged whole when its text was not kept: edited again while the suite ran, or the cache cleared since. The note then says so, and that the next run that loads the module records it again.
