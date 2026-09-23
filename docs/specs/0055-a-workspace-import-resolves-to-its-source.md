# Spec 0055 — A workspace import resolves to its source

**Missing:** the owner between a workspace member's manifest and its source.
When a member's `exports` or `main` names only built output, the scan asks the
manifest and lands in `dist`, or on nothing when `dist` is not built.
`toRepoPath` (`packages/sense/src/resolve.ts:414-421`) drops a `dist` landing.
The importing record lists the specifier under `unresolved`
and gains a `packages` edge by name. No record has a file edge from the importer
to the member's `src/`, so an edit there selects nothing through the scan's
graph. The tsconfig that emitted `dist` states exactly which source file each
output came from, and nothing reads it backwards.

This spec lands after 0.6.0. In 0.6.0 a workspace import that resolves into
`dist` is `unresolved`, with a `packages` edge by name, and this repository
bridges it in `tools/since-graph.mjs`.

## 1. The promise

A bare import that names a workspace member will resolve to the member's
original file. The answer will not depend on whether `dist` exists. A built
checkout and an unbuilt checkout of the same commit will produce byte-identical
records.

A workspace member is a package directory that is inside the repository root and
has no `node_modules` segment in its real path. Third-party packages and registry
copies of a member do not qualify. They keep the `packages` edge they get today.

Every fact the answer uses will be decided by tracked bytes: the member's
`package.json`, its `tsconfig*.json`, and the lockfile that decides which
TypeScript is installed. Nothing under an emit directory is read.

## 2. Owner order

The resolver asks four owners in this order and stops at the first answer.

**0. The caller's settings.** `conditionNames`, `tsconfig` and tsconfig
`paths`. Unchanged; this is the first pass `resolved()` makes today
(`packages/sense/src/resolve.ts:267-317`).

**1. The member's manifest.** A `source` export condition, or a top-level
`source` field. Unchanged: `DEFAULT_CONDITIONS` (`packages/sense/src/resolve.ts:49`) leads with
`source`, and `mainFields` (`packages/sense/src/resolve.ts:179`) is `['source', 'module', 'main']`.

**2. The member tsconfig that emits into the target, read backwards.** New.

*rootDir:*

- If `rootDir` is set, use it.
- Else, if `composite` is set, use the config file's directory.
- Else, if the installed TypeScript is 6 or later, use the config file's
  directory. The version is read from `typescript/package.json`, resolved from
  the config's directory. The lockfile that decides it is already in the config
  digest (`reuse.ts:112`).
- Else, decline. TypeScript 5 computes rootDir from the file list
  (`getCommonSourceDirectory`), and a scan that does not compile cannot know
  that list.

*Extension rows* follow TypeScript's own inverse table, in TypeScript's order
(TypeScript 6, line 20418 of `typescript.js`):

| Emitted | Original, first match wins |
|---|---|
| `.mjs`, `.d.mts`, `.mts` | `.mts`, `.mjs` |
| `.cjs`, `.d.cts`, `.cts` | `.cts`, `.cjs` |
| `.d.json.ts` | `.json` |
| anything else | `.tsx`, `.ts`, `.jsx`, `.js` |

*Emit settings:*

| Setting | Rows |
|---|---|
| `noEmit` | none |
| `emitDeclarationOnly` | only the `.d.*` rows, under `declarationDir ?? outDir` |
| `declarationDir` differs from `outDir` | rows for both directories |
| `outFile` | decline |
| two configs emit into one directory from different roots | decline that directory |
| a non-relative `extends` | decline, with a `// TODO:` at that line to resolve it through the resolver |

*The re-ask.* The rows become aliases on a resolver clone, and the member is
asked the original question again:

- Alias keys are `${realPkgDir}/${outDir}/*${emittedExt}`, each mapped to
  `${realPkgDir}/${rootDir}/*${originalExt}` for every original extension in
  the row, in table order.
- The clone is built once for the whole repository, lazily, with
  `modules.cloneWithOptions({ ...fullBaseOptions, alias })`. The full options
  are passed because `cloneWithOptions` normalizes against oxc's defaults and
  does not merge: a clone handed only `alias` loses `conditionNames`,
  `mainFields`, `extensionAlias` and `tsconfig`.
