---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A test file the change edits is selected by its own source at zero hops, whether or not its record declared that source as a precondition or saw the test whole. Before, such a test was selected only through a precondition row naming its own file, so one recorded without it was skipped when whole and left for the open leg under `--at-distance` when not. A test seen whole that declared the text the change arrives at already ran it and stays skipped; a test the record did not see whole is re-run, for its own file and every other precondition alike. Every changed file now has a reading, so `variance select` and `variance run --since` print a `read <file>:` line for each one and `--format json` lists it under `readings`. A file the parser was not asked about reads `unasked`, and its rows, preconditions or importers answer for it. A file the record holds nothing about is still reported as unread.
