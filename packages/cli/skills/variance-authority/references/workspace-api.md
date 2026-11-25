# What a workspace publishes, and where a name is used

Ten questions read a workspace's manifests and source: `packages`,
`classify`, `entrypoint`, `symbol`, `uses`, `search`, `grep`, `discover`, `intersection`
and `gaps`. Each answer reads from a workspace generation and names its UTC
time. They describe source, not a build or a generated site, and they need no
run and no config. For where a file
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
variance-authority-help search viewport --from packages/app/
```

On `variance ask` every argument is a flag, and bare `variance ask`
prints each question's flags and what it answers. On `variance-authority-help`
the first argument is positional.

## Before the first question

- **Node.** The version the installed package declares in `engines`.
- **One of the two binaries.** `@variance-authority/cli` provides `variance ask`;
  `@variance-authority/help` provides `variance-authority-help`.
- **A published generation.** `variance index` publishes one. Run it once
  before the first question, and again after you edit files: edit, run
  `variance index`, then ask. A question answers from the generation that is
  published, at any age, and never reads the checkout to bring it up to date;
  only a text match, in `grep` and `discover --text`, reads files as they are on
  disk now. It
  does not check which files changed, and it writes no index. Every answer and
  refusal says when that generation was made and that it may miss later
  changes; as JSON, `search` gives `compared: false`. With no
  generation, a question refuses in one line that names `variance index`.
  `--changed-file` and `--taint-file` are the one exception: they name the paths
  a watcher already has, and the question updates the generation from them
  before it answers.
- **No run, no config, no revision requirement.**
- **Working directory.** `variance ask` reads the index published for the
  checkout under the working directory, so run it from the workspace root; it
  refuses `--root`.
  `variance-authority-help` takes `--root <dir>`.

The timestamp is part of the answer. If you edited a file the answer names
after that time, run `variance index` and ask again.

The MCP server is different, because it stays up across your edits. It reuses
a generation for up to one hour, reads one `variance index` published since,
and asks a `symbol`, `uses` or `docs_search` again of a generation made now when
a file that answer names changed after its generation. Start it with
`--just-answer` when CI, an editor or a watcher publishes generations, so a
call reads only the last one; [MCP](mcp.md) has the details.

## Two argument shapes on `variance-authority-help`

`--root` is for the **verbs**. The other two forms take the root as a **bare
positional**:

```
variance-authority-help <verb> [argument] [--root <dir>]
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
package script, `variance-authority-help` is the program name; an MCP entry
launches it through `npx` ([MCP](mcp.md#writing-the-client-config)).

The target needs no manifest at its root, no `workspaces` field and no build. A
repository that publishes nothing answers entirely from the exported half: every
name its own files export, with the file and the line. That is the usual shape
of a checkout that is not a monorepo, such as an application with its source in
one subdirectory, and there `search` is the only verb worth asking, because
`packages` and `entrypoint` have nothing to report.

## Names, then relations

Choose a question from the skill's
[Questions about the code](../SKILL.md#questions-about-the-code) table.
For a feature task, [Find coding start points](code-orientation.md) explains
how to use concrete source text and import relations. The sections below
specify each question's arguments and limits.

## The verbs

### `packages`

Read [packages](workspace-packages.md) for its arguments and answer contract.

### `classify --query <words>`

Read [classify](workspace-classify.md) for its arguments and answer contract.

### `entrypoint`

Read [entrypoint](workspace-entrypoint.md) for its arguments and answer contract.

### `symbol --name <name>[,...] [--package <name>] [--from <path>] [--line <file>:<line>] [--limit <n>]`

Read [symbol](workspace-symbol.md) for its arguments and answer contract.

### `uses`

Read [uses](workspace-uses.md) for its arguments and answer contract.

### `search`

Read [search](workspace-search.md) for its arguments and answer contract.

### `grep`

Read [grep](workspace-grep.md) for its arguments and answer contract.

### `discover`

Read [discover](workspace-discover.md) for its arguments and answer contract.

### `intersection`

Read [intersection](workspace-intersection.md) for its arguments and answer contract.

### `gaps`

Read [gaps](workspace-gaps.md) for its arguments and answer contract.

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
- `grep`, `discover`, `intersection`, `uses` and `symbol` cap each list and print how many rows they did not show. A
  list with no such line is the whole list. `search` caps and counts the same way, but a list with no
  such line can still leave out matches, as [`search`](#search) says.
