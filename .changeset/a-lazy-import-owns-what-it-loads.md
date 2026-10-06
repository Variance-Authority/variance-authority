---
"@variance-authority/distill": minor
"@variance-authority/cli": minor
---

`variance distill` walks dynamic imports of a quoted string beside static ones, so what
only an `import()` reaches is listed under it, printed as `lazily imports`,
rather than apart as unseen. A module a static and a dynamic import both reach
is listed as shared, and a lazy import under an unused static import is owned
by the static one. Only a dynamic import or `require` whose specifier is not a
quoted string, or a load the runner made, is still unseen.

`distillFile` and `distillScope` take an optional `lazy` lookup beside
`imports`, and an import cause carries `lazy: true` when only a dynamic import
brings its modules in.
