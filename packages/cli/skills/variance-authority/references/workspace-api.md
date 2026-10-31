# What a workspace publishes, and where a name is used

Nine questions read a workspace's manifests and source: `packages`,
`entrypoint`, `symbol`, `uses`, `search`, `grep`, `discover`, `intersection`
and `gaps`. Each answer
read from a workspace generation names its UTC time; `variance ask grep` and
`variance ask discover` read the checkout as it is, and name none. They describe source, not a
build or a generated site, and they need no run and no config. For where a file
sits and what runs it, read [orient](orient.md).

Use them for *what does this repository publish, and how is it already used
here*. What a library on npm is supposed to be is a different question, and its
own documentation is the place to ask it.

## Two binaries, one implementation

`variance ask <verb>` and `variance-authority-help <verb>` run the same code and
give the same answers. Use whichever the workspace already has. Over MCP the
same questions are the `docs_*` tools in [MCP](mcp.md).

```bash
variance ask search --query viewport
variance-authority-help search viewport
variance-authority-help search viewport --from packages/app/ --just-answer
```

On `variance ask` every argument is a flag, and `variance ask` with no question
prints each question's flags and what it answers. On `variance-authority-help`
the first argument is positional.

## Before the first question

- **Node.** The version the installed package declares in `engines`.
- **One of the two binaries.** `@variance-authority/cli` provides `variance ask`;
  `@variance-authority/help` provides `variance-authority-help`.
- **No run, no config, no revision requirement.** Ordinary questions reuse a
  published generation for up to one hour. On either binary and either
  server, a question that generation refuses is asked again of one made from
  the checkout now, with the dependency lexicon built when it is missing or
  behind, so a refusal is about the checkout as it is; one that could not be
  read again says the checkout was not compared, and why, and one whose
  lexicon could not be built says the installed packages were not compared. `--just-answer` uses the
  last generation without inspecting the checkout and refuses when none exists;
  its answers and refusals say the checkout was not compared, and JSON carries
  `compared: false`. When no changed files are named, `search` reads a
  published search that way, with or without the flag, and says so too. When
  none is published it reads the checkout and publishes one; only
  `--just-answer` refuses, and the refusal names that flag.
- **Working directory.** `variance ask` reads the checkout under the working
  directory, so run it from the workspace root; it refuses `--root`.
  `variance-authority-help` takes `--root <dir>`.

Use `--just-answer` when CI, an editor or a watcher owns generation, or when an
answer must include no freshness work. The timestamp is part of the answer;
decide from it whether the producer needs to publish again.

## Two argument shapes on `variance-authority-help`

`--root` is for the **verbs**. The other two forms take the root as a **bare
positional**:

```
variance-authority-help <verb> [argument] [--root <dir>] [--just-answer]
variance-authority-help [root] [--just-answer]            # serve over MCP on stdio
variance-authority-help write [root] [--out <dir>] [--base <url>]
```

**Any first word that is not a verb and not `write` is read as a root
directory, and the binary starts an MCP stdio server on it.** There is no
"unknown verb" error at this level: `variance-authority-help serve` tries to
serve a directory named `serve`. That rule is also why the MCP config in
[MCP](mcp.md) passes `args: ["."]`.

A misspelling *inside* a verb is refused against the tool's own schema:

```
$ variance-authority-help uses digestValue --form x
`uses` takes no `--form`; it takes: name, package, from, limit
```

## Ask about a repository that does not depend on it

