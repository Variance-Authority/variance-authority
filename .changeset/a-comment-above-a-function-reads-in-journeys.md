---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`variance select --execution` reads each changed module from both of its texts before charging its lines, as a selection from the snapshot already does. A comment added above a function sits between two declarations, in the region the module ran as it loaded, and it was charged to every file that imports the module: one comment in a widely imported file selected thousands of test files where the runtime change beside it selected six. The old text is the blob the patch names. A change that proves to run nothing now charges nothing, and one that leaves what the module does as it loads charges only the functions its lines fall in. A patch without `index` lines is charged by its lines, as before, and `select` prints each file's reading.
