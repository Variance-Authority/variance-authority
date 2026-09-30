---
"@variance-authority/help": minor
"@variance-authority/sense": minor
---

A third-party name in `ask search` and `ask symbol` says whose manifest offers it

Each installed third-party name in a `variance ask search` answer gives its version, the manifest that offers it, how that manifest declares it (`dependency`, `optional`, `peer` or `dev`), and how many times the code under that manifest imports it, with the first import as `file:line`. `variance ask symbol` prints the same line above the declaration. With `--from` or `--to`, `ask search` offers a name only when the manifest that owns one of those paths declares or imports its package. A package that only another workspace declares is left out, even when the path imports that workspace. When no third-party name matches, the answer says how many packages it searched and under which manifests. The next `variance index` rewrites the dependency lexicon with these fields.