Run `variance-authority-help <verb> --root <dir>` on the other checkout. When
the binary is not installed, ask the package runner for the package
`@variance-authority/help`, never for the command `variance-authority-help`:
that is not a package name, and the registry reports it missing. Inside a
package script, `variance-authority-help` is the program name; an MCP `command`
must resolve the installed binary ([MCP](mcp.md#writing-the-client-config)).

The target needs no manifest at its root, no `workspaces` field and no build. A
repository that publishes nothing answers entirely from the exported half: every
name its own files export, with the file and the line. That is the usual shape
of a checkout that is not a monorepo, such as an application with its source in
one subdirectory, and there `search` is the only verb worth asking, because
`packages` and `entrypoint` have nothing to report.

## Names, then relations

`search` turns the words you have into candidate names. When the editor, ticket
or stack trace already gives you a path, pass it on that first search as a start
point (`--from`, `--to`; see `SKILL.md`). Then ask `symbol` for the chosen
name's contract, and `uses` for its exact import sites and worked examples.

This is a module graph, not a call graph. A site is an import. Never turn it
into a claim that one function calls another; open the file or ask a language
server. A member of an interface, a type literal or a class is never imported,
so `uses` names its declarations, after any imports, the lines that use each
one through a value whose type they write, and the declaration to ask its
language's type checker about for the rest.

Use the two tools together. `variance` answers from declarations, imports, the
module graph and the recording, and runs no type checker. Anything that needs a
value's type is the type checker's of the declaration's language: which type
an inferred value has, a generic, a subtype, the props a JSX attribute sets.
Take the `file:line` `variance` prints for a declaration to that language's
tooling (TypeScript's language service for JavaScript and TypeScript, the
language's own language server for any other) and ask it for find-references
or go-to-definition there.

## The verbs

### `packages`

Ask it when you have no exact specifier. A published specifier is each subpath a
`package.json` `exports` field opens, or, with no `exports`, the bare name its
`types` or `main` opens. It takes no argument and counts, one row per specifier:
the names it opens, how many anything imports, how many are documented. A
package that declares no entry gets an indented row with how many of its names
and files other packages import by path, and imports past a declared entry, deep
imports, are counted per package; a package's imports of itself are not. An
import by path names a file of a package that declares no entry, so there is no
entry for it to be past. A package whose declared entry this reading could not
follow to a source file, such as a build output the checkout does not hold,
opens nothing: it is counted apart, with the imports that name that entry, and
only an import past every entry it declares is deep. It lists no import site:
pass a specifier row whole to `entrypoint --package` for the names it opens,
and an indented row's package name to `entrypoint --package` for its count per
file. The answer ends with an `entrypoint` question for each of the
most-imported specifier, the package that declares no entry with the most names
imported by path, the package with the most imports past its entry, and, of the
packages whose entry this reading could not follow, the one with the most
imports past it, those the repository has. Asked by the name of a package whose
`exports` opens only subpaths, `entrypoint` lists the specifiers it opens in
place of the names of a main entry.

`packages` and `entrypoint` answer for the JavaScript half of a mixed
repository. The other verbs read the source and answer for every language: ask
`search` or `symbol` for a Python, Rust, Java, Kotlin or Swift name.

### `entrypoint`

`--package` takes the specifier as `packages` prints it, or the package name
with `--subpath` set to a key of its `exports` map; `--subpath .` is the package
name alone. Asked by the package name alone, the answer lists the names its main
entry opens, then counts the imports that reach past its entry, one row per
file: its specifier, how many names are taken from it and how many files import
it, the most imported first. A package that declares no entry opens nothing, and
the answer counts what other packages import from it by path the same way.
Asked by one of those specifiers, it counts the imports written as that
specifier per name, each name with how many files import it, the most imported
first; an import that takes no name, for its side effect or the module whole,
is counted on a row of its own. The answer ends with the narrower questions it
has, if any: asked by a package, the first row's specifier and `uses` on the
name the most files take through it; asked by a specifier, `uses` on its first
name, which lists that name's import sites.

### `symbol --name <name> [--package <name>] [--from <path>]`

The name is matched **exactly**. `--package` takes a package name or a
specifier, and only narrows: it answers from that package instead of from every
specifier that publishes the name.

A name nothing declares is answered on stdout, exit `0`: what was read and
declares nothing, and where else the name may be written. Over MCP it is the
same text, as a result rather than an error. Unless you pass
`--just-answer`, a generation reused from earlier is asked again with one made
now before the answer is given:

```
`NotAThing` is not published by this workspace, and no published name contains it; ask `search` with a word from its documentation. No file in this workspace declares `NotAThing`, at its top level or as a member. No installed dependency publishes it either. A name written only as text, in a string or a comment, declares nothing: a text search such as `rg` finds it.
```

When the dependency lexicon is not published, the answer still says what the
workspace holds, and that the installed dependencies were not checked:
``Whether an installed dependency publishes it is not known: the dependency
lexicon is not published, and the `variance index` command publishes it.`` When the source
index did not read some files' declarations, the answer says no file *it read*
declares the name, and names those files last.

Members are read from JavaScript and TypeScript files only. When the source
index holds files of another language, the answer says what was read, names
those languages and sends you to their language server:

```
`scan_things` is not published by this workspace, and no published name contains it; ask `search` with a word from its documentation. No file in this workspace declares `scan_things` at its top level, and no JavaScript or TypeScript file declares it as a member. No installed dependency publishes it either. Members are read from JavaScript and TypeScript files only, and this workspace's Python and Rust files were not read for them: if `scan_things` is a member there, ask their language server's workspace symbols for it, then its find-references on the declaration. A name written only as text, in a string or a comment, declares nothing: a text search such as `rg` finds it.
```

`uses` answers such a name with the same sentences, less the one about
installed dependencies. A member answer of `symbol` or `uses` ends with the
sentence about other languages as well, saying the member may be declared
``there too``.

A name no entry publishes, but that another package imports by the path of its
file, is answered rather than refused: where it is declared, why nothing
publishes it, and each import of it. A name a file exports and no entry
publishes is answered too: the file and line that export it, the line as the
checkout holds it, and how many imports the source index resolved to that file,
within its package as well as across. Two files that export one name are told
apart, each with its own count, and an installed name it matches, which a file
that passes it on exports without declaring, is said after it. A name a file
declares and does not export, at its top level or inside a function, is answered
from the source index, as below, after any export of the same name in another
file; one inside a function is answered with the function that holds it. A name
an import binds with `as` is answered with that import and the original it
names. A member of an interface, a type literal or a class is answered with its
container and the file and line that declare it, one block per declaration,
after every other declaration of the name. `Tree.has` asks for the member `has`
of `Tree` alone; when `Tree` is declared and no body read declares `has` on it,
the answer names `Tree`'s declaration and leaves what it inherits, and a
member of an enum, a namespace or an object literal, which the source index does
not read, to the go-to-definition of the language server for `Tree`'s language. `ask search` reads top-level
declarations only: a name declared inside a function is found by `ask symbol`.

`--package` with the path of one file in a package, such as
`@acme/lib/src/internal/math`, names the file an import of that specifier
resolved to. When nothing in the workspace imports the specifier, the file it
names is not known, and the answer says so.

An interface, a type alias or a class is followed by `Members:`, one row per
line that declares a member, as the checkout holds it. A member of a type
literal inside it belongs to the literal and is not listed, and a line the
signature already shows is not repeated.

A name a file only passes on with `export … from`, renamed, type-only, through
`export *` or as an import it exports again, is followed to the file that
declares it: the answer says `It passes on <name>, declared at <file>:<line>:`,
shows that line, and lists its members. The name is resolved the way an import
resolves it: the file's own export of the name first, then a named `export …
from`, then its stars, and no star passes `default`. Files that only pass the
name to each other name no declaration, and neither do two stars that reach
different declarations, a namespace (`export * as`, `import * as`), or a file
the source index holds no export list of and that does not declare the name.

`symbol` prints what a name is and how to call it. For why it exists and what it
connects to, read [what is written about a name](written-about-a-name.md).

### `uses`

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

The imports within the name's own package come from the source index: every
import that resolved to the file declaring it, or to a file that passes it on
with `export … from`, which is followed under the name it exports and is not
listed itself, in another package as well. `export type … from` passes a name
on the same way, and every import that comes through it is marked `(type only)`.
A name an entry publishes under another name than its declaration is read from
that entry. An import of a renamed re-export ends `(as <name>)`. A Rust path
written in a type or an expression, such as `crate::order::code_unit(…)`, is
listed as a `use` is. A package that passes a module on as `export * as ns`,
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

Each file that declares a name declares another thing, so `uses` answers for
every one of them, each kept apart: the published declaration's imports, a line
naming each file that exports the name without publishing it followed by that
declaration's own imports, and each file that keeps it to itself. `--file
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

A `--file` that declares nothing by the name is answered with the files that do.

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

### `search`

**A published line is `<specifier> · <name> [kind] …`, and the two halves go to
different arguments.** `symbol` takes the **name**, the word after the `·`. The
specifier before it is the import line you will write, and it goes to
`--package` when the same name is published from more than one place. So after
`@variance-authority/core/format · Viewport [interface] …` the next question is
`symbol --name Viewport`, not `symbol --name @variance-authority/core/format`. An
unpublished line has a `path:line` instead of a specifier, and the first paragraph
of its doc comment when it has one: open the file, or pass its name to
`symbol` and `uses`, which answer it from the source index.
A line under *declared … without being exported* is a name its file does not
export, matched by its name or its documentation: `symbol` gives its signature
and who can reach it, which is only that file in a JavaScript or TypeScript
module, its module in Rust, and any module that spells it in Python; `uses` says
the same in one line. CommonJS is read on a best-effort basis: the static keys
of an object literal that `export =` or `module.exports =` assigns at the top
level are the file's exports when every key is spelled, and a read off a
default import of it is marked "through `default`". A script or CommonJS file,
a module that hands itself out with `export =` and a `macro_rules!` are said to
have no recorded reach: their readers cannot tell how the file hands the name
out.
A file whose declarations were not read, such as one over the size a read
opens, is named under the answer, since the name may be declared there.

`variance index` also publishes a lexicon of the installed direct third-party
packages, and `search` reads it. Once that lexicon exists, every answer has a
third-party section, and prints a line when nothing in it matched. `symbol`
matches installed third-party declarations from the same lexicon, which is
`dependency-lexicon.bin` beside the source index. It is a binary file: ask
`search` and `symbol` for what it holds.

Nothing back means nothing matched, not that a ranking left it out. In a
checkout that publishes nothing, that is the final answer. The two sections that
follow an empty answer — names and files holding any of your words
by stem, in any order, in the name or its doc, whether published, exported,
declared and not exported, or a file by its name and the doc it opens with, the
ones holding the most of your words first, then the ones holding more of them
in the name, then the ones whose doc writes your phrase, every word any of
them holds held by a row shown; then names your words
reach loosely, exported or not, which takes a name holding fewer than half your
words when it reaches it by every one — are
suggestions, printed before the installed
packages: they never change the sections above them, and they do not find a word
the repository never writes. For that, expand the query as
`SKILL.md` describes under *Matching is lexical*.

**A start point removes names; it does not rank them down.** A path the
checkout does not have is refused by name, so you are never answered about the
whole repository without knowing it. An empty answer under a start point is a
fact about that area; ask again without it for the whole workspace.

`--format json` returns the same answer as data: specifier, file, line and
counts.

### `grep`

Use it when there is no name to ask for: a string literal, an error message, a
comment. It needs `--from` or `--to`, and searches the files that start point
reaches; for the whole checkout, run `rg`, which must be on `PATH` either way. Lines come grouped by how many imports away from the start point their
file is, then by path and line, each as `path:line:text`.

### `discover`

Use it when the answer is where two or more facts about a file meet: *a file
the nav reaches that makes a context with `theme` in its name*, or *the
declaration of `selectBalance` this component can actually reach*. Each operand
is a set of files, read whole with no cap, and the answer is the files in all
of them:

- `--from <path>[,...]`: what each path reaches along the imports; `--to`, what
  reaches each path. Two paths are two sets, crossed, not joined. Every import
  kind is walked, type-only ones included.
- `--to <file#name>`: what rests on one name out of a repo-relative file. The
  walk starts at the files that import that name, as `uses` lists them, through
  every barrel that passes it on, so a file importing another name through the
  same barrel is not reached; past them it walks by file.
- `--imports <module#name>[,...]`: who imports that name from that module, by
  the name the module publishes, so an aliased import still counts. The module
  is the specifier as written, where a package also covers its subpaths and a
  relative specifier only itself, or the repo-relative file it resolved to;
  `module` alone is any import of it. A name out of a repo-relative file is
  answered as `uses` answers it: an import through a barrel that passes the name
  on counts, and so does the barrel, and the header says how many passed it on.
- `--declares <regex>`: who declares a matching name, case-insensitive. An
  export of an imported name, with `export … from` or without, is declared where
  it comes from, not in the barrel; `export default function make()` declares
  `make`.
- `--path <regex>`: a pattern over repo-relative paths.
- `--except-from`, `--except-to`, `--except-imports`, `--except-declares`,
  `--except-path`: the same sets, taken out.
- `--text <pattern>`: ripgrep over the files the other sets kept, never over the
  checkout; a file with no matching line drops out.

```bash
variance ask discover --from src/TopNav.tsx --imports react#createContext --declares 'theme|user|account'
variance ask discover --from src/Wallet.tsx --declares '^selectBalance$'
variance ask discover --to src/store/selectors.ts#selectBalance
```

The answer counts each set first, then lists the files in all of them, nearest
the `--from` or `--to` paths first, each with the line that put it in each
set; `--path` puts it in by its name, with no line. A file two or more imports
away from a `--to` path carries one shortest chain of imports to it, a step
that is not a plain import marked — `src/Page.ts → src/Model.ts (type import) →
src/store/selectors.ts` — and for `file#name` the chain ends at the line that
imports the name. The `--to` header names the files it did not reach that
import something the scan could not resolve, since they may reach the path
through it. It shows 50; `--limit`
shows more, and the count is always of all of them. A source file whose names
the scan did not hand over is counted in the `--imports` and `--declares`
headers, since it is unknown rather than a file with no names; a README or a
manifest has none to read.
Over MCP, `docs_discover` answers `from`, `to`, `path` and `--imports` of a
name out of a repo-relative file, and refuses `declares` and any other
`imports`: the reading an MCP host serves holds no names.

### `intersection`

Use it when each fact is already a question you could ask alone, and the
answer is the files all of them agree on: *the declaration of `selectBalance`*
is `symbol`, *what the wallet reaches* is `discover --from`, and the one
declaration the wallet can reach is the file both answer. Each operand is a
whole question, typed in quotes the way it would be asked alone, and any
question whose answer is a set of files can be one: `symbol`, `uses`,
`search`, `grep`, `discover`.

```bash
variance ask intersection 'symbol --name selectBalance' 'discover --from src/Wallet.tsx'
variance ask intersection "uses --name useTheme" "grep --query 'dark mode' --from src/App.tsx"
```

Each question is read whole, never capped: asked alone, each prints its first
fifty, and the file two questions agree on can sit past the cap of either. The
answer counts each question's files first, then lists the files in all of
them, each with the lines that put it in each question, or `the file` when a
question answers a file without a line. It shows 50; `--limit` shows more, and
the count is always of all of them. `--changed-file`, `--taint-file` and
`--just-answer` are said once, after `intersection`, outside the quotes: every
question is answered over one reading.

A question about a name nothing declares answers no file: the answer says so
beside that question, with what was read, and that no file is in all of them,
on stdout with exit `0`, as the question alone would.

A question whose answer is not a set of files — `packages`, `stack`, another
`intersection` — is refused with the questions that are, and so is a question
about a run. Crossing `discover`'s own sets is cheaper asked as one `discover`.

### `gaps`

A work queue of undocumented names other packages import, not an answer about
one name.

## Read the answer literally

- A name with no comment above it is reported as having none: `UNDOCUMENTED` in
  the one-line listings. Where the nearest `README.md` above the declaration
  writes the name as a whole word, that passage comes back labelled with its
  file and line. It is prose about a package, not a description of the
  signature, and the name still counts as a gap. Do not repeat it as if it were
  documentation.
- A consumer is a workspace package whose source imports the name. It is no
  evidence that anything ran.
- Nothing here reads `dist`. A `types` target under an output directory is
  mapped back to the source it was compiled from.
- `search`, `grep`, `discover` and `intersection` cap each list and print how many rows they did not show. A
  list with no such line is the whole list.
