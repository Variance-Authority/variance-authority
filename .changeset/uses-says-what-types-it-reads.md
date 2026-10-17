---
'@variance-authority/help': patch
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`ask uses` on a member says which uses it lists, and asks the declaration's type checker for the rest

`variance ask uses --name <member>` and `docs_uses` list a use of `Props.size`
only where the line writes the value's type. The answer now ends with two lines
that say so: a use through an inferred value, a generic, a subtype by `extends`
or `implements`, a JSX attribute, a utility type or an inline type literal is
not listed, because no type checker runs. The second line names the
declaration's `file:line` for find-references in the declaration's own
language's tooling (TypeScript's language service for JavaScript and
TypeScript, its language server for any other), or, with several
declarations, asks for the one you mean from the list above. These two lines
replace the `docs_grep` route the answer used to end with; `variance ask grep --to <declaring file>` still finds the name as
text. Which uses are listed has not changed, and an answer with no member
prints neither line.

The skill reference tells an agent to use both tools: `variance` for
declarations, imports, the module graph and the recording, the language's type
checker for anything that needs a value's type.

Members are read from JavaScript and TypeScript files only, and a name nothing
declares now says so. Where the source index holds Python, Rust, Java, Kotlin
or Swift files, `ask symbol` no longer says no file declares the name "at its
top level or as a member": it says no file declares it at its top level and no
JavaScript or TypeScript file declares it as a member, names those languages,
and sends you to their language server's workspace symbols, then its
find-references. `ask uses` ends its refusal with the same sentence, and a
member answer of either ends with it too, since a member of those languages may
be declared there as well. A workspace of JavaScript and TypeScript alone keeps
the old sentence and prints no new one.
