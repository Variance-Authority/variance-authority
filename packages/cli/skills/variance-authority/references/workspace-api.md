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
  published generation for up to one hour. `--just-answer` uses the last
  generation without inspecting the checkout, and refuses when none exists.
  `search` always reads that way, with or without the flag, and never scans.
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
`uses` takes no `--form`; it takes: name, package, from
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
so `uses` names its declarations, after any imports, and the `grep --to` that
finds its callers.

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

A miss is a refusal on stderr. `variance ask` exits `2`;
`variance-authority-help` exits `1`:

```
`NotAThing` is not published by this workspace, and no published name contains it; ask `search` with a word from its documentation.
```

A name no entry publishes, but that another package imports by the path of its
file, is answered rather than refused: where it is declared, why nothing
publishes it, and each import of it. A name a file exports and no entry
publishes is answered too: the file and line that export it, the line as the
checkout holds it, and how many imports the source index resolved to that file,
within its package as well as across. Two files that export one name are told
apart, each with its own count, and an installed name it matches, which a file
that passes it on exports without declaring, is said after it. A name a file
declares and nothing exports is answered from the source index, as below; a
name nothing declares is refused.

`--package` with the path of one file in a package, such as
`@acme/lib/src/internal/math`, names the file an import of that specifier
resolved to. When nothing in the workspace imports the specifier, the file it
names is not known, and the name is refused with that reason.

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
`PagesOptions` is published and nothing in this workspace imports it; a read through an `export * as` namespace and a call through a qualified path are not counted. docs_symbol has its signature and what is written above it.
```

The imports within the name's own package come from the source index: every
import that resolved to the file declaring it, or to a file that passes it on
with `export … from`, which is followed under the name it exports and is not
listed itself, in another package as well. A name an entry publishes under
another name than its declaration is read from that entry. An import of a renamed re-export ends `(as <name>)`. A read
through an `export * as` namespace, and a call through a qualified path, such as
Rust's `crate::order::code_unit(…)`, are not listed, and the answer ends by
saying so. With `--package` naming one subpath specifier, an import through
another specifier of the same package is left to that one. When the source
index is missing or does not read, the imports from other packages by their
published path are still listed, and the answer says why the rest are not.

A name a file exports and no entry publishes is answered from the source index
alone, the same way. The first line names where it is exported:

```
`roundTax` is imported in 1 place, and no entry publishes it; it is exported at packages/lib/src/internal/math.ts:5.
```

A method or property of an interface, a type literal or a class is never
imported: code reaches it through a value, `scanner.resolveSources(…)`. `uses`
lists where each member by that name is declared, each line ending with the
container it is on, and names the search that finds its callers. For a name no
export has, that is the whole answer:

```
`resolveSources` is no exported name; it is a member, declared in 1 place:
Path order; `from` sorts nearest first.

Member declarations:

packages/sense/src/native.ts:234 — NativeScanner

Its callers are text in the files that import a declaration: docs_grep with `query` `\bresolveSources\b` and `to` `packages/sense/src/native.ts`.
That search matches text, as no type checker runs: it lists comments, strings, a call by key such as `entry('name')` and same-named members of other types in those files, and misses a value whose type comes in through a file that does not import the declaration.
```

Run it as `variance ask grep --query '\bresolveSources\b' --to
packages/sense/src/native.ts`. A value of the member's type comes from a file
that imports the declaration, at any depth, so that is where the search looks.
When several files declare the name, pass the one whose container you mean.
A name that an export has as well, such as a wrapper function named like the
member, lists the wrapper's imports first, then `` `prepareJourneys` is a member
too, declared in 2 places: `` and the declarations with their route. Ask a
language server when you need the callers proven against one type.

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
unpublished line has a `path:line` instead of a specifier: open the file, or
pass its name to `symbol` and `uses`, which answer it from the source index.
A line under *declared … without being exported* is a name its file does not
export, matched by its name or its documentation: `symbol` gives its signature
and who can reach it, which is only that file in a JavaScript or TypeScript
module, its module in Rust, and any module that spells it in Python; `uses` says
the same in one line. A script or CommonJS file and a `macro_rules!` are said to
have no recorded reach: their readers cannot tell how the file hands the name out.
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
follow an empty answer — names holding at least half of your words by stem, then
names your words reach loosely — are suggestions, printed before the installed
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
  reaches each path. Two paths are two sets, crossed, not joined.
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
```

The answer counts each set first, then lists the files in all of them, nearest
the `--from` or `--to` paths first, each with the line that put it in each
set; `--path` puts it in by its name, with no line. It shows 50; `--limit`
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
