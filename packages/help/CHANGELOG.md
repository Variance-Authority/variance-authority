# @variance-authority/help

## 0.22.0

### Minor Changes

- 31cd46d: A journey no longer places a call by its name. A method call on an object the source does not trace, and a `new` the source does not resolve, used to be drawn to the one function the case ran under that name, or to the first constructor it ran of a class so named. Both were namesakes, not targets: they now have no place, and `name-match` and `new` are gone from the ways a call is known. Journeys prepared before this are prepared again.
- 6b72cd6: `ask search` now prints, beside each published name, the places that import it and the packages those places sit in, counted as `ask uses` counts them: `imported in 5 places in 2 packages`, or `imported nowhere`. Before, it printed `2 packages, 3 imports`. That number counted only imports by a published path from other packages, but it read as every import. The rows a page shows are ordered by the count they print. Search counts only the rows it shows, and opens the Help value only when one of them is a published name.

  Without the Help value, and in `entrypoint`'s rows, the narrower count is printed under its own name: `3 imports by published path from 2 other packages`, or `no other package imports it by its published path`.

  JSON changes:

  - A published match carries `importedIn: { places, packages }`.
  - Its `packages` and `imports` fields are renamed `otherPackages` and `otherImports`.
  - The answer carries `importsUnread` when the source index did not read, so imports by file path were not counted.

  When the Help value is published but does not open, an answer that shows a published name says so beside the index counts it prints instead.

  Breaking for code that builds a `SearchReading` itself: it now requires `value`, a thunk that reads the Help value on demand. `countingShown` calls it.
- cbf1820: `ask search` weighs and shows a name through one of its rows

  A word in a doc weighs at most two thirds of the same word in a name, however short the doc.

  A name's weight is multiplied by how much of the question it writes, each word counted by its rarity, so a long doc that writes every word can sort before a short one that writes most of them.

  A word's rarity is counted once per name, declaration and file found, a name writing it when any of its rows does, and the mean doc length over the doc of every row found, so no name's weight depends on the row another name is shown through.

  A name published by more than one package or exported from more than one file is weighed and shown through one row, never several rows' docs added up: the row its words weigh most through, then the one whose doc writes more of the question's adjacent word pairs, then the first one the published or exported section would show.

  A name stays in the described section only when the row it is weighed through writes at least half the question's words; a name whose rows write that many only together is listed in the loose section, when every word finds it there.

  A name published anywhere is shown in the published section through a published row, whatever its exported rows write, and the described section weighs a name's rows before it asks whether they are published.

  The published and exported sections settle a tie between one name's rows by the doc's text, then what a published row declares or the line an exported row is declared on, then the file, where they used to settle it by where the index wrote each row, which follows package and file names.

  A published row has no line, so the file settles two published declarations of one kind under one doc.

  The exported section used to show a name through its first row by kind, then the first one written, even when another of its rows was the one whose doc opens with the question and ranked it; it now shows that row.

  With `from` or `to`, a name is counted, weighed, ordered and shown only through the rows of the area: a published row a file of the area imports, or an exported row of a file in the area.

  The published `SearchIndex` type no longer declares `publishedFile`, the file id of a published row.
- af1b275: `ask uses` lists the imports inside the declaring package apart, with the lines that use them, and the classes that implement a member

  The first line of `variance ask uses` counted every import of a name as one
  number, and the list mixed the imports inside the package that declares it
  with the ones from other packages. Both are now counted apart, `imported in 2
  places: 1 from another package and 1 inside @acme/lib`, and listed under
  `Source, inside @acme/lib:` and `Source, from other packages:`, and the same
  for tests and stories. `ask symbol` counts its places the same way. Each
  import ends with the lines its file uses what it binds on, `; used on lines
  4, 5`.

  A member of an interface now lists the member of each class that writes
  `implements` of it as an `implement`. An object that takes the interface from
  where it goes, such as `run({ deps: { readJourney } })`, writes no type on its
  line: the answer says so and names the declaration to ask TypeScript's
  go-to-implementation about.

  The source index moves to format 38: it holds the lines a file uses each
  import's binding on, and the `implement` members. The first command after the
  upgrade reads every file again.
- 1c40704: `ask uses` names the files whose imports the source index resolved to no file when one could take the name, since a use there is not listed. For a name no file here declares but a file imports from a package outside the workspace or a runtime module, the answer names each source and the `discover --imports <source>#<name>` question that lists the files; over MCP it names the command to run in the checkout, since `docs_discover` there refuses the question. A path alias such as `@/lib`, a `paths` or `baseUrl` mapping a `tsconfig` or `jsconfig` declares, and a package of this workspace are never named as outside sources; an unresolved one of them, or a `#` subpath import, is named among the files that could take the name. `@variance-authority/sense` publishes `outsideSourcesOf(root, name, index?)`, and `importersOf` carries `unresolved`. `@variance-authority/mcp/tools` publishes `conjoined`, which joins words as `a, b and c`.

### Patch Changes

- 9b5e111: A word a doc writes in a code span is found by that word

  The search file split a doc on spaces and punctuation. A backtick is neither,
  so a doc that wrote `@testOnly` in a code span held the word with its
  backtick still attached, and `variance ask search --query "testonly production"`
  never reached the name that doc describes. A backtick now ends a word in a
  doc, in a name and in a query, so that doc holds `testonly` and `production`.

  The search file moves to version 4. The first question after the upgrade
  names the earlier file as unopened, answers from the published value, and
  writes the search again beside it.
- 45ea59c: A default export is answered by a name, never by `default`. `export default function Badge` is `Badge`. An anonymous `export default function ()` takes the local name of the import nearest its file, so `import shout from './anon.js'` makes it `shout`, with every importer's own spelling listed beside its site, and every local name an import gives it answers it; when nothing imports it, the nearest export that passes it on under a name, `export { default as Thing }`, names it. A local name of a default says the declaration it imports, `imports shout (its default) as far`, and an export passing a default on says the name it passes on. Asked for `default`, `ask symbol` and `ask uses` answer only the default exports nothing names, never one passed on from a named default, and no longer list a default export's declaration as declared but not exported. The source index binds an anonymous default to its declaration, so its kind and signature are read like any other's; the index moves to version 39 and an older one is read again. Every export the package stage reads now carries `bound`, the name it binds in its own file (`default` for an anonymous default, none for `export … from`), so a declaration is keyed without reading the source index again; the help snapshot moves to version 10 and an older one is read again. The skill's workspace reference says how a declaration, and a default, is named.
- d2cc975: Seven docs say what their declaration does in the words it is asked for

  `ask search` now shows these among its rows: `snapshotValue` writes a test case's value as a snapshot file, `locateSites` turns a stack frame into its source line, `BlockKind` names the construct behind each region kind, and the Playwright Locator recording in eyes is documented. The lead of `testSelectionProbes` now says it is the Vite plugin whose `transform` hook instruments each module. The tool-order doc of `@variance-authority/help` sits on the tool list rather than on the wrapper that dates each answer.
- 15d7975: `ask search` reads a doc as writing a question of two distinct stems or more when one of its paragraphs holds them in order by stem, each as many words after the last as in the question, so `page sink` finds `eventCollectorSource`, whose doc installs "the page's sink", and a name declared without being exported is read by the same rule. A function word such as `of`, or a word under three letters, holds its place, so "a page and its sink" no longer writes `page sink`, either as a match or in how near the described names sort. `phraseOfNative` answers the phrase, and `nearOfNative` counts a doc's pairs by the same rule. When nothing matches, the answer says no name or doc writes the question, no longer "as typed".
- b6347b7: `ask symbol` and `ask uses` answer a name written as `Container.member` with the member that container declares, where they refused it as undeclared. A name a file also declares at its top level lists its members beside that declaration, where the declaration hid them.

  So does a name imported by the path of its file, and a published one. The first five member declarations are listed and the rest counted. When no interface, type alias or class body read declares the member, the answer names where the container is declared, or says no file declares it at its top level, since a namespace an import binds is not read as one. An inherited member is left to the go-to-definition of the container's language's type checker, and so is a member of an enum, a namespace or an object literal, whose bodies the source index does not read.

  A member a type alias declares in a literal its intersection or union joins, `type Options = Base & { index: string }`, is named a member of `Options`, where it was named a member of a type literal.
