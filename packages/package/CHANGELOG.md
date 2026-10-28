# @variance-authority/package

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.19.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.18.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.0

### Patch Changes

- dfd5c06: An `import()` type is a type-only import

  `import('./x').T` and `typeof import('./x')` are TypeScript's other spelling of
  `import type`, and the reader skipped both: a file that reached a module only
  through one, such as a test handing `typeof import('./x')` to a `vi.mock`
  factory's original, had no edge to it, and `ask uses` did not list it. Each is
  now a `type` request, an edge every walk but a runtime one follows. The name its
  qualifier starts with is the name it takes; with no qualifier the module is
  held whole, and `ask uses` lists the line as a type-only site that may read any
  name, never as an `import()` that loads the module. The source index format
  moves to version 33.

## 0.16.0

### Minor Changes

- 92f4692: `symbol`, `search` and `uses` answer a name a file declares and does not export

  The source index harvests the top-level declarations of every file it parses,
  and `symbol`, `search` and `uses` read only the exported ones. A module-private
  function such as `relaunch` in `packages/cli/src/bin.ts` was answered by
  `symbol` with *the dependency lexicon is not published*, by `search` with
  *Nothing in this repository is named* it, and by `uses` with *not published by
  this workspace*, while `git grep` found it at once. A Rust, Python, Swift, Java
  or Kotlin file was worse off: its reader harvested no declarations, and the
  index recorded it as declaring none.

  The Rust, Python, Swift, Java and Kotlin readers now record every top-level
  declaration with its kind, line, signature and the doc above it: the `///`
  lines or `/** */` block, past Rust's attributes, and a Python definition's
  docstring. Underscored Python names and Rust items that are not `pub` are
  recorded too. A file a reader could not parse is recorded as not harvested,
  rather than as declaring nothing.

  `symbol` answers such a name, when no entry publishes it and no file exports it,
  with one block per declaration: its kind, the file and line that declare it and
  the package that owns them, its signature and documentation as the checkout
  holds them, and who can reach it under the file's language. Nothing outside a
  JavaScript or TypeScript module can import it; only its module and the modules
  inside it can name a Rust item; another Python module can still import it by
  name. Each reader records that reach with the declaration, and one that cannot
  tell — a script or CommonJS file, a module that hands itself out with
  `export =`, a `macro_rules!` — records none, which the answer says. Source comes before tests and stories, and past five declarations the rest
  are counted. `search` lists the declarations whose names or documentation hold
  the query under *N more names are declared somewhere in the repository without
  being exported*, after the exported ones, and within the area when `from` or
  `to` is given. `uses` answers with the file and line that declare it, and who
  can reach it, before any member declared by that name. A declaration its own
  file exports, under its name or another, is left to the export lists. When some
  files' declarations were not read — a file over the size a read opens, one that
  is not UTF-8, one its reader did not harvest — the answer or refusal names them,
  since a name may be declared there.

  `@variance-authority/sense` exports `declaredOf(root, query, { containing, files
  })`, which reads these declarations off the published source index, and a
  `SourceSymbol` carries its `reach`. `@variance-authority/package`'s
  `DeclarationKind` names the kinds the new readers harvest: `struct`, `trait`,
  `macro`, `record`, `protocol` and the rest. The source
  index format moves to version 22; the first `variance index` after upgrading
  writes it again.
- cddaa27: `ask symbol` follows a renamed import in both directions

  `import { greet as hail } from './greet.js'` binds `hail` to `greet`, and the
  binding the parser read is now what ties the two. `ask symbol --name hail`
  answers with that import and then with `greet`: its declaration and import line
  when an entry publishes it, the file and line that export it when none does, or
  the installed declaration when the specifier names a dependency. Before, it
  answered that nothing declares `hail`.

  `ask symbol --name greet` names every file and line that imports it as
  something else, and `ask uses --name greet` marks each such site `(as hail)`,
  the way it already marked an import of a renamed re-export. A use row now
  carries the local name, and `@variance-authority/sense` exports `aliasesOf`,
  which lists the imports that bind a given local name to another export.

### Patch Changes

- d7627d4: A `workspaces` entry that is a plain path is read without a glob

  A large monorepo can list its members one path at a time: one product's root
  manifest lists two thousand directories and no wildcard. Every entry used to
  start a glob of its own, so each read of the manifests spent seconds listing
  directories when one check of the path would do. A plain entry is now read as
  the `package.json` inside the directory it names, and a wildcard entry is still
  read as a glob. An entry under `node_modules` is still never read, as a glob
  never reads one.
