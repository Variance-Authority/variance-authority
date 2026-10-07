---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

Undoing an edit your tests ran now selects those tests

A run over an uncommitted edit records the edited text, and the next selection
reads your change from that text. When you put the file back the way the commit
has it, the diff from the commit no longer names the file, so the selection
never read it and skipped the tests that had run the edit. Changing
`Math.floor` to `Math.trunc` selected 9 tests, and changing it back selected
none. Now a module whose rows were recorded over a kept text, and that the diff
does not name, is read from that text to the commit's. Restoring
`Math.floor` selects the same 9 tests. A module whose kept text is gone is
charged whole, as any module recorded over a text nobody holds is.
