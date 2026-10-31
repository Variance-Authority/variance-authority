---
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

`ask symbol` and `ask uses` answer a name written as `Container.member` with the member that container declares, where they refused it as undeclared. A name a file also declares at its top level lists its members beside that declaration, where the declaration hid them.

So does a name imported by the path of its file, and a published one. The first five member declarations are listed and the rest counted. When no interface, type alias or class body read declares the member, the answer names where the container is declared, or says no file declares it at its top level, since a namespace an import binds is not read as one. An inherited member is left to the go-to-definition of the container's language's type checker, and so is a member of an enum, a namespace or an object literal, whose bodies the source index does not read.

A member a type alias declares in a literal its intersection or union joins, `type Options = Base & { index: string }`, is named a member of `Options`, where it was named a member of a type literal.
