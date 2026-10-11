---
'@variance-authority/sense': patch
---

Two callbacks of one callee no longer trade tests across an edit

Two `useEffect(() => …)` bodies in one component are one address, told apart
only by the order they were cut in. Take the first out and write a new one
behind the second, and the order still holds two of them: the first is now the
old second body, and the second is new. A run over that text used to carry the
first effect's tests onto the old second body, in the record and in the case
index alike, so a diff inside it skipped the test that had entered it.

Across an edit to the file, such regions, and every region inside them, now
take the tests of the nearest region around them that is still known — the
component — until a run enters them again. The tests that had entered them are
demoted and run again. Over unchanged text they carry as before.