- f606d7d: A hint names what you can type where you asked

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
- 11b87d2: `variance ask uses` follows a module held whole, `import * as ns` or `const ns = await import(…)`, into a function the same file declares when the module is handed to it, `f(ns)`, and lists the names that function reads off its parameter at the lines that read them. Such a call no longer marks every name of the module "passed on whole: may read it". That mark now names the line where the module leaves the file's sight, which may be inside the function. A read off the parameter is no longer called type-only because the parameter's type is `typeof import(…)`. The source index format moves to 36, so the next scan reads every file again.
- d65dce0: `ask symbol` and `ask uses` answer each declaration of a name apart. A declaration is the file that declares it and the name that file exports it under, so two published declarations that share a name are two answers, each with the import that reaches it and its own count, and so are an entry's `export { greet as salute }` and the file's own `salute`. "Also published by" lists only the other entries of the same declaration, and a declaration published or declared under another name than the one asked says that name. One binding its file exports under two names, `export default greet` beside `export { greet }`, is one declaration keyed by its named spelling, never `default`, and its importers under either name are its uses. Snapshots written before this read again.
- cc06d2e: Journeys read the recorded commit, or say why git could not

  On git 2.43, the version Ubuntu 24.04 and the Playwright images ship, the
  journeys walk could not read the files that had changed since the recorded
  commit in a partial clone. Asking `cat-file` with `GIT_NO_LAZY_FETCH=1` makes
  that git exit 128 at the first object it lacks, instead of answering
  `missing`. The walk then parsed those files as the working tree had them.
  Now the walk lists the changed files' objects with `diff --raw`, fetches them
  from the promisor remote in one request, and reads them by object name. When
  git cannot serve one, the journeys are not prepared, and `variance index`
  prints git's own reason. A recording that names no commit is not walked.

  A call whose import resolves to no function is no longer placed on a function
  the case ran because that function is exported under the imported name. Such a
  call has no place.

  The `variance index` journeys line names the unit of each count. Functions
  entered are counted once per case that entered each, and calls and package
  flows are distinct. A recording kept inside the checkout is named by its
  checkout path, and one in a shared cache by its own path.
- e2a0cac: `variance ask uses` lists a name a package passes on as `export * as ns` where a file imports `ns` by name and reads the name off it, `ns.name` or `const { name } = ns`, marked `(namespace, line <n>)` with the line of the import. The source index records the names read off each named import, so an index written by an earlier version is read again.
- ca268fa: `variance ask uses --file <path>` answers for the declaration in that file alone when several files declare the name. Without it, the answer names each file that exports the name without publishing it, and a `--file` that declares nothing by the name is answered with the files that do.
- 535b042: `ask symbol` answers a function or an arrow function declared inside another function's body, with the function that holds it — by its name, or by the line it is written at when it has none — and the members of the name beside it, and an export no entry publishes beside a published namesake. It writes out the declarations of the name nearest `--from` first and counts the rest. `ask search` weighs each word of a description by how rare it is among everything the description reached, an integer counted three times over in a name and twice in a doc of the mean length, more in a shorter doc and less in a longer one, never more than in a name, so a name holding the rare words is no longer outranked by every doc that also says a common one; it reads no declaration inside a function. The source index format moves to version 35, and the next scan rebuilds it.
- 9e1e684: The source tree reads the mocks, as `variance covering --since` does

  The source tree `readTree` reads, which `variance ask`, the `docs_*` tools and
  an MCP host walk, now reads `vi.mock`, `jest.mock` and `sb.mock` calls off what
  the parse recorded: a mock subtracts its target from the test file's edges, and
  a real module its factory loads adds one. `@variance-authority/sense` exports
  `runGraphOf`, the one fold that graph and `variance covering --since` are both
  built by: the mocks, then the taints you pass, and the records folded with
  their shadows.
- bfe6e32: `ask search` puts a name that is the question first — as written, then the same name in another case — ahead of names that only hold the word and however few packages import it. `ask symbol` answers a name a file exports and no entry publishes the way it answers a published one: with its kind, its signature and its doc, read off the declaration the export binds — under another name, or through any `export … from` that passes it on — not the raw line it is written on. `@variance-authority/sense` exports `declarationExported`, that declaration with its kind and the spans of its signature and doc, in place of `declarationPassedOn`.
- c0e7621: `ask symbol` counts the imports of a name inside its own package, so its count agrees with the places `ask uses` lists. The closing line names the total and splits it in two: the imports from other packages, and those inside the package that declares the name, even when a package that re-exports it is the one most imported. The places that may read the name, off the module's `default` or with the module passed on whole, are counted as no import, as `ask uses` counts them, and the header names them once, from the same sites `ask uses` lists, including the ones inside the name's own package. The header's count now says it counts imports by published path only. A name that only its own package imports no longer reads as unused. When the source index does not read, the closing line says so and gives the reason instead of leaving the inside count out.
- fde69ec: `variance ask uses` follows a namespace destructured off a namespace import, `const { ns } = lib` and then `ns.name`, and `const { ns: { name } } = lib`, as it follows `lib.ns.name`. A binding destructured off a module the file holds is that module's value under a local name, as an import binds one, so it is no longer listed as a `[const]` declaration of its own beside the name it takes.
- 446dbe6: A namespace a file imports and exports by its local name, `import * as ns from './x.js'; export { ns }`, is read as the `export * as ns from './x.js'` it is: `variance ask uses` lists `ns.name` read off it in a file that imports `{ ns }`, and `lib.ns.name` off `import * as lib`, and no longer lists the barrel itself as a place that may read the name.
- 72c045c: `variance ask uses` follows a name through a namespace inside a namespace, `lib.ns.name`, and through a namespace passed on as `default`, and says a name an entry publishes only inside `export * as ns` is published as `ns.name`. Every declaration of a name is answered with its own imports, kept apart; and `--file` naming a file that only passes the name on answers for the declaration it reaches.

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

### Minor Changes

- eed3410: `ask search` answers a description by any of its words. When no name or doc holds the query as written, the repository's own names and files that hold any of its stems come back, ranked as before: the most words held first, then the most in the name, then the phrase the doc writes. Before, a name had to hold at least half of them, so a three-word query whose best match held one word was reported as nothing. Their heading now reads "hold words of `<query>`" rather than "hold at least half the words of `<query>`". Installed packages still answer only when they hold half the words. A name holding fewer than half the stems, which this section did not hold before, is left to the loose reading when that reading reaches it by every word, as it was before. So `cache entriee magazie` still offers `cacheEntriesMagazine` loosely however many names holding `cache` this section shows. The rows this section shows hold every word any of its names holds, so `mermaid chart palette` shows the one name holding `mermaid` however many holding `chart` sort before it — the heading ends "a row holding each word is shown however it sorts" — and a doc is read for the phrase only when its name can be shown.

  When those names, or the ones the loose reading adds, follow, the answer opens with "No name in this repository, nor the doc of one, writes `<query>` as typed. The nearest follow." instead of "Nothing in this repository is named or documented with `<query>`". With `from`/`to` it opens with "No name in reach of that start point, nor the doc of one, writes `<query>` as typed", still says to ask again without `from`/`to`, then gives the nearest in reach. The *nothing* line still opens an answer that has nothing of the repository's own to show.

  `declaredDescribedOf` no longer takes `needed`: a declaration or file answers when it holds any of the stems asked.

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
- 453bf3f: `ask uses` lists the lines of the file that declares a name

  A file uses what it declares without importing it, so `ask uses` and
  `docs_uses` answered a helper called three times in its own file with "nothing
  imports it". The scan now records, with each TypeScript, JavaScript and Rust
  file's parse, every line that uses a name the file declares at its top level:
  a call, a read, a type, a Rust `self::name` path, and a test module's
  `use super::*`. The answer lists them after the imports, under
  `Used in the file that declares it`, for a name the file exports and for one it
  keeps. The lines follow the language's scope: a parameter, a local or an inner
  item of the same name is another name, and the declaration is not a use. A
  Python, Swift, Java or Kotlin file is still answered by its imports alone.

  The source index format moves to version 29, so the first scan after the
  upgrade reads every file again.
- 58cae6d: `discover --to` says how each file reaches the path, and takes a name out of a file

  A file two or more imports away from a `--to` path now carries one shortest
  chain of imports to it, `src/Page.ts → src/Model.ts (type import) →
  src/store/selectors.ts`, with each step that is not a plain import marked. The
  chain is built only for the files shown.

  `--to src/store/selectors.ts#selectBalance` answers what rests on one name: the
  walk starts at the files that import `selectBalance`, as `uses` lists them,
  through every barrel that passes it on, so a file that imports another name
  through the same barrel is not reached. The files that import the name show the
  line that does; a file further out has its chain end at that line.

  The `--to` header names the files the walk did not reach that import something
  the scan could not resolve, since they may reach the path through it. It used
  to count the unresolved files among those it reached, which says nothing about
  what reaches the path.

  `@variance-authority/mcp`'s `Tree` has `chainsTo(seeds)`: each file's import
  distance to the seeds, and one shortest chain per file, asked per file.
