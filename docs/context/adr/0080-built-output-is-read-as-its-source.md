# ADR-0080 — built output is read as the source it is built from

**Status:** accepted
**Date:** 2026-09-26
**Amends:** [ADR-0038](0038-a-change-reaches-a-component-through-files.md) — its
package boundary, and what `nx` and `turbo` are asked for
**Relates to:** [ADR-0069](0069-every-answer-has-an-owner.md) (the configuration
owns what a setting means),
[`packages/sense/native/src/emitted.rs`](../../../packages/sense/native/src/emitted.rs),
[`packages/sense/native/src/emitted_tests.rs`](../../../packages/sense/native/src/emitted_tests.rs),
[`packages/sense/src/emitted.ts`](../../../packages/sense/src/emitted.ts),
[`packages/sense/src/emitted.test.ts`](../../../packages/sense/src/emitted.test.ts)

## Context

ADR-0038 left the package boundary as a hole. In a workspace, `@scope/ui`
resolves through the `node_modules` symlink into that package's manifest, the
manifest names `./dist/index.js`, `EXCLUDE_DIRS` drops every target under
`dist/`, and the importing record keeps `@scope/ui` under `unresolved`. `nx` and
`turbo` were to supply the edge at project granularity, and computing it from
the manifests was rejected as a second workspace resolver.

That position did not hold on the repositories this project reads.

- **This repository.** The package manifests point their entries into
  `./dist`, and 504 of 627 cross-package imports landed there and were
  dropped. Test selection did
  not notice, because the recording names a `dist` module by its `src` path
  through `tsc`'s `.js.map` (`vitest.config.mts`, `PRODUCT`). Every reader that
  asks the store did notice: orientation, `variance reach` from source, and the
  no-row fallback in `test-selection/importers.ts`, which walks a new or
  unrecorded module to its importers and found none across a package line.
- **The premise elsewhere.** The lockfile readers skip workspace entries because
  "the file graph already holds it, edge for edge" (`lock/lockfile.ts`,
  `lock/yarn.ts`). In a repository whose manifests export `dist/`, it did not.
- **The owner was never the manifest.** The manifest says which built file a
  consumer loads. What that file *is* is written in the `tsconfig` that emits
  it: `outDir` is where output goes and `rootDir` is the tree it mirrors.
  TypeScript already reads it backwards: with project references, the
  language service redirects an import of a referenced project's output to the
  source it maps to through that project's `outDir` and `rootDir`, and opens the
  source instead (`disableSourceOfProjectReferenceRedirect` turns it off).

## Decision

**A resolution that lands under a workspace package's `outDir` is read as the
file under `rootDir` it is emitted from, and the answer does not depend on
whether the package was built.** The resolver is unchanged: oxc still reads the
manifest, the `exports` map, the conditions and `paths`. Only its landing is
read back through the layout that produced it, so this is the owner's answer
and not a second resolver.

- **Native, through the file system.** `Emitted` implements
  `oxc_resolver::FileSystem` and every resolver in `Resolvers` reads the disk
  through it. A path under a declared `outDir` exists exactly when its source
  does, with the source's metadata and bytes, so `./dist/index.js` resolves in a
  checkout with no `dist/`, and output left by a build older than a deletion is
  not there. `resolve()` then returns the source path.
- **The emit rule, backwards,** sources in preference order: `.d.ts` from
  `.ts .tsx .js .jsx .d.ts`; `.d.mts` from `.mts .mjs .d.mts`; `.d.cts` from
  `.cts .cjs .d.cts`; `.js` from `.ts .tsx .js .jsx`; `.jsx` from `.tsx .jsx`;
  `.mjs` from `.mts .mjs`; `.cjs` from `.cts .cjs`; `.json` from `.json`. Any
  other file under `outDir` — a stylesheet a build step copied — is read from
  the disk as itself: under an excluded directory such as `dist/` it is
  dropped, and under one that is not, such as `lib/`, it is the edge's target.
- **Who declares.** A directory holding a `package.json` whose real path has no
  `node_modules` component. It reads its `tsconfig*.json` files, `tsconfig.json`
  first and the rest in code-unit order, and takes a layout from each whose
  chain sets both `outDir` and `rootDir` and does not set `noEmit`. A config
  that emits nothing did not put anything in its `outDir`, and one that sets
  `emitDeclarationOnly` put declarations there and no code: its `.d.ts` files
  map, and the code beside them is some other tool's and is read from the
  disk. Docusaurus's base
  config sets `noEmit`, `outDir: "${configDir}/lib"` and
  `rootDir: "${configDir}/src"`, and three of its packages type-check their
  root with a `tsconfig.json` that keeps `noEmit` and sets `rootDir: "."`,
  building `src/` into `lib/` with a `tsconfig.build.json` or
  `tsconfig.server.json` that lifts it. Read as a layout, the first would map
  `lib/` onto the package root, where no source is. The chain is read the way
  `tsc` reads it: the nearest config that names the option wins, of several bases the last
  one, a relative value is relative to the config that wrote it, `${configDir}`
  is the declaring directory, and `null` clears. The output directory must lie
  strictly inside the package directory and must not contain the source.
  Configs naming one `outDir` are all kept, in the order they are read, and the
  first whose `rootDir` holds the source answers: a package whose
  `tsconfig.json` sets `rootDir: "."` for the editor and whose
  `tsconfig.build.json` narrows it to `src` writes `dist/index.js` from
  `src/index.ts`, and the first config alone would look for `index.ts` at the
  package root. The deepest output directory wins, at any depth inside
  another, and a directory inside one declares nothing.
