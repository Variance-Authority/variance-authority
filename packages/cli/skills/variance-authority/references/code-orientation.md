# Find coding start points

Choose one question from the skill's
[Questions about the code](../SKILL.md#questions-about-the-code) table, using
the most concrete input the task supplies.

The source is the files the index parses — JavaScript and TypeScript,
stylesheets, Python, Rust, Java, Kotlin and Swift — and any other file one of
them imports. `symbol`, `uses` and `search` answer from the declarations in the
first; `grep` searches both, along the imports from its start point. A YAML,
JSON, Markdown or shell file nothing imports is outside the source, and an empty
answer says nothing about it: search it with `rg` or `git grep` alongside
`variance`, not after `variance` comes back empty.

Framework file formats and bundler-only aliases are not read yet. A Vue or
Svelte single-file component is not parsed, so nothing it declares or imports is
answered: search it with `rg` too. The files an Angular component names in
`templateUrl` and `styleUrls` are not linked to it, and an import through an
alias declared only in a bundler's configuration, such as webpack's or Vite's
`resolve.alias`, resolves to no file, where one declared as `paths` in a
`tsconfig` does. [The source scan's
limits](https://variance-authority.dev/docs/source#limits) say what each leaves
out.

`search` turns the words you have into candidate names. When the editor, ticket
or stack trace already gives you a path, pass it as a start point (`--from`,
`--to`; see [the shared scope rules](../SKILL.md#rules-every-answer-shares)). Read a plausible owner's named lines before another
search; ask `symbol` when you need its contract, or `uses` for its import sites.

Directory membership, import reach and runtime loading answer different
questions. `discover --path <regex>` selects paths; `--from` and `--to` follow
imports at any depth, including type imports. Cross those relations with a declaration or
path predicate for the responsibility you still need. For matching text in only
one known file, combine its exact path with `--text`:

```bash
variance ask discover --path '^src/PriceCard[.]tsx$' --text 'onComplete|error'
```

A task's quoted UI label or error message is source text: try scoped `grep`
for it before expanding the request into name queries. A matching line names a
candidate; read it before deciding it owns the requested behavior.

For example, find an example that transitively imports a component, then a
mock that example reaches:

```bash
variance ask discover --to src/PriceCard.tsx --path '(^|/)(examples|stories)/' --limit 6
variance ask discover --from examples/PriceCard.examples.tsx --path '(^|/)mocks/' --limit 6
```

Use the actual example path returned by the first question in the second.
The mock need not import the component: those are two legs of the graph.
For importers of a known name inside one area, through re-exports too, cross
`--imports` with `--path`, rather than listing every importer with `uses`:

```bash
variance ask discover --imports src/currency/codes.ts#CURRENCY_CODES --path '^src/currency/' --limit 6
```

Keep the full `uses` inventory when changing a name's contract; use
`discover` to select related code while orienting. A loader naming a transform as a path string creates no
import edge: ask scoped `grep` for that string. For a data-shape change, inspect
the example or fixture representing the requested state as well as the code
that consumes it. An import alone proves neither that state nor its behaviour.

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

For a question's complete flags and limits, read its section in the
[workspace API](workspace-api.md#the-verbs).
