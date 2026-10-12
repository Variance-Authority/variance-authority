# @variance-authority/package

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
