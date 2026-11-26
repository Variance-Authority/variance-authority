---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`ask uses --name` answers one declaration of a name in full, a published one or else the one most places import, and names each other declaration a file exports on one line, with how many places import it, where it answered every one with its own imports. `--file` with the file one is declared in answers that one alone, as before. Declarations a file keeps to itself and members are still answered after the imports. On a large monorepo, `ask uses --name useKibana`, with 60 other declarations, answers in about 18 kB, where it took about 111 kB.
