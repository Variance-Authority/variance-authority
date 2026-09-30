---
"@variance-authority/cli": minor
---

`variance review` follows a changed installed package to the files that import it

When the change moves an installed package, the review lists each one with the chains of packages that lead from it to the files that import it, how many files depend on it, and how many test files run them: `` `pkg`: N files depend on it, and M test files run them. `` A package nothing here imports, directly or through another package, is named on one closing line. The block is printed in both the text and the markdown formats, and `--format json` gives it as `packages`.
