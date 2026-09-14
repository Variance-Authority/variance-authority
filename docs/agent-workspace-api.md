# Inspect the workspace public API

Use the workspace API server when an agent needs the name, import path,
signature, documentation, package consumers, or call sites of an exported
TypeScript symbol. It reads the current checkout on every request; no build or
generated API site stands between the question and the source.

## Point the server at the workspace

Use Node 22 or newer. Install the package in the TypeScript workspace:

```bash
npm install --save-dev @variance-authority/help
```

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
ranking. The package reference owns the remaining maintenance and generated-page
questions; they are not prerequisites for inspecting one public symbol.

## Interpret the answer at its boundary

The server reads manifests and TypeScript module records, not `dist`. A types
target under an output directory is mapped back to that package's source. A
consumer is a workspace package whose source imports the symbol; it is not a
claim about runtime execution or external adoption.

Missing documentation remains missing, and a search with no exact substring
match returns no substitute. Those absences are source facts, not prompts for
the server to infer an answer.

Where nothing is written above a declaration, the server may quote the nearest
`README.md` that names the symbol, labelled with the file and line it came from.
Read it as prose written about a package, not as a description of the signature
above it: the name still counts as undocumented in `docs_gaps`.

Proximity in `docs_uses` is shared path segments, a fact about the filesystem.
Import distance through the module graph is
[`@variance-authority/sense`](distance.md).

## Point an agent at it

For Codex, install the `variance-workspace-api` skill from this repository:

```text
$skill-installer install https://github.com/Variance-Authority/variance-authority/tree/main/packages/help/skill as variance-workspace-api
```

Invoke it as `$variance-workspace-api`, or let Codex select it when a question
is about what this workspace publishes. Installing `@variance-authority/help`
supplies the server and the same skill source; registering the skill is a
separate step.

The full tool and source-reading contract lives in the
[`@variance-authority/help` package reference](../packages/help/README.md).
Continue with the repository's [package boundaries and public
contracts](architecture.md#packages) when the answer raises an ownership or
entrypoint question.
