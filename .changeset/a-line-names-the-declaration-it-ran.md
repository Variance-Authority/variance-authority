---
'@variance-authority/cli': minor
'@variance-authority/help': minor
'@variance-authority/sense': minor
---

`ask symbol --line <file>:<line>` ranks the declarations of a name by how closely the tests that entered each match the tests that ran the line. The ranking is overlap of recorded tests and does not establish which declaration the line called. Declarations entered by the same tests are marked tied. A line no recorded test ran, and a recording that cannot place the lines at the commit it ran at, say so and answer as without `--line`.