- 41ea367: A name nothing declares is an answer over MCP, and in `intersection`

  `variance-authority-help` and `variance serve` answer `docs_symbol` and
  `docs_uses` about a name nothing declares with the text `variance ask` prints,
  as a result rather than an error, after reading a reused generation again.
  `variance ask intersection` with a question about such a name answers that no
  file is in all of them, naming beside that question what was read and declares
  nothing, instead of refusing. `serve` takes `answered`, which turns what a tool
  threw into a result, and `foundNothingAnswer` is the answer every surface gives.
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
- 9ee6ef6: The dependency lexicon is two binary files, and an edit appends to one of them

  `variance index` writes the dependency lexicon as `dependency-lexicon.bin` and
  `dependency-lexicon.sites.bin` beside the source index. The first is the
  catalogue: the manifests' declared packages, what each installed package offers,
  and the names, signatures and JSDoc of every public entrypoint. The second is
  the import requests each source file writes, kept as a log. An edit appends the
  requests of the files it changed to the log and leaves the catalogue as it is,
  unless a manifest, an installed package or a specifier no source file imported
  before changed. On a 51,059-pair checkout the two files are 55 MB and 27 MB, and
  a refresh after one edited file appends about 450 bytes and takes 0.3 s.

  After one edited file, `variance index` prints `dependency lexicon: 1 changed
  source file read: …`. The line ends with the path of `dependency-lexicon.bin`.
  `refreshDependencyLexicon` and `refreshDependencyLexiconNative` return `sites`,
  the path of the log, `appended`, the number of source files whose requests the
  refresh recorded, and `rebuilt`, which is true when the log was written whole.

  **Breaking:** `dependency-lexicon.json`, `dependency-lexicon.built.json` and
  `dependency-lexicon.merge.json` are no longer written or read. Run `variance
  index` once to write the new files; the old ones can be deleted. `@variance-authority/help`
  no longer exports `readDependencyLexicon`, `DependencyLexicon`, `LexiconEntry`,
  `LexiconAvailability` and `LexiconIssue`; `ask search`, `ask symbol` and `ask stack`
  read the lexicon. The refresh result no longer has `merged`.
- 7a033f3: `ask uses` answers for a member of an interface, a type literal or a class

  A method or property declared on an interface is never imported, so
  `variance ask uses --name resolveSources` refused it as a name the workspace
  does not publish. `uses` now lists where a member by that name is declared,
  each line ending with its container, and names the search that finds its
  callers: `ask grep --query '\bresolveSources\b' --to <declaring file>`, which
  runs ripgrep over the files that import the declaration. For a name an export
  has as well, such as a wrapper function named like the member, the
  declarations follow the imports under `` `prepareJourneys` is a member too ``.
  When the source index cannot be read, the refusal says so.

  `variance index` records every member declaration with each file's parse, so
  the answer is a lookup in the source index, and `memberDeclarationsOf` in
  `@variance-authority/sense` reads it. The source index format moves to version
  20; the first `variance index` after upgrading writes it again.

### Patch Changes

- 5080f93: A cold index of a large checkout declares its symbols

  A checkout of ten thousand modules or more is indexed by the native graph in one
  call, and every later change by the native update. Both parsed each module
  without its declarations, so `ask symbol` and `ask search` answered as if the
  checkout declared nothing, and kept answering that way: on seven copies of MUI,
  `ask symbol --name useUtilityClasses` said the dependency lexicon was not
  published. Both now read the declarations out of the same parse, and the answer
  lists them.

  Source index format version 24. An index written by an earlier release is
  rebuilt by the next `variance index`.

  When `symbol` finds nothing, its answer, or its refusal, names the files whose
  declarations were not read, such as one over the largest-file limit, so a name
  declared there is not reported as declared nowhere.

  **Breaking:** `enrichSources` and `HarvestSubject` are removed from
  `@variance-authority/sense`. They re-read a parse that held no declarations,
  and no parse the index writes is one.
- 0c3a311: A description finds this repository's own files, and a typo finds a name its file keeps to itself

  `variance ask search --query 'loose reading'` did not answer
  `packages/help/src/tools/loose.ts`, and `suite precision grain` did not answer
  `packages/sense/src/test-selection/precision.ts`: what a file is for is said in
  the doc it opens with, and no reading looked there. Now a file answers in the
  `described` section by the words of its own name and that doc, as
  `packages/help/src/tools/loose.ts [file] — @variance-authority/help — The loose
  pass's membership, read off the published dictionary. [holds: loose, reading]`,
  and `--format json` carries it with `source: 'file'`. The doc a file opens with
  is the first `/**` comment ending before its first statement that is not an
  import, unless it documents that statement.

  Between two rows that hold as many of the words, the one whose doc writes more
  of the question's adjacent word pairs adjacent now comes first, before the
  words in the name; the pairs are of the words the question is about, not of
  `it is` or `of a`. The words every package says about itself — `package`,
  `module`, `use`, `tool`, `library`, `get`, `set` and the like — are words again
  when your own code is asked, while staying stopwords for an installed package.
  `what`, `where`, `who`, `whom`, `whose`, `why`, `does`, `did`, `was`, `were`,
  `been`, `there`, `their`, `them`, `they`, `then`, `than`, `but`, `about` and
  `each` are now stopwords for both, since they say how a question is put.

  The loose reading — words apart, or one character off — now reaches a name its
  file declares and does not export, after every exported one.

  `@variance-authority/sense` exports `declaredTermsOf`, `declaredLooseOf` and
  `nearOfNative`, and `declaredDescribedOf` takes the query and answers with
  `files`. The source index format moves to version 26; an older index is
  rebuilt.
- 100eeea: A description finds this repository's own names before an installed package's

  `variance ask search --query 'tsconfig custom conditions'` answered only with
  the installed packages whose descriptions hold those words. The repository's
  own names were matched by the phrase, or by every word in the name, and an
  installed package describing the words stopped the search for anything looser.

  Now, when nothing in the repository holds the query as written, the names
  holding at least half of its words — stemmed and stopworded by the rule the
  installed packages are read by — come first, each with the words it holds:
  `customConditionsFor … [holds: conditions, custom]`. They are ordered by how
  many of the words the name itself holds, then how many it holds at all. The
  installed packages that describe the words follow them, and the loose reading
  of the words runs whether or not a package describes them. `--format json`
  carries the section as `described`, each row with its `words`.

  `@variance-authority/sense` exports `describedWordsNative` and
  `wordStemsNative`: a question's stems, and a word's stem, by the addon's rule.
- 8d1bcc1: A link in a doc comment opens from `node_modules`

  Doc comments linked to documentation by repository paths such as
  `../../../../docs/flakiness.md`, which resolve to nothing in an installed
  package. They now link to the page on variance-authority.dev, or to the file on
  GitHub when the site does not publish it, so the link works on hover in your
  editor and in what `variance ask symbol` prints.

  The MCP server's instructions and its observability answer linked to
  `/start-cli` and `/presentation`, which the site does not serve. They now link
  to `/start/cli` and `/docs/presentation`, and the `@variance-authority/cli`,
  `@variance-authority/help`, `@variance-authority/mcp` and
  `@variance-authority/vitest-browser` READMEs link to the guides where the site
  publishes them.

  `variancePrecondition`, `wiringOf`, `tapCommits` and `provenanceOf` carry an
  `@see` link to the section of the guide that documents them.
- 80db3dc: A test file costs what running it took, the time before its first case included

  Vitest's file duration is its cases alone, so a file that spent 5.4 s on its
  environment, setup files and imports and 33 ms in its cases was ranked and
  placed as a 33 ms file. Every reader that weighs a file by its time now reads
  one figure: the larger of the runner's duration and the file's phases summed.
  A Jest file still costs its runtime unless its phases add up to more, and a
  file recorded without phases still costs its duration.

  - `variance ask slowest-tests` and `docs_slowest_tests` rank files by it.
  - A sharded run, and `variance shards`, place and count files by it.
  - `variance distill`'s "loading" is everything before the first case —
    `prepare`, `environment`, `setup` and `collect` — rather than `collect`
    alone, as `timeBeforeCases` from `@variance-authority/sense/test-selection`
    reads it, and a file is load-bound when that outlasts its cases. In
    `--format json`, each `loadBound` entry is `{ file, loading, cases }`; its
    `collect` field is gone.

  The stored `tests.duration` is unchanged: it stays the runner's own figure.
- 2cc4e43: A refusal reads the checkout as it is

  `variance ask`, `variance serve`, `variance-authority-help` and its server
  reused a published source generation for an hour, and the dependency lexicon
  was built only under `variance index`, so a function written since the last
  index was refused as not published, and a fresh checkout refused an installed
  package's export with *the dependency lexicon is not published*. Both read as
  real absences. A refused question is now asked again of a generation made from
  the checkout now, with the dependency lexicon built when it is missing or
  behind, and only that answer is given, under `--changed-file` and
  `--taint-file` too; an answer that found its name still comes from the reused
  generation, so only a refusal pays for the reading. When that reading or the
  lexicon fails, the refusal says which was not compared with the checkout, and
  why.
  Under `--just-answer` or `justAnswer`, and on `search` when no changed files are
  named, every answer and refusal says the checkout was not compared with the
  generation, and `search --format json` carries `compared: false`. The help
  package exports `caughtUp` and `snapshotLine` for hosts of their own, and
  `serve` from `@variance-authority/mcp` takes an `again` hook that asks a
  refused call to a known tool, with its required arguments, again with a fresher
  subject, or ends the refusal with the host's footer.
