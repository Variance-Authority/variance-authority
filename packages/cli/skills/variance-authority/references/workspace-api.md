# What a workspace publishes, and where a name is used

Seven questions read a workspace's manifests and source: `packages`,
`entrypoint`, `symbol`, `uses`, `search`, `grep` and `gaps`. Each answer names
the UTC time of the workspace generation it used. They describe source, not a
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
names the installed binary by its path ([MCP](mcp.md#writing-the-client-config)).

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
server.

## The verbs

### `packages`

Start here unless you already have an exact specifier. A published specifier is
each subpath a `package.json` `exports` field opens, or, with no `exports`, the
bare name its `types` or `main` opens. `packages` and `entrypoint` answer for
the JavaScript half of a mixed repository. The other verbs read the source and
answer for every language: ask `search` or `symbol` for a Python, Rust, Java,
Kotlin or Swift name.

### `entrypoint`

`--package` takes the specifier as `packages` prints it, or the package name
with `--subpath` set to a key of its `exports` map. A package that declares no
entry opens nothing, and the answer lists the files and names other packages
import from it by path, each with the importer's file and line.

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
publishes it, and each import of it. A name that is exported without being
published and that nothing imports is still refused, and the refusal names the
file and line that export it.

`symbol` says what a name is and how to call it. For why it exists and what it
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
`PagesOptions` is published and nothing in this workspace imports it. docs_symbol has its signature and what is written above it.
```

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
unpublished line has a `path:line` instead: there is nothing to pass to
`symbol`, so open the file.

`variance index` also publishes a lexicon of the installed direct third-party
packages, and `search` reads it. Once that lexicon exists, every answer has a
third-party section, and says when nothing in it matched. `symbol` matches
installed third-party declarations from the same lexicon. The full signatures
and JSDoc are in `dependency-lexicon.json` beside the source index.

Nothing back means nothing matched, not that a ranking disagreed. In a checkout
that publishes nothing, that is the final answer. The loosely matching section
is a suggestion: it never changes the sections above it, and it does not find a
word the repository never writes. For that, expand the query as `SKILL.md`
describes under *Matching is lexical*.

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
- A consumer is a workspace package whose source imports the name. It is not a
  claim that anything ran.
- Nothing here reads `dist`. A `types` target under an output directory is
  mapped back to the source it was compiled from.
- `search` and `grep` cap each list and say how many rows they did not show. A
  list with no such line is the whole list.