- **Git lists the configs.** A scan that carries git's tree reads which
  manifests and configs a directory holds from that listing, tracked and
  untracked alike, and asks the disk only for a directory git did not descend:
  outside the root, ignored, or a repository of its own. A path git vouches is
  a regular file — committed with a file mode, and unchanged since — holds
  nothing, so the `<file>/tsconfig.json` that oxc probes for every importer is
  answered without a system call. A symbolic link is a blob to git as well and
  may name a package directory, so it is never vouched for; nor is anything the
  working tree moved. A directory holding a manifest or a config git could not
  hash is read from the disk, because git did not answer for it. A scan with
  no tree reads the disk throughout.
- **A source is read where it points.** The resolver never saw the source, so
  a mapped source git does not vouch is canonicalized before it is compared
  with the tree, and a committed link inside `rootDir` lands on the file an
  import of the link would.
- **`sideEffects` is written against what the package publishes.** A pattern
  such as `./dist/register.js` is matched against the source and against every
  path the package's layouts write it to as code, so the declaration still
  reaches the file the graph holds.
- **A config git ignores does not declare** when its directory is listed. It
  is a file the repository says is not part of it, and a `tsconfig` generated
  into a checkout by a build is the case the listing is right to skip.
- **`rootDir` is required.** Without it TypeScript 5 infers the common directory
  of the inputs and TypeScript 6 takes the config's own directory, so an
  `outDir` alone does not say which tree it mirrors.
- **JavaScript, after the fact.** The npm `oxc-resolver` binding takes no file
  system, so `resolve.ts` applies the same rule (`emitted.ts`) to the path the
  resolver found on disk. It agrees with the native side where the build
  matches the source, and parts from it where they differ: output never built
  or a source added since is not found, stale output the resolver tries first
  answers for it, a config git ignores declares, and an `outDir` that links out
  of the package is followed before the layout is read. That is a `FIXME` at
  `landed()` in `resolve.ts`; taint resolves through this path.

## What this forecloses

- **Reading an artefact to learn the source.** No `.js.map`, no `.d.ts.map`, no
  `tsbuildinfo`. The build does not have to exist, and a stale build cannot
  answer. The recording keeps reading source maps, because what it records is
  what ran, and a map is what the runner loaded.
- **Guessing by convention.** `dist/x.js` is never read as `src/x.ts` because the
  names line up. A package with no `tsconfig` stating both options keeps the
  hole, and so does the code of one built by a bundler with its own
  configuration (tsup, a Vite library build, Rollup, Babel) whose `tsconfig`
  sets `noEmit` or `emitDeclarationOnly`. One whose `tsconfig` states both
  options and emits is read by that `tsconfig`, whoever runs the build.
- **Rerouting a published dependency.** A layout declared under `node_modules`
  is not read, even when the package ships its `tsconfig`: its source is not in
  this repository.
- **`nx` and `turbo` as the answer for a package `tsc` builds.** They remain
  seeds for what no `tsconfig` describes, and for repositories that want
  project granularity on top of the file graph.

## Cost

- **What it bought.** In this repository the store gained 1,293 file edges and
  lost none. In Docusaurus, 679 targets moved from `lib/` to `src/`, none were
  lost, and the walk reads 1,302 files instead of 1,605, because it no longer
  follows a package into its build. Material UI, whose packages resolve to
  source already, scans to the same 89,146 targets.
- **What it costs.** Every metadata call the resolver makes looks up the layout
  of its directory. Each directory's answer is carried down from its parent's,
  and memoized with the sharded map and hasher `oxc_resolver` keeps its own
  path cache in, shared by every resolver in a `Resolvers`; a package
  directory's `tsconfig*.json` files are worked out once for each path it is
  reached by. A whole-repository scan of
  Material UI takes 331–341 ms against 323 ms without the rule, medians of ten
  interleaved runs, which is inside the spread between runs. Walking every
  ancestor per directory instead cost 54 ms, and asking the disk for the
  `<file>/tsconfig.json` probes cost most of the rest.
- **Every stored record is resolved again once.** A record's key names the
  file's bytes and every `tsconfig*.json` in the tree, and neither moves when
  the rule does, so the key's version does (`reuse.ts`). Without it a store
  kept its `dist/` edges: the first Docusaurus orientation after this change
  read 41 build files through records made before it.
- **A reused record can miss a source file added in another package.** A bare
  request into a workspace package that resolved to nothing has no witness in
  that package, so a record made before `new.ts` was added under its `rootDir`
  keeps `@s/b/new` unresolved until the importer or a config changes. The gap was
  there for packages exporting their source; this rule widens it to packages
  exporting their build. It is a `FIXME` at `witnessesOf` in `witness.ts`.
- The JavaScript twin parts from the native side wherever the build and the
  source differ, until the binding takes a file system, or taint resolves
  through the addon's `resolveSources`.
- A package whose build writes somewhere its `tsconfig` does not say reads
  wrong. The `tsconfig` owns the answer, so a build that overrides it on the
  command line (`tsc --outDir`) is a build this cannot see.
