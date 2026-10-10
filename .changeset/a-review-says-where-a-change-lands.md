---
'@variance-authority/cli': minor
---

A review says where a change lands, a package at a time

A review listed changed functions one by one, so in a monorepo you could not
tell which owners a pull request touches, or whether a package's own tests ran
its change or another package's happened to. When the changed functions sit in
more than one package, the review comment now follows its verdict with **Where
this change lands**: one row a package, as its nearest `package.json` names it,
with its changed functions counted by mark, the packages whose tests ran them
(`own` for its own), and how many other packages import its changed files,
type-only imports included.

| Package | Changed functions | Ran | Tests from | Packages importing it |
|---|--:|---|---|--:|
| `@acme/cart` | 3 | 🟢 2 · 🔴 1 | own, `@acme/checkout` | 4 |
| `@acme/money` | 1 | 🟡 1 | `@acme/cart` | 12 |

Packages with code no case ran come first. The table stays within 10 rows in a
repository of any size: past that, the packages whose every changed function a
test importing its file ran fold into one row, and the packages that do not fit
above it into another. `review.json` lists every package under
`changedPackages`.
