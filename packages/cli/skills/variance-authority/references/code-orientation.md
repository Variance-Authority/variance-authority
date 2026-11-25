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

## Combine text clues

When the task names a product label and a version or state value, try their
text together before looking for declaration names. You need not know that
either appears in source yet; these are query inputs, not verified code facts.
Cross the two source-text questions:

```bash
variance ask intersection 'grep --query "Acme Chat" --from src/' 'grep --query "v7" --from src/'
```

Use the task's wording. Single-quote each whole question and double-quote its
text clue, as above, so the shell preserves regex escapes. For example,
`'grep --query "Cost \$5" --from src/'` matches the literal text `Cost $5`.
If the pair finds no owner, give the task's text to `classify`. An
intersection identifies candidate files, not the feature's whole implementation.
Read the named owner, then use its import relationships for the remaining roles; an example or mock need not contain both text clues.

## Follow the owner

`search` turns the words you have into candidate names. When the editor, ticket
or stack trace already gives you a path, pass it as a start point (`--from`,
`--to`; see [the shared scope rules](../SKILL.md#rules-every-answer-shares)). Read a plausible owner's named lines before another
search; ask `symbol` when you need its contract, or `uses` for its import sites.

After a near match, the printed `Next:` is a lexical suggestion, not verified
task ownership. If a broad `--declares 'Client|Server|Handler'` mixes unrelated
responsibilities, narrow it with an observed name or role before expanding it.

When you have both a feature file and an implementation file, combine `--from`
and `--to` to find the files on import paths between them:

```bash
variance ask discover --from src/PriceCard.tsx --to src/pricing/price.ts
```

The answer includes connecting barrels and shows import chains for files two or
more imports from the target. To start the reverse walk at import sites of one
export, use `--to 'src/pricing/price.ts#calculatePrice'`. The walk then follows
imports by file, so later rows need not import that name. Use the file target
when you need the connecting paths regardless of which name each import uses. See
[the operands and chain format](workspace-discover.md).

For consumers inside one observed area, cross reverse imports with path membership:

```bash
variance ask discover --to src/pricing/price.ts --path '^src/checkout/' --limit 6
```

Read the returned source to establish how it uses the value. An empty
intersection does not rule out a runtime consumer: dependency injection can
leave no corresponding import path.

## Choose directory membership or import reach

`grep --from src/pricing/` searches files under that path and files
reachable through their imports. A match in `src/shared/` answers that import
question. For text only under the observed directory, select path membership:

```bash
variance ask discover --path '^src/pricing/' --text 'roundingMode|precision'
```

For one known file, anchor both ends and escape regex metacharacters in its path:

```bash
variance ask discover --path '^src/PriceCard[.]tsx$' --text 'onComplete|error'
```

Text is read live; membership comes from the published index. Check the
[answer's notes](workspace-discover.md) for unresolved imports or ripgrep errors
before interpreting an empty intersection.

Directory membership, import reach and runtime loading answer different
questions. `discover` walks imports, including type imports; `grep` also searches
the modules a test loads for real beside its mocks, as its
[contract](workspace-grep.md) describes.

A quoted UI label or error is source text: use scoped `grep`. If its exact
wording misses, retry a distinctive fragment in the same scope before name
queries. Escape regex metacharacters in literal text, such as `Failed \(retry\)`;
see the [grep contract](workspace-grep.md). A matching line names
a candidate; read it before deciding it owns the requested behavior.

## Find an example and its mock

Find an example that transitively imports a component, then a
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

For a question's complete flags and limits, follow its link in the
[source-question table](../SKILL.md#questions-about-the-code).