- e0eb233: `variance index` reads each package manifest once

  After the source index, `variance index` publishes the workspace's answers.
  First it tries to refresh the answers it published last time. When that cannot
  apply, on the first run or when the member list or the exported names have
  changed, it reads the whole workspace again. Each of those steps listed the
  members and read the manifests for itself, the refresh once or twice and the
  workspace read twice: once for what each package publishes, and once for where
  an import between packages lands. A first run read every manifest twice, a run
  whose refresh could not apply three or four times, and one whose refresh
  applied once or twice. On a product that lists two thousand
  members, one read of them takes seconds.

  Each manifest is now read once per run. `readWorkspaceManifests` gives both
  answers from one read, and `publishWorkspaceFromIndex` hands them to the
  refresh and, if it cannot apply, to the workspace read.

  `refreshWorkspaceFromIndex` is withdrawn from `@variance-authority/help`. It was
  the refresh half alone, and it read the manifests for itself; call
  `publishWorkspaceFromIndex`, which refreshes when it can and reads the workspace
  when it cannot.
- d12b516: `search` finds a name no manifest publishes by the words of its doc comment

  `variance ask search` matched an exported name that no entrypoint publishes by
  its name alone, although `ask symbol` and `ask uses` send you there for exactly
  that name: "ask `search` with a word from its documentation". A helper is
  usually looked for by what it does, because whoever is looking does not know
  its name yet. So `variance ask search --query 'owner directory'` missed
  `pub(crate) fn owner_of` in the native crate, although its `///` comment says
  "its nearest named directory".

  An exported name's doc is now read the way a published name's is: by
  substring, by the words it holds, and by the loose reading. That covers:

  - a JSDoc block above a TypeScript export, or above the declaration
    `export { x }` or `export default x` names;
  - `///` lines or a `/** … */` block above a Rust, Java, Kotlin or Swift
    declaration, past its attributes or annotations;
  - the docstring a Python class or function opens with.

  The unpublished line shows the first paragraph of the doc:
  `owner_of — @variance-authority/sense · packages/sense/native/src/package_owners.rs:190 — Any path's package, tracked or not: …`.
  In `--format json`, an `exported` row carries it as `summary`.

  The search file `variance index` publishes moves to version 3, so the first
  `variance index` after upgrading writes it again.
- 7d556bb: Search ranks a name by where it holds the words, reaches a name through a word's stem, and answers when nothing is published

  `variance ask search --query 'instrumenting modules'` found nothing named
  `instrumentModule`, because a word of the question had to start a word of the
  name as written. Now a word also reaches a name word that shares its stem, so
  `instrumenting modules`, `instrumented module` and `instrumenting` alone
  answer `instrumentModule` as an exact match. The stemmer takes one inflection off and then every noun
  or agent ending, so a word and its forms share one stem: `instrument`,
  `instrumenting` and `instrumentation` meet, and so do `placement`, `place`
  and `placed`. An ending needs four letters left, so `comment` stays apart from
  `come` and `generation` from `gene`. An `s` after `s` or `u` and an `ed`
  after `e` are not inflections, so `process` stays apart from `proceed`. The
  dependency lexicon's catalogue is built again at the next `variance index`,
  because it stores stems. Until then a catalogue of the version before still
  answers every question; only the packages that describe a question by words
  are left out, and the answer says so and names `variance index`. A question
  by words also reports how many packages describe it when more are held than
  shown, which it read under the wrong field name before.
  The first `variance index`, or the first refused question that refreshes
  the lexicon, after the upgrade rebuilds the catalogue whole, once.

  A published or exported match is ordered by where it holds the question
  first: in its name, then in its doc's opening paragraph, then later in its
  doc. Importers order only within that. Before, `--query instrument` put a
  type third whose doc said "instrument" only in its second paragraph, ahead of
  names that hold the word.

  When nothing holds the question as written, a name holding a word of it in
  its own name now comes before one whose doc holds the words and whose name
  holds none. The phrase the doc writes settles the order after that.

  With no published search, `search` refused and told you to drop
  `--just-answer`, even when you had not passed it. Now it reads the checkout
  and publishes the search, the way every other question does, and the answer
  no longer says the checkout was not compared.
  `readSearchForAnswer` now returns the search with whether it was read from
  the checkout, `{ index, compared }`, instead of the search alone. Only under
  `--just-answer` does it refuse, and the refusal names that flag and
  `variance index` as the command that publishes one.

  A published search or published value that is there and does not open is no
  longer passed over in silence. The answer names each one it tried, why it did
  not open, and what it read instead; under `--json` it is
  `unopened`, one `{ published, at, reason }` per file. A file that is not there
  is still absence, and says nothing.
