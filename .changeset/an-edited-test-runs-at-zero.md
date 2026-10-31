---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A test file the change edits is selected by its own source at zero hops, whether or not its record declared that source as a precondition or saw the test whole. Before, such a test was selected only through a precondition row naming its own file, so one recorded without it was skipped when whole and left for the open leg under `--at-distance` when not. A test seen whole that declared the text the change arrives at already ran it and stays skipped; a test the record did not see whole is re-run, for its own file and every other precondition alike. `variance select` names every file the change holds on stderr, `the change names N files: …`, and `--format json` gives them as `changed`.
