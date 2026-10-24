---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`variance ask uses` follows a name through a namespace inside a namespace, `lib.ns.name`, and through a namespace passed on as `default`, and says a name an entry publishes only inside `export * as ns` is published as `ns.name`. Every declaration of a name is answered with its own imports, kept apart; `--file` naming a file that only passes the name on answers for the declaration it reaches; and a `--name` holding a `/`, a file path or a package, answers who imports that module, as `discover --imports` does.
