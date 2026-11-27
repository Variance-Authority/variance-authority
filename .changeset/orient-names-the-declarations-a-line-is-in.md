---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

`ask orient --files <path>:<line>` and `docs_orient` name the declarations the line is in, from the source index, whether or not a recorded case ran it. A new part, `Lines asked about`, comes after the files asked about, with one row per line: `src/cart.ts:13  in class Basket > method total (lines 12–14)`, outermost first, with the lines of the innermost declaration. Declarations that share the line are side by side, `in function a, function b (line 2)`, and one is within another only as the parse records it. A line in no declaration is `at the top level of the module`. In a language whose members the index does not read, such as Python or Rust, a line in a class, a type or no declaration says it may be in a member. A file the index holds no parse of says so, and a file changed since `variance index` parsed it is not answered from that parse. Before, only the recording answered a line, so a line in an interface, a type or a function no case ran was not named. The list of files asked about keeps the `:<line>` as asked, and the journeys head names the kind of the function it narrows to: `in function total (lines 4–9), which 3 cases ran`.

`variance index` rebuilds the source index once: its format version is 54, which stores the last line of each top-level declaration, member and nested function, and the kind of each member: `property`, `method`, `getter`, `setter` or `accessor`. `MemberDeclaration`, `NestedDeclaration` and `SourceSymbol` carry `endLine`, and `MemberDeclaration` carries `kind`. `orientAround` takes the lines asked about and returns `lines`, each holder with its `depth` and each line with whether its file `changed`.
