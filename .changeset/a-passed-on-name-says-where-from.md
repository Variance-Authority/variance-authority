---
'@variance-authority/package': minor
---

A name passed on from outside the workspace says where it comes from

A `foreign` declaration and the help entry built from it now carry
`passesOn`, the request it comes through and the name it has there (`*` for
everything an `export * from` passes on), so a reader can say the line passes
the name on rather than declares it. `PassedOn` is exported beside
`Declaration`.
