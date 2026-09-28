---
"@variance-authority/sense": patch
---

Reading a journey file for a change decompresses only the runs the question reads: the changed modules' regions, their test sets, and the strings they name. A module is found by a binary search of the file's sorted paths, and a file whose module rows are out of order is answered through a table of every path instead. Every journey file is now written with its module rows in code-unit order of path.
