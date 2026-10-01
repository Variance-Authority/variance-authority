---
"@variance-authority/cli": patch
---

`variance restrictions` outside a git checkout is refused in one line

`variance restrictions` lists the `.relations.json` files git tracks. Run in a directory that is not in a git checkout, it printed git's own error and a stack trace calling itself a defect in the tool. It now exits with code 2 and one line naming the directory, saying it is not in a git checkout and that `--root` names one.
