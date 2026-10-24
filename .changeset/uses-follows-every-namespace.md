---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`variance ask uses` follows a name through a namespace inside a namespace, `lib.ns.name`, and through a namespace passed on as `default`, and says a name an entry publishes only inside `export * as ns` is published as `ns.name`. Every declaration of a name is answered with its own imports, kept apart; and `--file` naming a file that only passes the name on answers for the declaration it reaches.