- Keys are real paths, so the answer does not depend on how the member is
  linked into `node_modules`, and one clone serves every link.
- A member with `exports` is asked from `${realPkgDir}/package.json` with the
  original specifier, as a self-reference, so its own `exports` decides the
  subpath.
- A main-only member is asked for `realPkgDir + subpath`.
- The runtime-condition clone is asked first. If it declines, a types-first
  clone is asked, with `conditionNames ['source', 'types', 'import', 'require',
  'default']` and `mainFields ['source', 'types', 'module', 'main']`. This is
  the answer for `emitDeclarationOnly` members whose runtime entry is a bundle.
- Answers are memoized under `${pkgDir}\0${request}`. A key of the request
  alone is wrong: two members can be asked the same relative subpath.

**3. Nobody owns it.** The request stays in `unresolved` and `packages`, as in
0.6.0, and the record's `unknown` gains one sentence (section 4).

## 3. When the rewrite runs

All three must be true:

1. The request is bare.
2. The package directory is a workspace member (section 1). It comes from the
   real path of the first pass's `packageJsonPath`, which oxc computes today and
   nothing reads. When the first pass has no hit, it comes from a package-only
   lookup of `name/package.json` on a clone with `exportsFields: []` and
   `mainFields: []`.
3. The first pass failed, landed in `EXCLUDE_DIRS` (`packages/sense/src/resolve.ts:52-62`), or
   landed under one of that member's emit directories. The last case covers
   `outDir: lib`, which is not excluded and today produces an edge to built
   output.

The step goes into the `[modules, exact]` loop in `resolved()`: a landing under a
member's emit directory is not returned, and after the loop, before `return []`
at `packages/sense/src/resolve.ts:316`, the rewrite runs. The native path gets the same step in
`resolve` (`packages/sense/native/src/resolve.rs:73-103`).

## 4. When nobody owns it

The template is one constant in `origins.ts`, a new module in `packages/sense/src/`, used by the
JavaScript path and by `native.ts` when it renders the reason codes the addon
returns:

```
${specifier} names ${pkgDir}, and nothing in the repository says where its sources are: ${reason}. Add a "source" condition to its exports, or give it a tsconfig that emits into it.
```

`${pkgDir}` is repository-relative. The reasons are built from tracked facts
only:

- `no tsconfig there emits a file`
- `its tsconfig sets noEmit`
- `its tsconfig sets outFile`
- `tsconfig.a.json and tsconfig.b.json both emit into dist`
- `its tsconfig extends <name>, which this scan does not follow`
- `its tsconfig sets no rootDir and TypeScript <version> computes one from the file list`
- `<subpath> is not among what its tsconfig emits`

The sentence contains no oxc message, no `dist` path and no absolute path, so two
machines with different builds write the same sentence. It joins the other
reasons in `packages/sense/src/record.ts:148-153`, rendered as `${file} — ${reasons.join('; ')}`.

An unowned member never widens selection; that is true since `03984ae7`, and
this spec does not change it. The `unknown` does change one reading:
`foldBuilt` (`tools/since-graph.mjs:147`) leaves a file with `unknown` out of
`enumerated`, so a walk will not treat a dead end at that importer as a dead end
in the code. That is the correct reading of a file whose edge list has a named
hole.

## 5. Why source maps are not an owner

A source map states which original produced a built file, and it was considered
as owner 2. It is rejected:

- **Untracked.** `dist` is ignored (`.gitignore:21`), so a fresh checkout has no
  maps and no owner at all.
- **Stale.** `tsc --build` does not delete the outputs of a deleted input. This
  checkout has 16 orphan maps, among them
  `packages/cli/dist/commands/recorded-text.*`, `packages/event/dist/receive.*`,
  `packages/help/dist/usage.*`, `packages/mcp/dist/tools/brief.*`,
  `packages/sense/dist/test-selection/bands.*`,
  `packages/sense/dist/test-selection/jest-journey-command.*`,
  `packages/tribunal/dist/review.fixtures.*` and
  `packages/tribunal/dist/ui/__probe.*`. Each names a source that no longer
  exists.
