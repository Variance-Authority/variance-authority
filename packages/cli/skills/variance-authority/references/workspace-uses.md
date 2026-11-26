# `uses`

`symbol` answers what a name is *supposed* to be: the signature and the comment
somebody wrote above it. `uses` answers how it is *actually* written here, from
the imports, which a stale doc comment cannot change. Ask it whenever you are
about to write a call and the signature alone leaves a choice open. Read the
stories first: a story is somebody's worked example of the call. A section with
no members is left out rather than shown empty.

A published name that nothing imports is a different answer, not an empty list:

```
`PagesOptions` [interface] is published and nothing in this workspace imports it; a namespace imported by name that goes somewhere whole and, outside Rust, a call through a qualified path are not counted. docs_symbol has its signature and what is written above it.
```

The imports inside the package that declares the name are counted and listed
apart from the ones from other packages, under `Source, inside <package>:` and
`Source, from other packages:`, and the same for tests and stories; the first
line says how many are on each side:

```
`greet` [function] is imported in 2 places: 1 from another package and 1 inside @acme/lib.
```

A site ends with the lines its file uses what the import binds on, read from
the source index:

```
apps/app/src/hello.ts:1 — @acme/app; used on line 2
```

A site from another package names its package after the line. Under `Source,
inside <package>:` the heading already names it, so the row leaves it off:

```
src/shapes/use.ts:6; used on line 9
```

Under `Used in <file> — <package>, which declares it:` the heading names the
file and its package, so each row is the line alone, indented:

```
Used in src/shapes/area.ts — @acme/shapes, which declares it:

  14
```

The imports within the name's own package come from the source index: every
import that resolved to the file declaring it, or to a file that passes it on
with `export … from`, which is followed under the name it exports and is not
listed itself, in another package as well. `export type … from` passes a name
on the same way, and every import that comes through it is marked `(type only)`.
A name an entry publishes under another name than its declaration is read from
that entry. An import of a renamed re-export ends `(as <name>)`. A Rust path
written in a type or an expression, such as `crate::order::code_unit(…)`, is
listed as a `use` is. A name read off a module loaded with `require` and a
constant specifier is listed on the line that reads it, as off an awaited
`import()`: destructured, renamed or not, read in place, `require('./m').name`,
or read off the variable the module is held in, `const m = require('./m')` and
then `m.name`, at the top level or in a function. A `require` whose module goes
on whole, held, `m()` or `hand(m)`, or in place, `hand(require('./m'))` or
`module.exports = require('./m')`, is listed as passing the module on whole.
Not read, and not named where the answer says what is not counted: a `require`
of a computed specifier, and another object's, such as `loader.require('./m')`.
A package that passes a module on as `export * as ns`,
or as `export { ns }` after `import * as ns`, passes each of its names as a
member of `ns`: `import { ns } from 'pkg'` and
then `ns.name`, or `const { name } = ns`, is listed on the line that reads it,
ending `(namespace, line <n>)` with the line of the import. A namespace inside
a namespace, `lib.ns.name`, one destructured off it, `const { ns } = lib` or
`const { ns: { name } } = lib`, and a namespace passed on as `default` are
followed the same way, and a name destructured off a namespace is that name,
not a declaration of its own. An entry that publishes the name only inside such a namespace
publishes it as `ns.name`, and the first line says `published as \`ns.name\` by
<package>`. A namespace handed to a function the same file declares is followed
into it. One that goes somewhere else whole, such as
`[ns]`, and outside Rust a call through a qualified path, are not listed, and
the answer ends by saying so. With `--package` naming one subpath specifier, an import through
another specifier of the same package is left to that one. When the source
index is missing or does not read, the imports from other packages by their
published path are still listed, and the answer says why the rest are not.

A name a file exports and no entry publishes is answered from the source index
alone, the same way. The first line names, in brackets, the kind of the
declaration it binds, and where it is exported:

```
`roundTax` [const] is imported in 1 place, inside @acme/lib, and no entry publishes it; it is exported at packages/lib/src/internal/math.ts:5.
```

When the one file that exports it only passes it on, the line goes on to the
declaration:

```
`levy` is imported in 2 places, all inside @acme/kit, and no entry publishes it; it is exported at packages/kit/src/money/rates.ts:1, which passes on `taxOf`, declared at packages/kit/src/money/tax.ts:1.
```

A file that only binds the name, by destructuring it out of a value or with
`const x = require('m')`, and does not export it declares no other thing: the
answer lists it as `bound, not declared, at <path>:<line>`, then the lines of
that file that use it, and when no file declares the name it says so first.

Each file that declares a name declares another thing, so `uses` answers for
every one of them, each kept apart: the published declaration's imports, a line
naming each file that exports the name without publishing it followed by that
declaration's own imports, and each file that keeps it to itself. The lines
under the headline name every other declaration by file and line, so the count
the headline gives is read as one declaration's. `--file
<path>`, the file one of them is declared in, answers for that declaration
alone; a file that only passes the name on with `export … from` answers for the
declaration it reaches. The answer ends by saying so when it covers more than one:

```
`greet` is exported, without being published, at packages/lib/src/other.ts:1 as well, which is another declaration.
Imported in 1 place, inside @acme/lib.

