---
'@variance-authority/cli': patch
---

`variance review --root <dir>` reads its base in that checkout

It read the base, the diff, the install and the link to the files from the directory it was started in. Started in another repository, it compared that repository's commit with the checkout `--root` named.
