---
'@variance-authority/sense': patch
---

A body edited in a module a partial run did not load is run again

When a run lands over a module it did not load, and that module's text on disk
has moved since it was recorded, the landing re-cuts the module's rows onto the
new text and keeps that text in the record. The next selection then reads no
diff for the module. The tests on its edited regions had run only the old body,
yet every one of them stayed recorded whole. A test whose function body you
edited before running only some other test was skipped by the following
selection.

Now the landing marks every test on a region whose text moved as incomplete,
together with every test on a region the new text gained and every test left
with no region at all. Selection runs those tests as having no whole
observation. A test on a region the edit did not touch stays whole.
