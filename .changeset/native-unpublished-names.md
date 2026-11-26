---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
'@variance-authority/help': patch
---

The `variance` executable answers `ask symbol --name` and `ask uses --name` itself for a name files export and no entry publishes, where it started Node before: one export or several, an export passed on from another file, a renamed import, a type-only export, the members of a class, an export nothing imports, and a file imported by path that exports more than the name asked. Over 600 questions asked of a large monorepo (300 names, each asked of `symbol` and `uses`), it answers all 600 itself, where it answered 322. `ask uses --name Button` there takes 0.12 s, where handing it to Node took 0.34 s.

Its answer is the one Node gave, but for an import by path that reaches no one declaration: one whose file exports no declaration of the name, and one the source index resolved to no file, as in a checkout whose packages are not installed. Both are listed apart, credited to no declaration, where Node credited the first to the first declaration it read and the second to the declaration its package name led to. `ask uses --file` on a file whose export the source index binds to no declaration says so and exits 2.

`docs_symbol` and `docs_uses`, asked through `variance ask` or over MCP, answer from the same Rust code as the executable. They read the source index of the checkout they are asked about: a host that names no checkout, holds no snapshot, or has no source index is refused, where it got an answer read from the TypeScript the host held; on such a host, start the MCP server with a root and run `variance index` there. An answer the index cannot give says why, in the same words through either entry, and the executable never hands `symbol` or `uses` to Node for it: a store published for another checkout or that does not read, `GIT_DIR` or `GIT_WORK_TREE` set, a configuration that does not parse, and a checkout path that is not UTF-8 are refused with exit 2.