- **Partial for bundles.** A bundle map lists the sources that contributed
  code. The entry file, a barrel and a type-only file are absent.
- **Built and unbuilt diverge by design.** The same commit would scan to two
  graphs, one per machine state.
- **Reuse breaks.** A record would depend on untracked bytes, so its witnesses
  would have to include files git cannot see. `reuse.ts` is sound because a
  record is a function of tracked bytes only (`reuse.ts:12-26`, `:46-52`).

A map is a check that runs after a build, not an owner. Maps stay with the
recorder: `source-lines.ts` `originalFile` (`:168`) owns line numbers for a
module the runner loaded, which is a different question from which file an
import names.

## 6. What the record and the reuse cache keep

- **`FileRecord`:** no new fields. Edges land on original files, and `unknown`
  can include the sentence in section 4.
- **Witnesses:** `witnessesOf` (`witness.ts:238`) adds the directory under the
  member's rootDir where the original is looked for, and, for an unowned member,
  the package directory. So adding the fixture's `ui/src/new.ts` invalidates the
  record that imports `@acme/ui/new`, and adding a tsconfig to an unowned
  member invalidates the records that named it.
- **Config digest:** already covers `tsconfig*.json`, `package.json` and the
  lockfiles (`reuse.ts:112-121`, `shapeOf` `:148-174`), so a change to any emit
  setting rebuilds every record.
- **`VERSION`** (`reuse.ts:103`, 3 in the working copy): bump to the next value
  after whatever concurrent work lands, because the same bytes now produce
  different edges.

## 7. Files and functions

| File | Change |
|---|---|
| `origins.ts` in `packages/sense/src/` (new, about 200 lines) | `originsIn(parsedConfigs, typescriptVersionAt)` returns `Map<realPkgDir, { rows, declined? }>`. `originOf(resolvers, origins, pkgDir, request)` returns `{ file }` or `{ reason }`. `originalOf(origins, repoPath)` returns the original of an emitted path, or `undefined` when no owner states one; tools use it. `unownedSentence(specifier, pkgDir, reason)` is the template in section 4. |
| `packages/sense/src/witness.ts` | `compilerOptions` (`:156-187`) also reads `outDir`, `declarationDir`, `rootDir`, `composite`, `noEmit`, `emitDeclarationOnly` and `outFile`, and records a decline for a non-relative `extends`. `aliasesIn` (`:78-139`) returns these beside the aliases, so each config is parsed once. |
| `packages/sense/src/reuse.ts` | `shapeOf` (`:148-174`) returns `{ shape, aliases, origins }`. `VERSION` (`:103`) is bumped. |
| `packages/sense/src/scan.ts` | `resolversFor(options)` (`:201`) runs before the tree exists (`:205-210`). The origins are assigned afterwards, the way `resolvers.tree` is at `:221`: from `shapeOf` (`:226`) when there is a tree, and from the config paths in the file list when `digests: false`. Both modes read the same files. |
| `packages/sense/src/resolve.ts` | `interface Resolvers` (`:71`) gains `origins` and the three lazy clones: runtime alias, types-first alias, package lookup. `resolved()` (`:267-317`) gains the step in section 3. About +20 lines; the file is 421 lines. |
| `packages/sense/src/record.ts` | In the bare-miss branch (`:121-145`), after `packages.push` (`:136`), look up the unowned reason through the same memo and push the sentence into `reasons` (`:148-153`). |
| `packages/sense/src/native.ts` | Pass the origins rows to the addon as data next to `tsconfig` and `conditionNames` (`:219-220`, `:249-250`). In `builtFromBatch` (`:271`), render each returned reason code with `unownedSentence`, so the wording exists once. |
| `packages/sense/native/src/resolve.rs` | `Resolvers::new` (`:20-71`) builds the alias clones with the full options, not `ResolveOptions::default()`. `resolve` (`:73-103`) gains the step. A new `unowned()` returns the package directory and a reason code. |
| `packages/sense/native/src/batch.rs` | `resolve_all` (`:233-267`) returns a parallel column of reason codes for misses. Both `Resolvers::new` calls (`:132`, `:173`) receive the rows. |
| `packages/sense/src/taint/index.ts` | `resolversFor(options)` at `:199` builds a second `Resolvers`. It receives the origins the scan built, not a table of its own (section 8). |

