---
'@variance-authority/cli': patch
---

The `variance-authority` skill says which files `variance` answers from: `symbol`, `uses` and `search` from the declarations in the files its index parses, and `ask grep` from the files its start point reaches along the imports. A YAML, JSON, Markdown or shell file outside them is text, and the skill sends it to `rg` or `git grep` alongside `variance`, since an empty answer says nothing about a file `variance` did not search.
