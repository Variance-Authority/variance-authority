---
'@variance-authority/cli': patch
---

The `variance-authority` skill says which files `variance` reads: the ones its index parses — JavaScript and TypeScript, stylesheets, Python, Rust, Java, Kotlin and Swift — and, for `ask grep`, only those its start point reaches along the imports. An empty answer says nothing about a YAML, JSON, Markdown or shell file, and the skill sends that text to `rg` or `git grep` alongside `variance`.
