---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
'@variance-authority/help': patch
---

The `variance` executable answers `ask symbol --name` and `ask uses --name` itself for a name files export and no entry publishes, where it started Node before: one export or several, an export passed on from another file, a renamed import, a type-only export, the members of a class, an export nothing imports, and a file imported by path that exports more than the name asked. Its answer is the one Node gives, byte for byte. Over 600 questions asked of a large monorepo (300 names, each asked of `symbol` and `uses`), it answers all 600 itself, where it answered 322: also a name declared again beside its export, by a file that keeps it or as a member of a class, and a name an entry publishes only inside `export * as`. `ask uses --name Button` there takes 0.10 s, where handing it to Node took 0.34 s.

`docs_symbol` and `docs_uses`, asked through `variance ask` or over MCP, now answer from the same Rust code as the executable, so the two can no longer drift apart. A question that code does not answer yet still gets the TypeScript answer: `symbol` with `from` or `line`, `default`, and a name bound by `as` or exported by a file no package owns.
