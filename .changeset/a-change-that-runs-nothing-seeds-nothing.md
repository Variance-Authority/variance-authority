---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

A changed JavaScript or TypeScript file whose edit is a comment, a type or formatting no longer seeds the file-graph walk. `variance reach` leaves it out of the list and names it on stderr, and refuses a diff made only of such files. `variance run --since` reaches no component through it and no longer runs the whole suite over it. `runsAsBefore` in `@variance-authority/sense/test-selection` reads which files of a diff run what they ran at a commit.
