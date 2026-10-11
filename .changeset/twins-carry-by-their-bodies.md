---
'@variance-authority/sense': patch
---

Two callbacks of one callee carry their tests by their bodies across an edit

Two `useEffect(() => …)` bodies in one component are one address, told apart
only by the order they were cut in. Take the first out and write a new one
behind the second, and the order still holds two of them: the first is now the
old second body, and the second is new. A run over that text used to carry the
first effect's tests onto the old second body, so a diff inside it skipped the
test that had entered it.

Across an edit to the file, such regions now carry by the text of their own
bodies: a body that is still there keeps its tests wherever it moved, and a
body that is gone has its tests demoted and run again. Selection stays precise
where the bodies are known and widens only where they are not. A body that is
new or edited, or written twice over, takes the tests of the component around
it until a run enters it again. The case index records no bodies, so across an
edit its callbacks take the component's cases. Over unchanged text they carry
as before.