## 8. Consumers that stop recomputing

**`tools/since-graph.mjs`.** In the same change:

- Delete `target` (`:65`), `published` (`:80`) and `bridgeWorkspace` (`:118`),
  and the call at `:315`. They are a second resolver: `target` picks the first
  of `import`, `default`, `require`, `types`, which is not the condition order
  the runtime or the scan uses.
- `manifests` (`:39`) stays, with one caller. The plan this spec is built from
  listed it for deletion, but `packageFaces` (`:214`) reads it, and the manifest
  is the owner of what a package publishes. `packageFaces` names each published
  target through `originalOf` instead of `stemOf`.
- `foldBuilt` (`:147`) loses the input of its edge fold. Scan edges never land in
  an excluded directory (`toRepoPath`) and, after this spec, never under an emit
  directory either. `enumerated` stays. Whether `named` stays depends on whether
  the recording has any row under `dist`: `vitest.config.mts:53-58` says the
  recorder names a `dist` module by its `src` path through tsc's map. Count
  `dist` rows in a fresh snapshot first. If there are none, `named` is the
  identity on scanned files. If there are some, it goes through `originalOf`.
- `tools/since-graph.check.ts` loses the tests of `published` (`:26-48`) and
  `bridgeWorkspace` (`:86-139`). Its `foldBuilt` tests (`:50-84`) follow the
  decision on `named`, and its faces tests (`:141-162`) pass unchanged.

**`tools/page-side.mjs`.** `sourceStem` (`:112-118`) has three steps. Two stay:
the leading `../` fold, which is about worktree links, and the extension drop.
The third, the `packages/<name>/dist/` → `src/` regex, is replaced by
`originalOf` over a table built once when the config loads. `probeable`
(`:126-128`) and every `stemOf` caller then read the table:
`tools/test-since.mjs:152`, `:299` and `:353`, and `tools/since-diff.mjs:14`,
`:18` and `:43`.

**Mocks.** `targetFrom` (`packages/sense/src/taint/join.ts:38-49`) calls
`resolveTo`, which goes through the same `resolved()`. So `vi.mock('@acme/ui')`
and `import … from '@acme/ui'` land on the same original, provided the
`Resolvers` built at `taint/index.ts:199` has the scan's origins. Without them
the mock resolves to nothing while the import resolves to `src/`. This is the
likely cause of the mock difference an external check reported against
0.6.0: the mock resolved on its own, and `since-graph` bridged the import. It is
not tested yet; assertion 6 in section 10 tests it.

## 9. `docs/source.md`

- **Traversal and repository boundaries** (`:191-201`). Add `tsDist` and
  `storybook-static` to the list, which then matches `EXCLUDE_DIRS`
  (`packages/sense/src/resolve.ts:52-62`).
