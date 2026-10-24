---
'@variance-authority/mcp': minor
'@variance-authority/help': patch
'@variance-authority/cli': minor
---

A hint names what you can type where you asked

An answer's hints were spelled for one surface and printed on both. Each is
now spelled for the surface that asked:

- From a shell, `variance ask` and `variance-authority-help` name an input as
  its flag (`--limit`, `--query`, `--from`), a tool as the command that runs it
  (`variance ask symbol`), and a whole question, such as the `grep` that finds
  an underscored name, as the command line that asks it.
- Over MCP, the same hints use the wire's names: the input `limit`, the tool
  `docs_symbol`, and a question as the tool with its inputs. This covers the
  `search` and `grep` hints, the `--package` refusal, the operands an
  `intersection` names, and the line every listing (`costs`, `run_signals`
  among them) adds for the rows it left out. A `limit` refused from a shell
  names `--limit`, and over MCP names `limit`.

The lexicon line of `symbol` names `variance index` as the command that
publishes the dependency lexicon, on both surfaces.

A tool invocation carries the shell it was asked from as `shell`.
`@variance-authority/mcp/tools` exports the one spelling every surface uses:
`spellingOf`, `verbOf`, `flagOf` and the `Spelling` type. `limitOf` and
`notShown` take a `Spelling`. The CLI's `questionOf` is removed; `verbOf`
replaces it.

`Spelling` and `verbOf` take a declared tool — its name, description and input
schema — so a hint cannot be spelled from a tool name written as a string, and
renaming a tool fails the build of every hint that names it.
