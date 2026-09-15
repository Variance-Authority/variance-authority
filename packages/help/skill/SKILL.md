---
name: variance-workspace-api
description: Use when you need what a TypeScript workspace publishes — where a symbol is declared, what it is documented as, who imports it, and the stories, tests and call sites that already use it.
---

# Workspace public API

`variance-authority-help` reads a workspace's manifests and TypeScript source and
answers what it publishes. Every answer describes the checkout as it is now, not
a build and not a generated site.

Use it for the question *what does this repository publish, and how is it already
used here*. What a library on npm is supposed to be is a different question, and
one of its docs is the place to ask it.

## Ask

Run a verb. `@variance-authority/help` is a dependency of the workspace, so the
binary is already on the path:

```bash
variance-authority-help search viewport
```

If the command is not found, the workspace does not depend on the package yet.
Add it once — `yarn add -D @variance-authority/help` — where you will ask more
than once.

Add `--root <dir>` when you are not standing in the workspace.

## Ask about a repository that does not depend on it

```bash
npx @variance-authority/help search session --root ../shadow
```

Ask `npx` for the package — `@variance-authority/help` — never for the command
`variance-authority-help`, which is not a package name and will be reported as
missing from the registry.

The target needs no manifest at its root, no `workspaces` field and no build. A
repository that publishes nothing answers entirely out of the exported half:
every name its own files hand out, with the file and the line. That is the usual
shape of a checkout that is not a monorepo — an application with its TypeScript
in one subdirectory — and it is the case where `search` is the only verb worth
asking, because `packages` and `entrypoint` have nothing to report.

The index is kept per checkout under `~/.cache/variance-authority/`, outside the
tree being read, so it survives a throwaway install and nothing is written into
somebody else's repository.

## The six verbs, in the order to ask them

1. **`packages`** — every import specifier the workspace publishes, with how
   heavily used and how well documented each one is. It takes no argument and
   returns the argument every other verb wants, so start here unless you already
   hold an exact specifier.
2. **`entrypoint <package> [subpath]`** — the names one specifier opens,
   most-imported first.
3. **`symbol <name>`** — the line you would write to import it, where it is
   declared, its signature, and what the source says above it.
4. **`uses <name> [--from <file>]`** — where the repository already writes it.
5. **`search <substring>`** — case-insensitive, over names and over docs, for a
   name you can only describe. It answers in two sections: published names
   first, each with the specifier to pass to `symbol`, then the names the
   repository exports somewhere without publishing them, each with a file and a
   line to open. The second section is much the larger one — most code here was
   never something to publish — so a thing you cannot find on the surface is
   usually in it. Nothing back means nothing matched, not that a ranking
   disagreed; `entrypoint` is the cheap next move.
6. **`gaps`** — names other packages import with nothing written above the
   declaration. A work queue, not an answer about one symbol.

## Two different questions about one name

`symbol` answers what a name is *supposed* to be: the signature, and the block
comment somebody wrote above it. `uses` answers how it is *actually* written
here, off the imports, which is the answer a stale doc comment cannot spoil. Ask
the second whenever you are about to write a call and the signature alone leaves
a choice open.

```bash
variance-authority-help uses digestValue --from packages/cli/src/run.ts
```

Pass `--from` — the file you are editing — and the sites come back ordered by how
many leading path segments they share with it, nearest first. That is proximity
on the filesystem. How far one module sits from another through the import graph
is a different reading, and it belongs to `variance-test-selection`.

The answer separates the files written to *show* the name — stories and tests —
from the source that depends on it. Read the stories first: a story is somebody's
worked example of the same call you are about to write.

Sites arrive as `path:line`, not as text. Open them. What you read then is the
file as it is, rather than a copy taken when the reading was.

## Read the answer literally

- A name with no block comment is reported as having none. Where the nearest
  `README.md` above the declaration writes the name as a whole word, the passage
  comes back labelled with its file and line. That is prose written about a
  package, not a description of the signature above it, and the name still counts
  as a gap. Do not repeat it as if it were documentation.
- A consumer is a workspace package whose source imports the name. It is not a
  claim that anything ran.
- A site is an import, not a call. Where the name is used inside that file is a
  question for a language server.
- Nothing here reads `dist`. A `types` target under an output directory is mapped
  back to the source it was compiled from.

## Over MCP instead

A client that holds a connection open all session can list the same six as
tools — `docs_packages`, `docs_entrypoint`, `docs_symbol`, `docs_uses`,
`docs_search`, `docs_gaps` — taking the same arguments.

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

The integration reference is
`https://variance-authority.dev/reference/packages/help`; the routing across the
other entrances is at `https://variance-authority.dev/agents/questions`.
