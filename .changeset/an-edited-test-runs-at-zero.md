---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A test file the change edits is selected by its own source at zero hops, whether or not its record declared that source as a precondition or saw the test whole. Before, such a test was selected only through a precondition row naming its own file, so one recorded without it was skipped when whole and left for the open leg under `--at-distance` when not. A test seen whole that declared the text the change arrives at already ran it and stays skipped; a test the record did not see whole runs when its own file holds that text. `variance select` and `variance run --since` print a `read <file>:` line for every changed file. A file no parser was asked about reads `unasked`, because its rows, preconditions or importers answer for it, and `--format json` lists those files under `unasked`, beside `readings`. A file the record holds nothing about is still reported as unread.