- 52a11a1: `variance ask uses` lists the lines that use a name in the file declaring it
  under that file, `Used in <file>, which declares it:`, one heading for each
  declaring file. Before, a name declared in several files had the lines of all
  of them under one heading that said they were in the file that declares it.

  The export heading names the kind of the declaration in brackets after the
  name: a published name its entry's kind, the one `ask symbol` prints, and an
  export no entry publishes the kind of the declaration it binds in its own file,
  as the source index holds it: "`addTax` [function] is imported in 1 place",
  "`orphan` [const] is exported, without being published". An export that passes
  the name on with `export … from` names no kind, and a name declared twice,
  `const Kind` and `type Kind`, gives each export the kind on its own line. `Named` carries it
  as `declaration`, and the Help snapshot moves to version 7.
- e2eb4a8: `uses` counts each name destructured from an `import()` resolved through `Promise.all`

  `const [{ a }, { b }] = await Promise.all([import('./x'), import('./y')])` takes
  `a` from `./x` and `b` from `./y`, as `const { a } = await import('./x')` does.
  The module reader now pairs each element of the array pattern with the
  `import()` at the same position, in a declaration and in the callback of
  `Promise.all([...]).then(([...]) => ...)`, so `variance ask uses` lists the file
  for each name. A hole skips its position, and a spread leaves every later
  position unpaired.

  A TypeScript cast around the awaited call, as in
  `(await import('./x')) as typeof import('./x')`, no longer hides the names
  destructured from it, and a rest element such as `{ a, ...rest }` holds the
  module, so `rest.b` is a read of `b`.

  A property read off the promise an `import()` returns, without `await`, is the
  promise's: `.then` is no longer listed as a use of an export named `then`.

  An assignment destructures an `import()` as a declaration does:
  `({ a } = await import('./x'))` and
  `[{ a }, { b }] = await Promise.all([import('./x'), import('./y')])` take `a` and
  `b`.

  A name read off the module's `default`, as in
  `const { a } = (await import('./x')).default`, is listed as a site of `a`
  "through `default`: may read it", one level deep, beside the use of `default`
  itself: `default` holds `a` only when the module is CommonJS, and the reader
  cannot tell which one it is. It is counted apart from the imports, in an
  entry's new `throughDefault` of the Help value, as the package graph, the roles
  check and the dependency orientation skip it. `default` read off it again is
  the same level. The `default` moving on, as in
  `const { default: Page } = await import('./page')`, is a use of `default` and
  no more.

  A module held whole that leaves the reader's sight — passed to a call,
  returned, exported, assigned to a property or as a rest target, stored in an
  array, read by a key the reader cannot spell, or loaded lazily — is recorded at that line as the module going
  on whole. A holder is the binding the scope resolves, so a parameter that
  reuses its name is another value; assigning the holder, reading its type with
  `typeof`, and `.catch` or `.finally` on the `import()` are not the module going
  on. `variance ask uses` lists such a line as a site that may read the name,
  marked "passed on whole: may read it", and counts it apart from the imports:
  it is not in `usedBy`, `uses` or `sites` of the Help value but in the new
  `whole` of the subpath that opens the module, and the package graph, the roles
  check and the dependency orientation each read it as every name of the module.
  A file whose only holders are `import m = require('./x')` now has them
  resolved, where before their reads were not listed.

  A published name no other package imports by name, and one of these may read,
  is no longer listed as unused: `docs_symbol`, the catalogue page and `llms.txt`
  say it is not imported by name and where it may be read, so whether it is used
  is unknown.

  The source index format moves to version 32, so the first `variance index`
  after upgrading reads every file again, and the workspace snapshot to version
  8, so a snapshot written before it is read again rather than opened.

## 0.15.0

### Minor Changes

