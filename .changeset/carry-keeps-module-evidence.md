---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A comment, type or formatting edit no longer drops the tests recorded for the file

After an edit to a file that changes nothing that runs, such as a comment, a type or formatting, the record dropped every test that loaded the file, and `variance review` reported its regions as no longer run. Those tests are now kept. After an edit that changes only function bodies, the tests that loaded the file are kept at its top level, and the tests of the changed bodies are dropped as before.

When a run of some tests updates the record, the tests that did not run keep their cases on the regions they ran:

- Two callbacks with the same name, such as two `useEffect` callbacks, no longer swap cases when the two versions of the file have a different number of them. A callback that cannot be told apart takes the cases of the function around it.
- Deleting a branch no longer drops the cases of the file's top level, even when it renumbers the branches after it.

`variance coverage` and `variance covering` no longer report a test file as no longer running a region when the test did not run since that region's file changed. They count such a region as unmeasured. A runs record beside the record that is there and cannot be read is refused, naming it, rather than read as if every test had run.
