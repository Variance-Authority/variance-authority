---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

Undoing an edit to a module your tests ran now selects those tests

A run over an uncommitted edit records the edited text, and the next selection
reads your change from that text. When you put the file back the way the commit
has it, the diff from the commit no longer names the file, so the selection
never read it and skipped the tests that had run the edit: you could edit a
module, run the tests it reached, put it back, and the next run selected none
of them. A module whose rows were recorded over a kept text, and that the diff
does not name, is read from that text to the commit's, so putting it back
selects the same tests the edit did. A patch handed in with `--diff` is still
read as the whole change.