- f7dff69: A Rust inline module is a module of its own

  `use super::helper` inside `mod tests { … }` in `foo.rs` names `foo.rs`, and a
  `use` inside an inline module was read as if the file had written it, so it
  landed on `lib.rs` or on the file's parent. `self` and `super` there now name
  the inline module and the one around it, and a path that names the file it is
  written in is no edge. A `#[path]` inside an inline module is read from that
  module's directory, `a/b/inline/other.rs` in `a/b.rs`, and a `#[path]` at the
  top of a file from the directory the file is in. A `pub use` inside an inline
  module is no export of the file.

  `ask symbol` answers an item inside an inline module, declared on its module
  path, `tests::fixture`, asked for by that path or by its own name. A `pub` one
  there says who can reach it is not recorded, since the modules around it decide.
  A `pub` one whose inline modules are all `pub` is not declared on its own: the
  file exports the outermost of them, and you ask for that module by name.
- a96684c: A Rust path written in a type or an expression is a use, and `super` follows `#[path]`

  `variance ask uses` now counts `crate::graph::Limits` in a field type and
  `super::reach()` in a body, as well as a `use`, each resolved through the module
  tree the crate's `mod` lines declare. A `self::` or `super::` path is read from
  the module it is written in, an inline `mod` included, and a file a `#[path]`
  loads keeps its children beside it, so a `use super::catalogue::Catalogue` in a
  file put beside its parent reaches the parent's sibling. A test or example
  target that no module declares is its own crate root. The item a path names is
  the one segment past its modules: `crate::map::JourneyMap::new()` counts
  `JourneyMap`, and neither a private `fn map` nor a module's `fn new`.

  `ask uses` and `ask symbol` answer a name a file keeps to itself beside an
  export of the same name in another file: the kept declaration, and for a Rust
  item the modules inside its own that import it, follow the export's answer
  instead of being dropped.

  The source index format is version 25. It keeps whether a reader guessed a
  request and whether it asked for an item, so a parse read back from the index
  is the parse the reader made. An index written by an earlier version is rebuilt
  on the next read.
- d7627d4: A workspace whose members sit outside its directory is read from an index of what it lists

  Some workspaces list members outside their own directory, such as a product in
  a monorepo that lists packages from the repository's other top-level
  directories. The questions `variance ask` answers about such a workspace
  covered every top-level directory that held a member. In one product that came
  to 316,034 files, read again on every `variance index` because nothing kept
  them. The reading now covers what the `workspaces` list names: the workspace's
  own directory and each listed member directory. A file elsewhere in the
  repository that imports one of its packages is no longer counted as a use.
  `variance index` keeps a source index over that scope next to the workspace's
  own, updates it as it updates the workspace's, and answers the questions from
  it. In that product, `variance index` after an edit went from 59–62 s to 15 s.

  `updateSourceIndex` takes `dirs`, the directories the index covers, and
  `primary`, the generation a missing index starts from.
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
- a15af35: `ask symbol` lists a container's members, and `ask uses` takes `--limit` and follows a passed-on name

  `ask symbol` on an interface, a type alias or a class now lists the members it
  declares after its signature, one line each as the checkout writes it, with its
  file and line. A nested type literal's members are not listed, and an alias that
  fits on its line lists nothing more.

  `ask uses --limit <n>` shows that many rows of each list: each kind of site,
  the lines of the declaring file, and the members by the name. Without it the
  answer shows twelve of each and counts the rest, as before. A `limit` that is not a whole
  number of at least 1 is now refused by `uses`, `grep`, `discover`,
  `intersection`, `slowest-tests` and `variance_costs` alike, rather than read as
  the default, and `variance_costs` now also takes the digits a shell passes.

  A name a file only passes on, as in `export { taxOf as levy } from './tax.js'`,
  is now followed to the declaration it reaches, through every file between them,
  every rename, a type-only `export type { … } from`, a bare `export *`, an
  import the file exports again, and `export { default as x } from`. `ask uses`
  names that declaration after the export line, and `ask symbol` shows its line
  and its members too. Files that only pass a name to each other name no
  declaration, and neither does a namespace or a star asked for `default`.

  Journeys resolve a call through a barrel the same way. A name two `export *`
  reach in different files, and `default` behind an `export *`, used to land in
  the first star's declaration; the call now names no function, as ECMAScript
  resolves neither. Neither does a name behind a star whose request resolved
  to no file of the checkout, or to a file the journeys could not parse, since
  that star may export it too.

  `ask symbol` for a name an import binds with `as` answers its original the
  same way: followed to the declaration a file passes on, with its members.

  Yarn 2 and later have no `-s` flag, so `yarn -s variance` fails before the CLI
  starts. The skill now says that `yarn variance` already prints only the CLI's
  output.
- 0689917: `search` finds a name its file keeps to itself by words its name or doc holds apart

  `variance ask search` found a declared, unexported name only when its name or
  its doc comment held the query as one run of text. A private helper is
  looked for by what it does, in your own words and your own order, so
  `variance ask search --query 'process the program again'` missed:

  - `function relaunch` under "Start the program again in a process of its own.";
  - the same doc on a Rust `fn rerun`;
  - the same doc on a Python `_reopen`.

  Such a name now joins the section that follows an empty answer. The section
  lists the names holding at least half of your words by stem, and the private
  name is read by the same rule as an exported one:

  ```text
  relaunch [function] — @acme/kit · packages/kit/src/money/restart.ts:4 [holds: again, process, program]
  ```

  The section is now ordered by how many of your words a name holds, and only
  then by how many its own name holds. A doc that says every word you asked now
  ranks above a name that says half of them. In `--format json`, a `described`
  row of such a name has `source: "declared"`.
- f10a77e: `ask symbol` answers a member, and says what it checked for a name nothing declares

  A method or property of an interface, a type literal or a class is answered
  with its container and the file and line that declare it, one block per
  declaration, as `ask uses` already lists them. It used to be refused.

  A name nothing in the workspace declares is refused with what was read: no file
  the source index read declares it at its top level or as a member, and no
  installed dependency publishes it. When the dependency lexicon is not published, the refusal says
  the dependencies were not checked and that `variance index` publishes it. It
  used to answer only `the dependency lexicon is not published`, for a name the
  workspace declares as a member or does not declare at all. The files whose
  declarations the source index did not read are named last, as not checked.
- f90242e: `variance ask symbol` and `ask uses` answer a name nothing declares on stdout and exit `0`, instead of refusing on stderr. The answer says what was read and declares nothing, where else the name may be written, and that a text search such as `rg` finds a name written only in a string or a comment. `variance-authority-help` answers the same way.
- 19447a9: `uses` answers the lines that use a field of an interface or a type

  `variance ask uses --name size` listed where a member named `size` was
  declared, and sent you to a text search for everything that touched it. Now
  each declaration on a named container is followed by the lines that read,
  write or destructure the member through a value whose type the line writes:
  `props: Props`, `value as Props`, `{ size: 3 } satisfies Props`,
  `({ size }: Props) =>`. Each line says its package and how it uses the member:
  `use.ts:6 — @acme/lib, write`.

  The type's name is followed through the import that binds it, renamed or
  passed on by a barrel, to the file that declares it, so `Props.size` and
  `Other.size` are listed apart, and a value typed as neither is a use of
  neither. What a type checker would infer stays the text search's, which the
  answer still names.

  The source index records these uses with each file's parse, in format version
  23; `variance index` rebuilds an older one.
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
- cc6bf99: `variance ask uses` now names the kind of each declaration a file keeps to itself, the way `ask symbol` does. A Rust `mod walk;` and the `pub(crate) fn walk` inside it share a spelling and are two declarations. The answer listed the function's imports and then said "`walk` is declared, not exported, at src/lib.rs:1", which read as a second fact about the same function. It now says "`walk` [module] is declared, not exported, at src/lib.rs:1". When a name has several such declarations, each line carries its own kind, so a `function` in one file and a `const` in another are told apart.
- 2162c57: `ask uses` on a member says which uses it lists, and asks the declaration's type checker for the rest

  `variance ask uses --name <member>` and `docs_uses` list a use of `Props.size`
  only where the line writes the value's type. The answer now ends with two lines
  that say so: a use through an inferred value, a generic, a subtype by `extends`
  or `implements`, a JSX attribute, a utility type or an inline type literal is
  not listed, because no type checker runs. The second line names the
  declaration's `file:line` for find-references in the declaration's own
  language's tooling (TypeScript's language service for JavaScript and
  TypeScript, its language server for any other), or, with several
  declarations, asks for the one you mean from the list above. These two lines
  replace the `docs_grep` route the answer used to end with; `variance ask grep --to <declaring file>` still finds the name as
  text. Which uses are listed has not changed, and an answer with no member
  prints neither line.

  The skill reference tells an agent to use both tools: `variance` for
  declarations, imports, the module graph and the recording, the language's type
  checker for anything that needs a value's type.

  Members are read from JavaScript and TypeScript files only, and a name nothing
  declares now says so. Where the source index holds Python, Rust, Java, Kotlin
  or Swift files, `ask symbol` no longer says no file declares the name "at its
  top level or as a member": it says no file declares it at its top level and no
  JavaScript or TypeScript file declares it as a member, names those languages,
  and sends you to their language server's workspace symbols, then its
  find-references. `ask uses` ends its refusal with the same sentence, and a
  member answer of either ends with it too, since a member of those languages may
  be declared there as well. A workspace of JavaScript and TypeScript alone keeps
  the old sentence and prints no new one.
