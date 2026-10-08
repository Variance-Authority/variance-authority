---
"@variance-authority/cli": minor
"@variance-authority/sense": minor
---

A review says what it read

`variance review --format markdown` names what it read: the commit reviewed, the commit the change starts from, the commit the cases ran at, and the commit of each recording coverage is compared with. On a pull request CI checks out GitHub's merge of it, so the comment names the pull request's head and the merge it was tested as, and says it describes an earlier commit once the head moves on. Each changed place links to its lines at the commit reviewed.

Each changed region is `new`, `modified` or `moved`, in place of `written`: moved when the lines the change wrote are text the diff removed, and `movedFrom` names the file it came from. `changedLineCases` counts the cases that ran a changed line, as `variance covering --line` names them for each one, beside `cases`, which counts the cases that entered the region. Changed functions are one table with both counts, how the edit wrote each, and the first three test files; the cases by title stay in `review.json`. The cases added and removed come first, and a legend explains the marks. The Mermaid graph of moved reach is gone.

Coverage changes are said in plain words, each signed by what it does to the count: `+51 newly run · −2 no longer run · +19 run in 22 added regions`. The markdown prints a suite's count at the base and now beside those parts, and says so when they do not add up. The review no longer folds in the source no suite recorded; `variance coverage` still prints it.

`hunksOf` is exported from `@variance-authority/sense/test-selection`, the hunks of a diff under the names `changedLines` gives. `workingTreeChanges` is exported from `@variance-authority/sense`, the paths the working tree disagrees with `HEAD` about.
