# Inspect the workspace public API

An agent that cannot see your workspace invents import paths and guesses
signatures. This server hands it the real ones, read out of the checkout as it
stands: what each package publishes, where a name is declared, what is written
above it, and every file that already imports it — no build step and no generated
API site in between. It answers from source, so no run and no
`variance.config.json` need exist.

## Point the server at the workspace

Use Node 22 or newer. Install the package in the TypeScript workspace:

```bash
npm install --save-dev @variance-authority/help
```

The package installs a `variance-authority-help` binary, which answers the same
questions on the command line, with no client and no server:

```bash
npx @variance-authority/help search viewport --root .
```

Pass the package name to `npx`, not the binary name: `variance-authority-help`
is not a package name and the registry will report it missing. `--root` is the
workspace to read; omit it when you are standing in that workspace.

A workspace that already has `@variance-authority/cli` installed needs neither
this package nor its binary. The six questions are on `variance ask`, beside
the questions about a run, and read the checkout under the working directory:

```bash
npx variance ask search --query viewport
npx variance ask symbol --name Viewport
```

The flags are the tool arguments, spelled `--name`, `--package`, `--subpath`,
`--query`, `--from` and `--to`. [Ask a run from the command
line](agent-cli.md#ask-the-code-when-the-name-is-not-in-the-run) shows each one.

Configure the MCP client to launch the server with the workspace root:

```json
{
  "mcpServers": {
    "workspace-api": {
      "command": "variance-authority-help",
      "args": ["."]
    }
  }
}
```

Here `.` is the server process's working directory. Pass the workspace's
absolute path when the MCP client launches outside it. The configured command
must resolve the installed package binary.

## Read from entrypoint to symbol

Call `docs_packages` first. It returns the package import specifiers the
workspace publishes, derived from its manifests, and gives the remaining calls
an exact entrypoint.

Choose one specifier and call `docs_entrypoint` to see the names it opens,
ranked by how many workspace packages import them. Then call `docs_symbol` for
the import line, declaration, signature, source documentation, and importing
packages of the name you are investigating.

Call `docs_uses` when the question is how the name is written here rather than
what it claims to be. It returns the file and line of every import, with the
stories and the tests — the files written to show the name in use — listed apart
from the source that depends on it. Pass `from` with the file you are editing and
the sites arrive ordered by how many leading path segments they share with it.

Open those files yourself. The server names the place and the line; it does not
serve the text, so what you read is the file as it is now.

Use `docs_search` only when the name is unknown: it performs a
case-insensitive substring match over names and documentation, not semantic
ranking. Where your words land on a name that does not contain them — a word
typed wrong, or two words written about a name but not beside each other — those
names follow under a heading of their own, after the substring answer and never
inside it.

## Bound a search to where you are working

A substring matches everywhere a large repository writes a common word. Pass a
start point and `docs_search` answers only from one part of the checkout:

```text
docs_search  query: order  from: src/fulfilment/
```

`from` answers from the files that path reaches along the imports, at any depth.
`to` answers from the files that reach it — use it when you hold a helper and
want the screens or callers behind it. Pass both and you get both areas
together; they are combined, not intersected, because two entry points of one
application usually share no file.

A start point is a path in the source tree, at one of three widths:
`src/a/File.ts` is that file, `src/a/*` is that folder's own files, `src/a/` is
everything under it. The path is compared from the repository root down, segment
for whole segment, case included. A path the checkout does not hold is refused
by name; you never receive an unscoped answer under a scoped heading.

Scoping removes names rather than ranking them down. An empty answer with a
start point is a fact about that area, and the answer reports how many files it
searched. Ask again without `from` and `to` to search the whole workspace.

The same start points are available from the shell:

```bash
variance-authority-help search order --from src/fulfilment/
```

## What the answer claims, and what it does not

The server reads manifests and TypeScript source, not `dist`. It parses with
`oxc-parser` and resolves with `oxc-resolver`; no TypeScript language service
runs behind it. A types target under an output directory is mapped back to that
package's source. A consumer is a workspace package whose source imports the
symbol; it is not a claim about runtime execution or external adoption. A site
is an import of the name, not a call to it — where the name is used inside that
file is a question for your editor's language server.

Missing documentation remains missing, and a search with no exact substring
match says so before it offers anything near it. Those absences are source
facts, not prompts for the server to infer an answer: a looser reading of your
own words can add names below the answer, and nothing can promote one into it.

Where nothing is written above a declaration, the server may quote the nearest
`README.md` that names the symbol, labelled with the file and line it came from.
Read it as prose written about a package, not as a description of the signature
above it: the name still counts as undocumented by `docs_gaps`, the
call that lists names other packages import with nothing written above the
declaration.

`from` means two different things across the two tools, so read each one for
what it does. On `docs_uses` it orders and never removes: every site of the name
still comes back, and proximity there is shared path segments, a fact about the
filesystem. On `docs_search` it is a start point: the import graph is walked and
names outside the closure are removed.

Neither is a distance. How many hops separate two modules, and what selecting on
that distance costs, is [`@variance-authority/sense`](distance.md).

## Point an agent at it

The skill that drives these calls ships inside the package. After
`npm install --save-dev @variance-authority/help`, its source is on disk at
`node_modules/@variance-authority/help/skill`, and the same directory is
published at
<https://github.com/Variance-Authority/variance-authority/tree/main/packages/help/skill>.

Installing the package supplies the server. Registering the skill with your
agent is a separate step. For Codex:

```text
$skill-installer install https://github.com/Variance-Authority/variance-authority/tree/main/packages/help/skill as variance-workspace-api
```

Invoke it as `$variance-workspace-api`, or let Codex select it when a question
is about what a workspace publishes.

The full tool and source-reading contract is in the
[`@variance-authority/help` package
reference](https://variance-authority.dev/reference/packages/help). When the
answer raises an ownership or entrypoint question, continue with [package
boundaries and public contracts](architecture.md#packages).