- d7627d4: `variance index` says which step it is on, and how long each one took

  On a large checkout, `variance index` used to print nothing for a minute or
  more, so a slow step looked the same as a hung one. It now writes one line to
  stderr as each step starts, such as listing the checkout with git, reading what
  changed, reading the package manifests or publishing the questions, and writes
  the line again with the time the step took when it ends. In a terminal the step
  that is running stays on one line, with a clock that counts up while it runs
  and a note of how many other steps are running beside it. A log gets the start
  line and the end line, and nothing in between. A command that waits on another
  process's follow-ups shows that process's latest line, and how long it has
  waited. stdout still holds only the answer.

## 0.15.0

### Minor Changes

- 86bd9f5: `variance ask stack`, and `docs_stack` on the MCP server, list the agent
  skills an installed package ships. A skill is a `skills/<name>/SKILL.md` beside the package's
  `package.json`, the layout TanStack Intent set for npm. Each is listed under
  its package with its name, the file to read and the first sentence of the
  description in its front matter. Nothing is installed or copied: your agent reads the file from
  `node_modules`, at the version you installed. A `SKILL.md` deeper inside a
  package is not listed.

  The dependency lexicon moves to version 9 and records each package's skills.
  A lexicon written before this release still answers, and `stack` says that
  skills were not read until `variance index` refreshes it.
- 14aefbf: Ask what one test, or one story, checks that the narrower ones inside it do
  not.

  - `variance ask test-composition --file <test> --name <words>`, and
    `docs_test_composition`, read one recorded test as the smaller tests whose
    regions sit inside its own, the larger tests holding it, and the regions no
    smaller test entered: modules only it enters, and paths through a smaller
    test's module only it takes.
  - `variance_composition {subject}` closes with the same reading for a story:
    the smaller stories inside it, the larger ones holding it, and what no
    smaller story renders — components only it mounts, and components a smaller
    story renders another way. The run carries it per subject in the report's
    structure section; `piecesOf` in `@variance-authority/core/attribute`
    computes it.
  - A component mounted by more than half the suite's subjects is structure. A
    subject that mounts a component many times now counts once, where every
    mount used to count: a chip story is an example of the chip again when the
    pages around it mount chips many times over.
- 63091f7: `variance ask intersection` answers the files every one of two or more questions answers

  Each operand is a whole question, typed in quotes the way it would be asked
  alone — `variance ask intersection 'symbol --name selectBalance' 'discover
  --from src/Wallet.tsx'` — and any question whose answer is a set of files can
  be one: `symbol`, `uses`, `search`, `grep`, `discover`. Each is read whole,
  never capped, so a file past the first fifty of either question still meets.
  The answer counts each question's files, then lists the files in all of them,
  each with the lines that put it in each question. `variance-authority-help
  intersection` and `docs_intersection` answer the same, the tool taking its
  questions as `{question, input}` objects.
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
- 42599cc: `variance ask discover` answers the files in every one of several sets

  Each set is read whole, with no cap: what a path reaches (`--from`) or what
  reaches it (`--to`), who imports a name (`--imports module#name`, through the
  barrels that pass it on when the module is a file, as `ask uses` reads it), who
  declares a name matching a pattern (`--declares`), and a path pattern (`--path`). Each
  has an `--except-` twin that takes its files out, and `--text` runs ripgrep over
  the files the other sets kept. The answer lists the files nearest the paths
  first, each with the line that put it in each set.

  `readTree` hands each file's declared and imported names to a `names` callback
  during the same scan, read off the parse it already made; a file whose parse
  holds no declarations, as on a checkout large enough for the addon to read
  whole, is read again for them, and the source index keeps what that read
  found. `readNamedTree` takes the question and reads names only for an operand
  that needs them. Over MCP,
  `docs_discover` answers `from`, `to`, `path` and a name imported out of a
  repository file, and refuses `declares` and any other `imports`, because the
  reading an MCP host serves holds no names.
- 4fe70b5: `variance ask symbol` and `ask uses` answer a name a file exports and no entry publishes

  They used to refuse it. `symbol` gives the file and line that export it, the
  line as the checkout holds it, and how many imports resolved to that file, one
  count per file when several export the name. An installed name it matches is
  said after it, since a file that passes an installed binding on exports it.
  `uses` lists each of those imports, within the package as well as from another
  one, read from the source index; an import through an `export *` file and a
  call through a qualified path are not counted. A name nothing exports is still refused.
  `@variance-authority/sense` adds `importersOf`, every import of a name out of
  given files that the source index resolved.

### Patch Changes

- 8c9ce5f: `variance ask symbol` answers an installed name from its declaration first. A
  package whose main entry declares the name is no longer also reported through
  its other entry points that declare nothing: `ask symbol --name config
  --package dotenv` prints `dotenv · config [function]` and its signature, without
  the `dotenv/config` and `dotenv/lib/*` entries and their README passages above
  it. A package that declares nothing still points to its README, now after any
  declared match. Its entry points are listed one per line, with the README path
  and passage printed once below them instead of once per entry point.
  Only entry points of the same installed copy are left out: a second copy of the
  same version, in another workspace, that declares nothing still points to its
  README.
- 6b1583e: A path names one file, and a path that ends like it is another file

  Four places related two names by how they end or what they spell, and each is
  now exact.

  A built module's lines are read back through its map only from the source that
  resolves to the file, as the Source Map specification resolves one: behind
  `sourceRoot`, beside the map. A source that ends like the file but resolves
  elsewhere, such as `src/a.ts` in a map beside `dist/a.js`, is another file and
  its segments are not read. A map with no source that resolves to the file used
  to have every segment read as the file's lines; the module is now recorded as
  the text that was handed over, under its own name.

  `variance ask symbol` and `ask uses` with `--package` naming one file of a
  package, such as `@acme/lib/src/internal/math`, answer from the file an import
  of that specifier resolved to. When nothing imports it, the file it names is
  not known, and the name is refused with that reason, rather than answered from
  a file whose path ends like the specifier.

  A Playwright test's name, in its recorded coordinate and in the vantage
  listing, is its `titlePath` after the file, the first entry. A describe that
  spells the file, its leaf name or the project is no longer dropped from the
  name.
- 5eca879: A module's `require` calls are read from the code. A `require('...')` written
  in a comment, a string or a template's text is no longer a request, so a
  comment such as `// require('...')` no longer adds a third-party package named
  `...`. `` require(`./plain`) `` and `` import(`./plain`) `` are read like their
  quoted forms, and `import('a' + 'b')` is a load this cannot read rather than a
  request for `a' + 'b`. `module.require('x')` is a request for `x`, and another
  object's `require` method is not. `import x = require('y')` is read as a
  request for `y`.

  A declaration package's `export =` is read from the code as well, so an
  `export = name` inside a comment publishes nothing, and `export=Name` or
  `export = Name` without a semicolon publishes its namespace. An `export =`
  inside a `declare module "x" { … }` body names a namespace or an
  `import x = require('y')` from that body or from the top of the file.

  The source index format moves to version 17, so an index written before this
  release is rebuilt once instead of keeping the requests it read from comments.
  The dependency lexicon moves to version 8: an older lexicon still answers
  questions, and the next `variance index` rewrites it in full instead of
  carrying its entries forward.
- b75761a: `ask journey-map` and `ask slowest-tests` name only the path you asked about when nothing holds it

  When a path was in neither the recording nor the files git lists,
  `journey-map` and `slowest-tests` offered another recorded path as the one you
  meant: one a typo away, or the recorded files that share its file name, so
  `src/test-selection/since.ts` was answered with `src/commands/since.ts`, a
  different file. Two paths are two files, so the refusal now names the asked
  path, says it read the recording and the files git lists, and that both name
  each file from the repository root, and names no other path. The same holds for
  `docs_journey_map` and `docs_slowest_tests` over MCP.
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
- 4fe70b5: `variance ask search` finds a name from the words it is written in

  A query of several words matches a name when each word matches one of the
  words the name is written in, split at a change of case or between a letter and
  a digit, so `kept reading` finds `keptReading` and `parse http response` finds
  `parseHTTPResponse`. A search index written before this is encoded again on
  the next read.
