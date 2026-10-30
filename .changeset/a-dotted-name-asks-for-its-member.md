---
'@variance-authority/help': patch
---

`ask symbol` and `ask uses` answer a name written as `Container.member` with the member that container declares, where they refused it as undeclared. A name a file also declares at its top level lists its members beside that declaration, where the declaration hid them.

So does a name imported by the path of its file, and a published one. The first five member declarations are listed and the rest counted. A dotted name whose container nothing declares is refused as such. One whose container is declared, with no interface, type alias or class body declaring the member on it, names where the container is declared and leaves an inherited or merged member, an enum member, a namespace export and an object literal's property to TypeScript's go-to-definition.
