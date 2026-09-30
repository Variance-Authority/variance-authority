---
"@variance-authority/cli": patch
---

`variance review` compares only the test files a run at this commit wrote to the case index, and its markdown fits in one GitHub comment

A test file is compared against the base only when the last run to write the case index wrote its cases at this commit. A test file the runs at this commit ran, and the case index holds a case of, but whose cases that last run did not write, is not compared, and the review lists it: `Not compared, no case index was written at this commit for: …`. When that last run was at another commit, no file is compared and every such file is listed. A test file the case index holds no case of is not listed, because there is nothing to compare: for example, a browser suite whose every case is skipped on a machine with no browser. In `--format json` those files are `motion.unwritten`, and `motion.lastRunUnread` names the file of the last run when it cannot be read, in which case nothing is compared. The markdown lists 40 moved regions and 40 test files, and says how many more `--format json` lists. A comment longer than GitHub's 65,536 characters is cut with every open fold and code fence closed, and a line saying how many characters are not shown. `variance comment` closes folds and fences the same way.