- 8187fb1: `didYouMean` and `nearest` are exported from `@variance-authority/core` and no
  longer from `@variance-authority/mcp/tools`. Import them from
  `@variance-authority/core`. A mistyped command or flag is refused, with the
  nearest right one, without loading the MCP server's tools.
- 9d92cef: `uses` lists every import of a published name, inside its own package, through a barrel and through `import x = require()`

  `variance ask uses` answered a published name only from the imports that cross
  a package. An import within the publishing package, such as
  `import { a, b } from './execution.js'`, was not listed, and a name only its
  own package imports read as "nothing in this workspace imports it". The
  imports within the package are now read from the source index, as they already
  were for a name no entry publishes: every import of the file that declares the
  name.

  An `export … from` passes the name on and is not a use. The file that writes it
  is followed under the name it exports, so an import through a barrel is listed
  and the barrel is not, in another package as well as in its own. This includes a bare `export *`, which passes on every
  name but `default`. An import of a renamed re-export ends `(as <name>)`, and a name an entry
  publishes under another name than its declaration is read from that entry. A
  type-only re-export, `export { type name } from`, passes nothing on and is
  listed as a type use where it is written. A read through an `export * as`
  namespace, and a call through a qualified path, are not counted, and every
  answer that read the source index ends by saying so. A same-named export of
  another file is not counted. With `--package` naming one subpath specifier, an
  import through another specifier of the same package is left to that one.

  When the source index is missing, or does not read, `uses` for a published name
  still lists the imports from other packages and says why the rest were not
  read; it no longer fails. `symbol` names both halves of what `uses` lists. For a
  name a file exports and no entry publishes, `symbol` counts an import through a
  barrel once, under the file that declares it, and no longer shows the barrel as
  a second export. When the source index is missing or does not read, `symbol`
  answers such a name and says why it could not read who imports it, instead of
  failing.

  TypeScript's `import x = require('m')` holds the module whole, like
  `import * as x`. The module reader now records `x.name` and `x['name']` after
  it as reads of `name` through that request. `uses` lists each one marked
  `(namespace, line N)`, and `symbol` counts the package. A type-only
  `import type x = require()` holds nothing. The source index format moves to
  version 19, so the first `variance index` after upgrading reads every file
  again.

  `@variance-authority/sense`'s `importersOf` returns `{ uses, through }`: each
  use carries the name it takes, and `through` names the files that pass the
  name on.

## 0.14.0

### Patch Changes

- 58d3332: The help server and `variance serve` describe every source question they answer

  `variance-authority-help --help` said `serve` answers "all six" questions, and the instructions `variance serve` sends an MCP client said "nine"; both serve eleven. Neither states a count now, and the `variance serve` instructions name the two they had left out: which third-party packages a location can use (`docs_stack`) and which code the recorded tests ran around a file (`docs_journey_map`). The verb list in `--help` is padded to its longest verb, so `slowest-tests` and `journey-map` no longer run into their descriptions.

  The READMEs of both packages link the documentation on variance-authority.dev instead of a repository-relative path, which does not resolve where npm shows them.

## 0.13.0

### Minor Changes

- ebbec80: A call the source leaves short is placed from what the case ran, and no test runner's config is read

  The journeys walk no longer reads Vite's or Vitest's `resolve.alias`. When an import resolves to no function, the walk places the call on the one function the case entered that a file of the checkout exports under the imported name. That is the default export for a default import, and the member for a call through a namespace import. When the import names a workspace package, the function must be exported from that package. An import of a Node builtin, or of a package a manifest declares and no workspace holds, is never placed this way. When several entered functions match, the call is reported as ambiguous, and the walk's other inferences still get a turn. An import that resolves to a function the case did not enter stays where it resolved. `variance index` counts both outcomes in its journeys line, and the orient legend names a recorded caller.

  `@variance-authority/sense` no longer exports `runnerAliases`, `runnerConfigs`, `runnerDigest`, `keptRunnerAliases`, `unlistedRunnerAliases`, or the types `RunnerAlias` and `RunnerAliases`. `NativeJourneysPrepared` loses the `aliased` and `runnerUnread` fields, and `prepareJourneys` on the native binding takes the Node builtin names as a new last argument.
- 573afba: A third-party name in `ask search` and `ask symbol` says whose manifest offers it

  Each installed third-party name in a `variance ask search` answer gives its version, the manifest that offers it, how that manifest declares it (`dependency`, `optional`, `peer` or `dev`), and how many times the code under that manifest imports it, with the first import as `file:line`. `variance ask symbol` prints the same line above the declaration. With `--from` or `--to`, `ask search` offers a name only when the manifest that owns one of those paths declares or imports its package. A package that only another workspace declares is left out, even when the path imports that workspace. When no third-party name matches, the answer says how many packages it searched and under which manifests. The next `variance index` rewrites the dependency lexicon with these fields.
- 573afba: `variance ask stack --from <path>` lists every third-party package a path can use

  It takes no words. `variance ask stack`, and the `docs_stack` tool on the workspace API server, read the manifest that owns the path and list each package it declares or that the code under it imports: the version, the role (`runtime`, `dev` or `types-only`), how the manifest declares it, and how many times the code imports it, with the first import as `file:line`. Imported packages come first, then the ones declared and not imported, then the ones whose imports were not read. A declaration the resolver could not read is listed with the reason. A page is 40 rows unless `--limit` says otherwise, and `variance ask` takes `--offset <n>` to skip rows. Each page ends with how many rows remain and the `--offset` that asks for the next page. The answer reads only the dependency lexicon that `variance index` writes and opens no installed package. `dependencyStackNative` in `@variance-authority/sense` is the call it makes.
- 573afba: `variance index` returns once the source index is written

  Outside CI, `variance index` writes the source index, starts a process of its own for the code map, the journeys, the dependency lexicon and the questions `variance ask` answers from, and returns. Its last line names that process and the log its lines are written to:

  ```text
  follow-ups: the code map, the journeys, the dependency lexicon and the questions are being made by process 48213, and the next variance command waits for it; their lines are written to <cache>/test-selection/<digest>/source-index.bin.follow-ups.log
  ```

  Every later `variance` command waits for that process before it reads anything, and says on stderr that it is waiting. When the process ended before it finished, the next command makes what it left and prints those lines on stderr. In CI, or with `--wait`, `index` makes all four before it returns. `--follow-ups` is what the started process runs, and is refused together with `--wait`.

  The source index is a base and one working layer over it that holds the files changed since the base was written. An update reads again only the files whose bytes changed, rewrites the working layer and never the base, and writes nothing when nothing changed. The started process folds the working layer into the base, writing the two as one new base, once the working layer has a tenth as many records as the base, counting added and deleted files. On Kibana (107,163 files), the update after a one-file edit takes 165 ms over an empty working layer and 220 ms over eleven thousand changed files, and the fold takes 620 ms.

  `prepareCodeMap` in `@variance-authority/sense` and `refreshDependencyLexicon` in `@variance-authority/help` return a promise. `@variance-authority/sense` exports `readySourceIndex`, which folds the working layer into the base, and `@variance-authority/help` exports `refreshWorkspaceFromIndex` and `publishedGeneration`.
- 573afba: `variance ask journey-map` draws the code around a file from the recorded tests that match your words

  `variance ask journey-map --file <path> [--query <words>]`, and the `docs_journey_map` tool on the workspace API server, read the latest recording. They run nothing and open no source. A test is kept when its file path or its name contains any of the `--query` words; with no words, every test that ran the file is kept. The answer says how many recorded tests ran the file and how many were kept, and lists the kept tests smallest first. Then it lists each function of the file with the paths the kept tests took through it. Beyond the file, it lists the functions most kept tests ran, nearest first, and then the functions only some of them ran, grouped with the smallest test of each group. A function beyond the file that at least half of all recorded tests ran is counted and not listed. Every suite with a recording answers under its own name. `journeyMaps(root, file, terms)` in `@variance-authority/sense` returns the map for every suite.
- 573afba: `variance ask orient --files` names the cases that ran a file by importing it, and gives every share and package flow as counts

  The recording credits no case with code that ran while a module was evaluated. For such a file, `orient --files` finds the recorded test files that import it, over the source index, and counts their cases: `5 cases ran it, 3 of them by importing it`. When the source index names no importers, the line says so. In the packages part, every share has its count beside it, and a share over fewer than 10 uses is printed as the count alone, for example `3 of 7`. The package flows of the recorded cases are headed `Observed:` and count the packages each case ran code in together, as combinations and not as calls from one package to another. A `variance ask search` answer that lists exported names ends with the `variance ask orient --files` question for the first file it names. `orientAround` in `@variance-authority/sense` reads the packages and the external dependencies around a set of files in one pass.