- 1fd0cf7: `variance ask packages` (`docs_packages`) counts and lists no import site: one
  row per published specifier, one per package that declares no entry with how
  many of its names and files other packages import by path, under the heading
  "N packages that declare no entry are imported by path", and per package the
  number of imports from other packages that reach past a published entrypoint.
  It ends with the `variance ask entrypoint --package <name>` questions behind
  those counts.

  `variance ask entrypoint --package <name>` (`docs_entrypoint`) asked by a
  package's name now also counts the imports that reach past its entry, or, for a
  package that declares no entry, the imports of its files by path, one row per
  file: its specifier, how many names are taken from it and how many files import
  it, the most imported first. Asked by one of those specifiers, it counts the
  imports written as it per name, each name with how many files import it, where
  it listed every import with the importer's file and line, and names `uses` on
  the first name for its sites. Under a package that
  declares no entry, a specifier's count is of distinct names taken in distinct
  files, where every import of a name was counted again: fifty files importing
  one name read "50 names" and now read "1 name". Asked by the name of a package
  whose `exports` opens only subpaths, it lists the specifiers the package opens
  where it used to refuse with "does not open `.`". `--subpath .` answers exactly
  as the package name alone, where it left out the imports past the entry, or
  refused for a package that opens only subpaths.

  An import into a published package whose declared entry leads to no source
  file, such as a `main` naming a build output the checkout does not hold, is
  kept, where every one was dropped and `variance ask entrypoint` said no other
  package imports it. An import that names a declared entry is counted as an
  import of an entry this reading could not follow to a source file, not as one
  reaching past the entry; only an import past every declared entry reaches past
  it. `variance ask packages` counts those packages and their imports,
  `variance ask entrypoint` counts them, and `uses` and `symbol` answer for the
  names taken from them. `landing` says where one import between packages
  lands: opened by an entry, at a declared entry the reading could not follow,
  past every declared entry, or by path into a package that declares none.
  `Help` and `Usage` carry the imports of an entry the reading could not follow as
  `unfollowed`, and `gatheringUsage` is the one place a `Usage` is gathered.

  `variance ask entrypoint` on a package that declares no entry says it has "no
  `exports`, `main`, `types` or `typings`", where it left out `typings`, the
  fourth key read for an entry, and says so of one no other package imports too,
  where it said that package "opens no entry". A manifest that writes
  `"exports": null` is read as one that writes no `exports`, as Node reads it: its
  `main` opens the bare name, and without a `main`, `types` or `typings` it
  declares no entry. `Offering` and `Documented` carry whether a
  manifest declares an entry as `entry`, read from the whole manifest whichever
  keys `declared` records.

  On a repository whose packages declare no entry, `variance ask packages` went
  from 200,330 lines in 29.9 to 45.9 seconds to 1,339 lines in half a second,
  `variance ask entrypoint --package @kbn/core` went from 23,463 lines to 13, and
  `variance ask entrypoint --package @kbn/core/server` answers in 241 lines, one
  per name.

  Breaking:

  - `variance ask entrypoint --package <name>` (`docs_entrypoint`) counts the
    imports past a package's entry, or of its files by path, one row per file, and
    asked by one of those specifiers counts its imports per name. It printed
    every import with the importer's file and line; `variance ask uses --name
    <name> --package <specifier>` lists those for one name.
  - `readUnentered` and `publishes` are removed from
    `@variance-authority/package/help`. `readImportTargets` reads the published
    packages, the ones that declare no entry and the specifiers each published
    manifest declares, in one pass.
  - `readHelp` from `@variance-authority/sense` takes those three as its third
    argument, `{ published, unentered, declared }`, where it took the packages
    that declare no entry; the native `read_help` it calls takes `published` and
    `declared` as two more arguments.
  - `Offering` and `Documented` carry `entry`, and `Help` and `Usage` carry
    `unfollowed`: a value built by hand adds them.

### Patch Changes

- ef496ad: READMEs name what the program does

  The package READMEs, and the `@variance-authority/vantage` and
  `@variance-authority/playwright-test` descriptions, no longer write a test, a
  record or a run as something that says, asks or knows. Each sentence names what
  the program does: a command prints, a record holds a field, a test runs or
  covers. Where a value is filled in from configuration or a default rather than
  recorded, the README says so. Four renamed headings change their anchors:
  `help`'s "Where the declaration is undocumented", `playwright`'s "Where a
  component is declared, read from the engine", `storybook`'s "What a pass sends
  the preview" and `sense`'s "Correct what a file's text declares it imports".

## 0.14.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.13.0

### Patch Changes

- b3c1bdf: `variance ask uses` and `ask symbol` answer for a name that no entry publishes but that another package imports by the path of its file, such as `addTax` from `@acme/lib/src/internal/math`. They no longer refuse it. Each import is listed with its file and line and marked as a deep import, past the entry the package declares, or as an import by path from a package that declares none. `symbol` also says where the name is declared and why nothing publishes it. A name that is exported without being published and that nothing imports is still refused, and the refusal names the file and line that export it.

  A workspace package with none of `exports`, `main`, `types` or `typings` is no longer skipped. `ask packages` and `ask entrypoint` list it by the files and names other packages import from it, each with the importer's file and line, and none of those imports are called deep. A `.js` `main` with no `types` and no `.d.ts` beside it opens at the `.ts` or `.tsx` source of the same stem, as TypeScript reads it.
- b3c1bdf: A workspace package with no `exports` publishes its bare name through `types`, `typings` or `main`, the first of them the manifest writes, in the order TypeScript reads them. `variance ask packages` lists it with the imports of it, and an import of any of its other files, such as `@acme/lib/src/internal/math`, is listed as reaching past its entrypoint. `ask symbol`, `ask uses` and `ask entrypoint` answer for the names its entry exports. Before, such a package opened nothing and was missing from every answer.
- 59be40a: A pnpm workspace's packages open, and `reach` walks past a file the diff deletes

  A root manifest with no `workspaces` reads its members from `pnpm-workspace.yaml`, so `ask entrypoint --package @mui/material` answers on Material UI. The list is read as YAML and its entries as globs, so an entry starting with `!` excludes what it matches, a `**` glob reads every member under it, and a list written at its key's own indent, in flow style or under a byte-order mark reads the same as any other. A member two entries match is read once. A bare `.js` export opens by the `.d.ts` written beside it, and a published name followed through a JavaScript module reads that declaration. A workspace that publishes no package says so in a sentence, where it printed an empty list.

  `variance reach --since <ref>` takes the files the diff deletes out of the walk and names them on stderr. A diff that only deletes refuses, and the refusal names the deleted files.
- 27a4713: An `exports` field written as conditions opens `.`, and a custom condition in `tsconfig.json` is followed

  An `exports` string, an array of fallbacks, or an object with no `.` key now publishes `.`, as Node reads it. Before, each condition key was taken as a subpath, which invented names such as `@tanstack/solid-querytanstack/custom-condition`. An object that mixes subpaths and conditions is refused and the manifest is named, because Node refuses to load it. A condition listed in the package's `tsconfig.json` `customConditions` (through `extends`) is followed to the source it names when it comes before `types`, so Zod's `@zod/source` and TanStack's `@tanstack/custom-condition` open their `src/` files. Every config in that `extends` chain is read as JSONC whatever its name, so a comment in a `tsconfig.base.json` is read rather than refused. A pattern target with no extension, such as `./src/v4/locales/*`, opens one subpath per TypeScript file it matches, spelt with the emitted extension. An import of a subpath that `exports` names exactly is no longer reported as reaching past a published entrypoint when that subpath's source could not be read; it is listed under unreadable instead.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.9.0

### Patch Changes

- aa57273: `ask uses` finds a name your code reads off `import()` or `import * as`. It used to answer that nothing imported `narrowByJourneys` when `select-command.ts` read it as `selection.narrowByJourneys` after `const selection = await import(…)`. Such a site now names the line that loads the module, and an `import()` site says the module loads when that call runs, not when the file loads.

  The parse carries these reads as `members`, apart from each request's `bindings`, so test selection reads exactly what it read before. The source index moves to version 12 and the help snapshot to version 3, and each is rebuilt on the first question after the upgrade.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.7.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.6.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.10

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.9

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.8

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.7

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.2.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

### Patch Changes

- d956ba1: Open an `exports` subpath written as a bare path or with its `types` nested
  under `import`/`require`. Only a top-level `types` condition was read, so a
  workspace using either of the two commonest shapes was reported as publishing
  packages that open no names at all — an empty `help-index.md`, an
  `llms.txt` of bare headings, and a `help-gaps.md` claiming every name carried a
  doc block.
