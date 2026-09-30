---
"@variance-authority/sense": patch
---

A line deleted above a module's first statement or below its last selects no test

The recorder starts a module's region at its first statement and ends it at its last, so a license comment above the imports, or a comment after the last function, is in no region. Selection read a deleted line there as a line the recording never saw, and charged every region of the module: deleting a license comment beside a change to one function selected every test that ran any function of the file. That line now charges nothing, the same as a line inserted between two functions. Text inserted above the first line of such a file is read the same way.