- 573afba: `variance ask search` finds an installed package by what it says it does

  `variance ask search --query "state management"` lists, after the name matches, the installed packages that describe that job. When `variance index` refreshes the dependency lexicon, it stores the word stems each installed package uses: from its manifest `description` and `keywords`, its README headings, its package name, and its exported names with the first sentence of their documentation. A package is listed when those stems contain at least half of the distinct stems of the query. A package whose own description, keywords or headings contain them comes before one that matches only through its names. Each row gives the version, the manifest that offers the package and how it declares it, how many times the code imports it, the package's description, and the query words it matched. A question reads only the stored stems and opens no package. A dependency lexicon written before this release answers without these rows until the next `variance index` rewrites it.
- 573afba: `variance ask symbol --from <path>` answers as the workspace that owns the path

  For an installed third-party name, `--from` takes a file or a directory, and the answer uses the manifest that owns it: the version installed for that workspace and the signature declared in that version. Two workspaces that install different versions of one package each get their own signature. When that manifest neither declares nor imports the package, the answer says the name is not usable from the path and lists every manifest that offers it, each with its version.
- 573afba: `variance layers` gives each package its dependency layer and its tier, and against a base names the packages whose own code changed them

  A package that imports no other package of the repository is layer 1. Any other package is one more than the highest layer among the packages it imports. `variance layers` lists every package by layer, read from the code map that `variance index` writes beside the source index. `variance layers --against <index>` compares the checkout with a source index built at a base. It lists each package whose own dependencies changed its layer, with the packages it started or stopped importing, and gives the number of packages that import it and changed layer only as a result. Packages that appeared or vanished are listed apart. The command exits 0 whatever it finds. With `--format markdown` it prints nothing when nothing changed, and its first line is `<!-- variance-authority:layers -->`, so a CI job can post, update or delete one pull-request comment from it. `--format text` and `--format json` are the other two formats.

  Declare `tiers` in the root `variance.config.json` to also place each package by how much code it pulls in. It is a list of line budgets, largest first, for example `"tiers": [200000, 20000, 1000]`. Each entry is one tier, numbered from 0: here tier 0 is 200000, tier 1 is 20000 and tier 2 is 1000. A package is in the highest-numbered tier whose budget fits its size, so a package of 15,000 lines is tier 1 and one of 500 lines is tier 2. Tier 0 holds every package, whatever its size, so its budget only labels it. The size is the lines of code, without blank lines and comments, in the files the package ships and every file they import, through `import()` and through further imports, up to the imports of installed packages. The files a package ships are its files that are not tests and not used only by tests. Type-only imports are not counted. Nobody writes a package's tier down; its imports decide it.

  With `tiers` declared, `variance layers` prints each package's tier, lines and files next to its layer. When part of a package's code could not be sized, such as a stylesheet, a file the index could not parse or an import it could not resolve, the tier prints as `tier ≤ 1`: tier 1 or a lower-numbered one. It names, once, the packages whose manifest has no `exports`, `main`, `module` or `bin` naming a file of theirs, because their shipped code is then taken to start at the files the package's own code never imports. Against a base, it reports tier changes the same way as layer changes, with each package's own lines before and after.

  `variance ask orient` numbers dependency layers from 1. The code map format changes, so a checkout indexed by an earlier version has no layers to read until `variance index` runs again. `packageLayers`, `layerMoves`, `tierMoves`, `declaredTiers`, `parseTiers`, `tierOf` and `tierLabel` in `@variance-authority/sense` are what the command reads.

### Patch Changes

- 3f240e9: `variance ask search`, and any source question asked with `--just-answer`, refuses with exit code `2` when nothing is published for the checkout, and names `variance index` as the command that publishes it. Before, a fresh checkout or worktree printed the refusal as a defect in the tool, with a stack trace under it.
- b3c1bdf: `variance ask uses` and `ask symbol` answer for a name that no entry publishes but that another package imports by the path of its file, such as `addTax` from `@acme/lib/src/internal/math`. They no longer refuse it. Each import is listed with its file and line and marked as a deep import, past the entry the package declares, or as an import by path from a package that declares none. `symbol` also says where the name is declared and why nothing publishes it. A name that is exported without being published and that nothing imports is still refused, and the refusal names the file and line that export it.

  A workspace package with none of `exports`, `main`, `types` or `typings` is no longer skipped. `ask packages` and `ask entrypoint` list it by the files and names other packages import from it, each with the importer's file and line, and none of those imports are called deep. A `.js` `main` with no `types` and no `.d.ts` beside it opens at the `.ts` or `.tsx` source of the same stem, as TypeScript reads it.
- 59be40a: A pnpm workspace's packages open, and `reach` walks past a file the diff deletes

  A root manifest with no `workspaces` reads its members from `pnpm-workspace.yaml`, so `ask entrypoint --package @mui/material` answers on Material UI. The list is read as YAML and its entries as globs, so an entry starting with `!` excludes what it matches, a `**` glob reads every member under it, and a list written at its key's own indent, in flow style or under a byte-order mark reads the same as any other. A member two entries match is read once. A bare `.js` export opens by the `.d.ts` written beside it, and a published name followed through a JavaScript module reads that declaration. A workspace that publishes no package says so in a sentence, where it printed an empty list.

  `variance reach --since <ref>` takes the files the diff deletes out of the walk and names them on stderr. A diff that only deletes refuses, and the refusal names the deleted files.
- 27a4713: An `exports` field written as conditions opens `.`, and a custom condition in `tsconfig.json` is followed

  An `exports` string, an array of fallbacks, or an object with no `.` key now publishes `.`, as Node reads it. Before, each condition key was taken as a subpath, which invented names such as `@tanstack/solid-querytanstack/custom-condition`. An object that mixes subpaths and conditions is refused and the manifest is named, because Node refuses to load it. A condition listed in the package's `tsconfig.json` `customConditions` (through `extends`) is followed to the source it names when it comes before `types`, so Zod's `@zod/source` and TanStack's `@tanstack/custom-condition` open their `src/` files. Every config in that `extends` chain is read as JSONC whatever its name, so a comment in a `tsconfig.base.json` is read rather than refused. A pattern target with no extension, such as `./src/v4/locales/*`, opens one subpath per TypeScript file it matches, spelt with the emitted extension. An import of a subpath that `exports` names exactly is no longer reported as reaching past a published entrypoint when that subpath's source could not be read; it is listed under unreadable instead.
- b2317fa: `variance ask journey-map` says why a file has no map

  When the recording lists nothing for the file you asked about, the answer says why.

  - A test file is named as a test file, with the three modules its recorded tests ran most. Each module shows how many of the file's tests ran it and how many of all recorded tests did.
  - A directory is named as a directory: the map is drawn around one file, so the answer asks for one of the files in it.
  - A path that git does not list in the checkout and the recording does not hold is refused as not in the checkout. The refusal names the recorded path one typo away, as `ask slowest-tests` already does, or else the recorded files with the same name in other directories. A file on disk that git ignores is named as ignored instead.
  - A file that existed at the commit the recording was made at and is gone from the checkout is named as deleted since, from the CLI and from `journeyMap` alike.
  - A file that did not exist at that commit is named as new since the recording.
  - For any other file, the answer says no recorded test loaded it only when git lists it at that commit, the test run instruments files of its kind, and the recording lists other files in the same directory. Files in the directories below do not count, and a file at the repository root is judged by the files at the root. Even then the answer names the one case the recording cannot rule out: a module the test run is configured to leave uninstrumented. Otherwise the answer says the recording cannot tell, and why.
  - The path may be spelled through `..` or from the root of the file system; the map names it from the root of the checkout. A path outside the checkout is refused as outside it.
  - `journeyMap` and `journeyMaps` take the listing `checkoutListing` returns, so a caller that already asked git about the path does not ask again.
  - `ask journey-map` and `ask slowest-tests` share one check for a path that is not in the checkout. It accepts a new file that git lists as untracked and not ignored, which `ask slowest-tests` refused before.
- 2f75494: `ask symbol` answers a re-exported name through the door the workspace imports it by

  When several packages publish one declaration, as every TanStack Query adapter re-exports `@tanstack/query-core`, the answer led with the first package read and its own count, so `QueryObserver` came back as imported from `@tanstack/angular-query-experimental` and "used by nothing outside its own package". The door with the most importing packages, then the most imports, now leads; the others follow under "Also published by".

## 0.12.0

### Minor Changes

