---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

The `variance` executable answers `ask symbol --name` and `ask uses --name` itself for a name files export and no entry publishes, where it started Node before: one export or several, an export passed on from another file, a renamed import, a type-only export, the members of a class, an export nothing imports, and a file imported by path that exports more than the name asked. Its answer is the one Node gives, byte for byte. Over 600 names asked of a large monorepo, it answers all 600 itself, where it answered 322: also a name declared again beside its export, by a file that keeps it or as a member of a class, and a name an entry publishes only inside `export * as`. `ask uses --name Button` there takes 0.10 s, where handing it to Node took 0.34 s.
