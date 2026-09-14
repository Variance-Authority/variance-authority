---
name: variance-workspace-api
description: Use when you need what a TypeScript workspace publishes — where a symbol is declared, what it is documented as, who imports it, and the stories, tests and call sites that already use it.
---

# Workspace public API

`variance-authority-help` serves one workspace's published surface over MCP. It
reads manifests and TypeScript source on every request, so an answer describes
the checkout as it is now, not a build and not a generated site.

Use it for the question *what does this repository publish, and how is it already
used here*. What a library on npm is supposed to be is a different question, and
one of its docs is the place to ask it.

## Connect it

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

`.` is the server's working directory; pass an absolute path when the client
starts somewhere else.

## Ask in order

1. **`docs_packages`** — every import specifier the workspace publishes, with how
   heavily used and how well documented each one is. It takes no argument and it
   returns the input every other tool takes, so start here when you do not
   already hold an exact specifier.
2. **`docs_entrypoint`** — the names one specifier opens, most-imported first.
3. **`docs_symbol`** — one name: the line you would write to import it, where it
   is declared, its signature, and what the source says above it.
4. **`docs_uses`** — where the repository already writes that name.
5. **`docs_search`** — a case-insensitive substring over names and docs, for a
   name you can only describe. Nothing back means nothing matched, not that the
   ranking disagreed; `docs_entrypoint` is the cheap next move.
6. **`docs_gaps`** — names other packages import with nothing written above the
   declaration. A work queue, not an answer to a question about one symbol.

## Two different questions about one name

`docs_symbol` answers what a name is *supposed* to be: the signature, and the
block comment somebody wrote above it. `docs_uses` answers how it is *actually*
written here, off the imports, which is the answer a stale doc comment cannot
spoil. Ask the second whenever you are about to write a call and the signature
alone leaves a choice open.

```
docs_uses  name=digestValue  from=packages/cli/src/run.ts
```

Pass `from` — the file you are editing — and the sites come back ordered by how
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

The integration reference is
`https://variance-authority.dev/reference/packages/help`; the routing across the
other entrances is at `https://variance-authority.dev/agents/questions`.