- **Workspace packages** (`:203-258`). Rewrite in present tense, second person.
  Open with the promise: a bare import that names a package in your repository
  resolves to its source file, built or not. Then the order: your `source`
  condition or field, which is also the answer for a package not built by `tsc`;
  the tsconfig that emits into the package, read backwards (rootDir, outDir,
  declarationDir, TypeScript's extension table); `paths`, for a manifest you do
  not own. List what declines and quote the sentence. Remove "Three arrangements
  give the edge back". Keep the `nx`/`turbo` `source.changes` paragraph if it is
  still true after the rewrite.
- **Unresolved and unknown** (`:317`). Add a row to the table (`:321-325`) for a
  member whose sources nothing states: `unresolved`, a `packages` edge, and the
  sentence in `unknown`.
- **Limits** (`:420`). Replace "Package edges are conditional" (`:437-441`) with
  what declines: TypeScript 5 with no `rootDir` and no `composite`; a package
  `extends`; Yarn PnP; a package built by something other than `tsc` with no
  `source`, stated as section 13 decides.

`packages/sense/README.md` names none of the three arrangements and needs no
change. The change adds a changeset. The decision that a member resolves to what
its tsconfig emits from goes into an ADR when this spec is deleted.

## 10. Tests

**Fixture:** `packages/sense/test/fixtures/dual-workspace/`, committed with no
`dist` and no `node_modules`. The plan named `packages/sense/src/__fixtures__/`;
that is wrong here, because `packages/sense/tsconfig.json` includes `src/**/*`
and excludes no fixtures directory, so `tsc --build` would compile the fixture.
Sense's fixtures already live in `test/fixtures/`, and a file there that must not
be collected is named `*.case.ts`.

Each test copies the fixture to a temporary directory, creates the
`node_modules/@acme/*` symlinks, and, for the built half, writes the `dist` files
as plain bytes, so no compiler runs.

| Member | Shape |
|---|---|
| `ui` | `exports`: `.` with `types` and `import`, `./util` → `./dist/util.mjs`, `./*` → `./dist/*.js`. tsconfig with `rootDir: src`, `outDir: dist`. |
| `legacy` | main-only, `composite`, no `rootDir`. |
| `bundled` | no tsconfig, `main: dist/index.cjs`. |
| `bundled2` | `emitDeclarationOnly` with `declarationDir: types`; `exports` with `types` and a `cjs` bundle; one nested subpath. |
| `leftpad` | third-party: a real directory under `node_modules`, not a link. |

`apps/web/src/main.ts` imports all five. `apps/web/test/ui.case.ts` calls
`vi.mock('@acme/ui')`.

**Assertions**, in `origins.test.ts`, beside the new module, unless named:

1. Unbuilt: `@acme/ui` → the fixture's `ui/src/index.ts`; `@acme/ui/util` →
   `src/util.mts`; `@acme/ui/deep/x` → `src/deep/x.tsx`; `@acme/legacy` →
   `src/index.ts`; `@acme/bundled2` → `src/…`, through the types-first clone.
2. Built: the whole record set is byte-equal to the unbuilt one.
3. `@acme/bundled` stays in `unresolved` and `packages`, and its `unknown` is the
   exact sentence, with no `dist` and no absolute path in it.
4. `@acme/ui/nope` gives the `<subpath> is not among what its tsconfig emits`
   reason.
5. `leftpad` gets a `packages` edge and no `unknown`.
6. The mock's join target equals the import's edge.
7. JavaScript and native records are equal, in
   `packages/sense/src/native-read.test.ts`.
8. `originalOf('packages/ui/dist/deep/x.js')` is `'packages/ui/src/deep/x.tsx'`,
   and a path under `leftpad` gives `undefined`.
9. Reuse: adding the fixture's `ui/src/new.ts` invalidates the record that imports
   `@acme/ui/new`, and no other record.

**Variants**, each its own `it`:

- TypeScript 5 with no `rootDir`: declines, with the TypeScript reason.
- `composite` with no `rootDir`: uses the config directory.
- `declarationDir` differs from `outDir`.
- `noEmit`.
- Two configs emit into one directory.
- A package `extends`: declines.
- `outDir: lib`: the first-pass landing is rewritten.
- A `source` condition present: the first pass wins, proven with a
  deliberately wrong tsconfig.
- A registry copy of a member: gets a `packages` edge.
- A map in `dist` pointing at a deleted source: ignored.
- A root given as a path through a symlink: identical records.

**Repository level:**

- Scanning this repository gives no `@variance-authority/*` specifier in any
  `unresolved`. Any member that declines is named in the failure message. Every
  `packages/*/tsconfig.json` sets `rootDir: ./src` and `outDir: ./dist` and every
  build is `tsc --build`, so the expected count is zero.
- `tools/since-graph.check.ts` passes with the bridge deleted.
- An optional check after a build: each `dist/*.js.map` with a single source
  agrees with `originalOf`. Orphan maps are reported, never trusted.

## 11. Out of scope

Each item gets a marker at its line when this spec is built. `// FIXME:` is used
where the item is a defect in code that ships, as `AGENTS.md` requires.

| Item | Marker |
|---|---|
| A relative import into a sibling member's `dist` | `it.todo` in `origins.test.ts` |
| Yarn PnP: `oxc_resolver` is pinned without the `yarn_pnp` feature (`packages/sense/native/Cargo.toml:42`) | `it.todo` in `native-read.test.ts` |
| TypeScript 5's computed rootDir | `it.todo` in `origins.test.ts` |
| A non-relative tsconfig `extends` | `// TODO:` at the decline in `witness.ts` `compilerOptions` |
| A package built by something other than `tsc` | decided by section 13 |
| `exact` is built on oxc defaults: `packages/sense/src/resolve.ts:200` passes only `extensionAlias`, and `packages/sense/native/src/resolve.rs:65` passes `ResolveOptions::default()`, so both lose `conditionNames`, `mainFields` and `tsconfig` | `// FIXME:` at both lines |
| `build` is exempt when seeding (`files.ts:69`, `seed.rs:69`) and excluded at resolve time | `// FIXME:` at `files.ts:69` |
| The map fallback in `source-lines.ts` `originalFile` (`:168`) fails silently, and `decode` (`:244`) is a second VLQ decoder | `// FIXME:` at both lines |
| The `BUILT` regex in `vitest.config.mts:61`, used at `:75` | `// TODO:` to name built modules through `originalOf` |
| `packages/package/src/manifest.ts` `sourceOf` (`:232`), a second reader of the same fact | `// TODO:` to read it from `origins.ts` |
| `.compass/variance-authority/reach/source-scan/README.md:44-52` says sibling built-output landings are dropped and selection fills the gap | none: a Compass Create task, not a marker |

## 12. Cost

- The table is built once per scan, from configs `aliasesIn` already parses. No
  new file is opened.
- The rewrite runs only when a bare import of a workspace member misses or lands
  in built output, and is memoized per package directory and request.
- Alias keys are real paths, so the whole repository needs three clones: two
  alias clones and one package lookup, each built on first use.
- Size: about +200 lines in `origins.ts`, +20 in `resolve.ts`, +40 in
  `witness.ts`, +10 in `record.ts`, +60 in Rust, and about 120 lines deleted
  from `tools/since-graph.mjs` and its check.

## 13. Open decision: a package built by something other than `tsc`

A member built by tsup or Vite typically has a tsconfig with `noEmit` and a
manifest with no `source` condition. Nothing tracked states which source file
produced its bundle. Both readings change what the product promises, so the
owner decides:

- **(a) Unowned, with a sentence naming the one-line `source` fix.** The record
  gets the section 4 sentence with the reason `its tsconfig sets noEmit` or `no
  tsconfig there emits a file`, and the fix is one `source` condition in the
  member's manifest. This follows "every answer has an owner" exactly, and built
  and unbuilt checkouts stay byte-identical. It is a position, stated in the
  Limits section of `docs/source.md`, and it needs no marker.
- **(b) An edge from the directory convention (`dist/*` → `src/*`) or from the
  bundle's source map.** Automatic for every bundler, but it is a guess: the
  convention is true of most repositories and not of the ones that break it,
  and the map is subject to every objection in section 5, including different
  graphs for built and unbuilt checkouts. Under (b) the case is an `it.todo` in
  `origins.test.ts` until the guess is built.

Recommended: **(a)**.

## 14. What will discharge this spec

The fixture in section 10 will pass all nine assertions and every variant, on
the JavaScript and native paths, in a checkout with no `dist` and again after
writing one. This repository's scan will have no `@variance-authority/*`
specifier in any `unresolved`, and `tools/since-graph.mjs` will have no
`published` and no `bridgeWorkspace`. `yarn test:since` over a change to
`packages/core/src/format/index.ts` will select the tests of `packages/cli`
through scan edges alone.

When those checks pass, the decision in section 13 and the owner order will be
written into an ADR, `docs/source.md` will state the order in present tense, the
out-of-scope markers will be in place, and this file will be deleted.