- 0d67928: `symbol` names the README of a dependency that ships no declarations, and the passage that names the symbol
- 63751d2: `variance ask orient --files` names the calls into and out of each file

  `variance index` now walks each case of the latest recording over the static call graph and writes the result beside the source index. `orient --files <path>[:<line>]` reads it: for each file, the functions the most cases ran, the functions in other files that call into it and those it calls, each with its case count and how the call is known, and the package flows those cases take through the file. With a line, the calls narrow to the function holding it, and a line written after the recording says so. When the recording or the index changed after the walk, the answer says `not prepared` and why, and never answers from an older walk. The walk resolves an import the way the test runner did, through each Vite or Vitest config's `resolve.alias`.

## 0.11.0

### Minor Changes

- 7556a03: The cache is inside the checkout. Without `cacheRoot` in `variance.config.json`, it is `node_modules/.cache/variance-authority` at the repository root, so a coding agent whose sandbox allows writes only in the working tree records and reads the same cache as your terminal and CI. `XDG_CACHE_HOME` is no longer read; `VARIANCE_AUTHORITY_CACHE`, an absolute path, names the cache directory for a harness that keeps its runs apart. A recording under `~/.cache/variance-authority` is not read, so the first `yarn test` after upgrading records again. `variance index` also publishes the value `variance ask` answers from, so `ask search` answers in a fresh checkout, and prints a `questions:` line saying where it is or why it could not be written. [The cache](https://variance-authority.dev/docs/cache) page describes the order.

  `readWorkspace` in `@variance-authority/help` takes `packs`, whether the scan reads bytes from Git's object store, and `saveIndex`, whether publishing also writes the scan's records back to the source index; `variance index` turns it off, because it has just published that index itself.

### Patch Changes

- 56282b1: `variance index` exits `2` with `source index not written: <reason>, at <path>` when the file system refuses the index, instead of reporting it built. `updateSourceIndex` returns the refusal as `refused`; a scan anywhere else still treats an unwritable cache as a cold next run. A `variance ask` question no longer narrows the source index it reads: a workspace whose path runs through a link, such as a checkout under macOS's `/var`, is scanned whole, and a scan of only some of a repository's directories publishes its answer without writing over the index of the whole. Before, either one could leave `variance select` unable to trace a lockfile bump to the tests it reaches.

## 0.10.0

### Minor Changes

- 947337c: A test-selection recording keeps each test file's and each test case's duration as its runner reported it

  The coverage file gains a `tests.duration` column: the whole milliseconds Vitest, Jest or Rstest reported for the file, or the `duration` you pass to `startRecording().finish()`. The case index gains the same column for each case: Vitest's task result, Jest's assertion result, Rstest's test result, or the `duration` of a case in the `cases` you pass to `finish()`. A file or case the runner reported nothing for has no duration, never zero, and recordings written before this open with every duration absent.

  `variance ask slowest-tests` (`docs_slowest_tests`) lists the files, then the cases, the latest recorded run spent longest in. `--from <path>[,...]` keeps the tests declared under those paths, `--to <path>[,...]` keeps the tests the recording says entered code in them, and the two combine; counts are within that scope, a `to` path the recording has no row for is named as unrecorded, and a path in neither the recording nor the checkout is refused with the nearest recorded path. `recordedDurations` and `recordedPaths` in `@variance-authority/sense` are the reading behind it. `didYouMean` and `nearest` move to `@variance-authority/mcp/tools`, so both binaries suggest a name the same way.
- 25297df: `variance ask orient` takes the files you already have, and searches no text

  `orient --files <path>[,...]` (`files` on `docs_orient`) answers each file in the order you gave it: its package, or that the source index does not hold it, then what those packages take from other packages and what other packages take from them, and the recorded cases that ran each file. `--query` is gone: finding a file is what `search`, `symbol` and `grep` are for, and a call without files names them. Nothing in the answer reads a file's text, so it no longer runs `git grep` over every tracked file once per word.

### Patch Changes

- 68c9240: `export default name` records `name` as the export's `local`, where it recorded `default`. The exported name already says `default`, and the identifier is what joins the default to the file's own declaration or to the import it republishes, through that request's bindings. A default that is an expression or an anonymous declaration still has no `local`. Stored parses are read again once, because the source index they are kept in moves to a new version.

  Help follows `export default name` to its import by that `local`, so a comment between `default` and the name no longer stops it with "no declaration there says what it is". A name the file declares is still answered by its declaration: `export const logger = OriginalLogger` is a `const`, as TypeScript's declaration emit publishes it.

## 0.9.0

### Patch Changes

- aa57273: `ask uses` finds a name your code reads off `import()` or `import * as`. It used to answer that nothing imported `narrowByJourneys` when `select-command.ts` read it as `selection.narrowByJourneys` after `const selection = await import(…)`. Such a site now names the line that loads the module, and an `import()` site says the module loads when that call runs, not when the file loads.

  The parse carries these reads as `members`, apart from each request's `bindings`, so test selection reads exactly what it read before. The source index moves to version 12 and the help snapshot to version 3, and each is rebuilt on the first question after the upgrade.
- 47e6664: What the CLI, the MCP tools, the servers and the GitHub action print is shorter. An explanation that repeated on every row now prints once, as a header or on the first line that needs it. The reasoning behind an answer stays in the source and is no longer printed. The source snapshot footer is one line, `Snapshot <time>.`

  A changed file in a language the verdict does not read, such as Rust or Python, now reads as `unread (not a JavaScript or TypeScript module)` instead of as a file that does not parse. It is charged the same way.
- 990ac1a: The agent skills name the commands that ship

  The test-selection skill no longer says there is no command line: it routes
  to `variance select`, `reach`, `index` and `covering`. The CLI skill lists
  every command that reads no config, and covers `covering --hops`, `--cases`,
  the per-file rows, `gained` motion and the `unrecorded` refusal. The workspace
  skill names `variance ask` as the same six questions.
- 93d53c8: One `variance-authority` skill ships in `@variance-authority/cli`, with a reference file per question, and `variance doctor` says whether your agent can find it

  The skill lives at `skills/variance-authority/`, where skill finders that read
  `skills/<name>/SKILL.md` see it. Its `SKILL.md` routes each question to one file
  under `references/`: reading a run, locating a subject, a live run, producers,
  covering, test selection and its wiring, distillation, the workspace API and
  MCP. It now also holds the test-selection guidance that shipped in
  `@variance-authority/sense` and the workspace-API guidance that shipped in
  `@variance-authority/help`; neither package ships a skill any more.

  `variance doctor` looks in `.agents/skills` and `.claude/skills`, in the project
  and your home directory, and reports each shipped skill as a link, a matching
  copy or a stale copy. For a skill it cannot find, it prints the `ln -s` that
  would serve it. It writes nothing, and the finding never changes the exit code.

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

### Patch Changes

- 8e2a8e5: One connection answers about the run and about the code

  `variance serve` served the report tools and nothing else. An agent in a
  workspace that already had the CLI still had to configure
  `variance-authority-help` as a second MCP server to ask what a package
  publishes or where a name is declared — and that second server was the only
  place a start point could be said at all, because `serve` passed no checkout
  root, so `from` and `to` were refused over the transport the workspace was
  already using. The six source questions had been on `variance ask` since the
  fold began; the fold stopped at the shell.

  Both tool sets now mount over one composite subject, so `tools/list` on
  `variance serve` returns the twelve questions about the run and the six about
  the source, and the six read the checkout the server was started in. Which
  half is read is decided by the question: a report is a file and is re-read on
  every request, a workspace reading is a scan and happens only when one of the
  six is what was asked, so a connection that never asks about the source never
  pays for one.

  Two options on `serve` in `@variance-authority/mcp` carry that, and are useful
  to anyone hosting these tools over more than one subject. `subject` is now
  handed the name of the tool a request calls, where it calls one, so a host can
  read only the half the question needs. `remember` says what is worth keeping
  for the next request, in place of the default structured clone of the whole
  subject: the one tool that compares this request with the last one compares
  reports, and cloning a whole workspace reading on every successful call would
  buy that comparison nothing.

  `@variance-authority/help` is unchanged as a package. What changed is what its
  pages say: a workspace that has the CLI needs nothing from it over either
  transport, and the standalone binary is for the workspace that runs no visual
  suite.

## 0.4.1

### Patch Changes

- Say who expands the query

  `variance_locate` and `docs_search` match the words they are given and expand
  nothing: no thesaurus, no stemming past a trailing plural, no model. That was
  true before and said only in the source, so an agent holding `auth` against a
  repository that writes `CredentialGate` read a miss as an absence rather than as
  a wrong vocabulary, and asked the same question again in longer words.

  Both tools now say it in the description the caller reads, and both skills say what
  to do instead: ask again in a different kind of name — what the screen says, what a
  component is likely called, the file it is likely declared in — rather than a
  reworded description of the same thing. The caller holds the ticket and the
  codebase the word came from, which is the context a shipped synonym table would
  be guessing at.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.2.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

First release.