`file`, the file one of them is declared in, answers for that declaration alone.
```

A declaration is the file that declares it and the name that file exports it
under, so two packages that each publish `withTestSelection` are two answers,
each with its own entry points and count. One binding a file exports under
several names, `export default greet` beside `export { greet }`, is one
declaration, named by the name it binds. `default` is a slot every module has,
not a name: `export default function Badge` is `Badge`, and an anonymous
`export default function ()` is named by the local name of the import nearest
its file, the one sharing the most leading path segments, then by path and
line, else by the nearest re-export that names it. Every local name an import
gives an anonymous default answers it; the nearest one heads the answer. Asked
by `default`, `symbol` and `uses` answer only the defaults nothing names.

A `--file` that declares nothing by the name is answered with the files that do,
or, when none does, with the files that bind it.

`--limit <n>` sets how many rows of each list are shown, 12 when not said:
each kind of site, the lines of the declaring file, the member declarations
and the uses of each member.
Every site is still counted, and the rest are said:

```
… 3 more not shown; a higher `--limit` shows them.
```

A method or property of an interface, a type literal or a class is never
imported: code reaches it through a value, `props.size`. `uses` lists where
each member by that name is declared, each line ending with the container it is
on, then, under each declaration on a named container, the lines that use it.
For a name no export has, that is the whole answer:

```
`size` is no exported name; it is a member, declared in 2 places:
Path order; `from` sorts nearest first.

Member declarations:

src/shapes/props.ts:2 — Props
src/shapes/props.ts:7 — Other

`Props.size`, declared at src/shapes/props.ts:2, is used in 3 places:

src/shapes/fit.ts:2 — @acme/shop, read
src/shapes/use.ts:6 — @acme/shop, write
src/shapes/use.ts:8 — @acme/shop, destructure

No line uses `size` through a value whose type is written as `Other` at src/shapes/props.ts:7.

An implementation of `size` that takes its type from where it goes — an argument, a property, a returned value — writes no type on its line and is not listed: TypeScript's language service's go-to-implementation on the declaration you mean names it.
A use is listed here only where its line writes the value's type. A use through an inferred value, a generic, a subtype by `extends`, a JSX attribute, a utility type or an inline type literal is not: which type a value has is a type checker's answer, and none runs here.
Ask TypeScript for those: its language service's find-references on the declaration you mean, each listed above with its file and line (`package` narrows the declarations to one package).
```

The three lines close the members of every member answer, whatever they list. With one
declaration, the first and third lines name it, such as `` `Props.size` at
src/shapes/props.ts:2 ``. The first and third lines name TypeScript's
language service for a declaration in JavaScript or TypeScript, the declaration's own
language server for one in another language, and each declaration's own type
checker when they are written in more than one. An answer with no member
prints none. Members are read from JavaScript and TypeScript only, so a
member of a Python, Rust, Java, Kotlin or Swift file is in no member answer.
When the source index holds files of those languages, a fourth line names them
and sends you to their language server, as under `symbol`.

A use is a line that reads the member (`props.size`, `props['size']`,
`props?.size`, a call `props.size()`), writes it (`props.size = 1`, `+=`, `++`, a key of an object
literal written as the type), or destructures it (`({ size }: Props) =>`,
`const { size } = props`). It is tied to a declaration only where the line
writes the value's type: a parameter's or a variable's annotation, alone or
with `| undefined`, or an `as`, a `satisfies` or a `<Props>` cast. That name is
followed through the import that binds it, renamed or passed on by `export *`
or `export { … } from`, to the file that declares it, so `Props.size` and
`Other.size` are listed apart and a same-named type of another file is neither.
A binding that shadows an annotated one is no use. A member of a class that
writes `implements Props` is listed under `Props.size` as an `implement`; a
static member is not, since `implements` types the instance.

What a type checker infers is not read: a value returned by a call, a generic
or a mapped type, a value narrowed or copied without an annotation, and a type
named through a namespace (`ns.Props`). Nor is what the line does not write as
a value of the type: a JSX attribute (`<Box size={2} />`), an object literal
passed to an annotated parameter or property, which implements the member with
no type on its line, as `{ deps: { readJourney } }` does, `this.size`, a field inherited through
`extends` or `&`, and a type imported by another name than its declaration's,
as a default export or one renamed where it is declared. Those are TypeScript's:
its find-references on the declaration `uses` prints lists them, proven against
that one type. `variance ask grep --query '\bsize\b' --to src/shapes/props.ts`
finds the name as text in the files that import the declaration, at any depth,
with comments, strings and same-named members of other types among them. A name
that an export has as well, such as a wrapper function named like the member,
lists the wrapper's imports first, then
`` `prepareJourneys` is a member too, declared in 2 places: `` and the
declarations with their uses.

**`uses --from` sorts; `search --from` narrows.** On `uses`, `--from` is the
file you are editing, and every site still comes back, ordered by the leading
path segments it shares with that file. On `search`, `--from` is a start point,
and names outside it are removed. Neither is a distance; hop counts belong to
[test selection](test-selection.md).

Sites arrive as `path:line`, not as text. Open them: what you read then is the
file as it is now.
