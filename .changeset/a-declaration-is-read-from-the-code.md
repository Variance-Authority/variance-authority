---
"@variance-authority/sense": minor
"@variance-authority/cli": patch
"@variance-authority/storybook-collector": patch
"@variance-authority/route-collector": patch
"@variance-authority/core": minor
"@variance-authority/unit-test": patch
---

The components a module declares are read from its code. A declaration written
in a block comment, a JSDoc example or a template literal no longer names a
component, so a commented-out `function Retired()` no longer makes its file
the one that declares `Retired`. A name is declared by a statement of the
module itself: a function, class or binding inside a function body belongs to
that function and no longer counts. An `export async function Page()`, an
abstract class, a generator, a second name in `const A = 1, B = 2`, and a name
that starts with a non-ASCII capital or carries a `$` are now declared too.

`variance run`, `variance collect`, the Storybook collector and the route
collector resolve a component to its `file:line` from the same reading, through
`indexDeclarations`, which `sense` now exports. What that changes in the index
they build from `source.dirs`:

- The line is the first line of the declaring statement. A decorated class
  sits at its first decorator, and a second name in a multi-line `const` at the
  line of the `const`.
- `.d.ts` files, and test, spec and story files your own `exclude` lets
  through, declare nothing.
- A file the parser cannot read, such as a Flow-annotated `.js` file, declares
  nothing. The text scan found the components in it; the record of that file
  in the source index names the parse error.
- Building the index needs `sense`'s native addon, which ships for macOS on
  arm64, Linux on x64 and arm64 with glibc, and Windows on x64. On any other
  machine, including an Intel Mac, an Alpine image and Windows on arm64, a
  configured `source.dirs` fails at its first file and names why the addon did
  not load, where the text scan ran anywhere. The route collector depends on
  `sense` for it.

`indexSource` is removed from `@variance-authority/core/attribute`. Build a
`SourceIndex` with `indexDeclarations` from `@variance-authority/sense`, or
write one as plain data: a map from component name to `{ file, line, via }`.
`SourceRef['via']` loses `'declared'`, which nothing produced, and
`readCapture` in `@variance-authority/unit-test` refuses a capture whose source
index carries it.

The source index format moves to version 18, so an index written before this
release is rebuilt once instead of keeping the names it read from comments.
