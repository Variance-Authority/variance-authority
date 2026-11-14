# Spec 0055 — a workspace import nothing maps says why

**Missing:** the sentence for a workspace package nothing maps. A bare import of
a package in the repository whose manifest names built output, and whose
`tsconfig` does not say which source that output is emitted from, keeps the
specifier under `unresolved` with a `packages` edge by name, and the importing
record has no `unknown`
([`source.md`](../source.md#workspace-packages)). The edge list has a hole the
record does not state, and nothing tells the adopter the one-line fix. The rest
of what this spec asked for shipped: the manifest's `source` condition and field
are asked first, and a landing under a workspace package's `outDir` is read as
the file under `rootDir` it is emitted from, built or not
([ADR-0080](../context/adr/0080-built-output-is-read-as-its-source.md)).
**Built on:** [ADR-0080](../context/adr/0080-built-output-is-read-as-its-source.md)
(which packages a layout maps, and the guess it forecloses),
[ADR-0069](../context/adr/0069-every-answer-has-an-owner.md) (every answer has
an owner), [unresolved and unknown](../source.md#unresolved-and-unknown) (the
table this adds a row to).

## 1. The promise

A record whose edge list has a hole says so, and names who could close it. A
bare request normally names a dependency outside the repository, which is why it
is recorded under `unresolved` and not as a hole. A request that names a package
the repository holds names repository source, as a relative one does, and when
nothing maps it to that source the importer's edges are incomplete.

A workspace package is a directory inside the repository holding a
`package.json` whose real path has no `node_modules` component, as ADR-0080
defines it. Third-party packages and registry copies of a workspace package do
not qualify, and keep the `packages` edge and no `unknown`.

## 2. The sentence

The importing record's `unknown` gains one sentence:

```
${specifier} names ${pkgDir}, and nothing in the repository says where its sources are: ${reason}. Add a "source" condition to its exports, or give it a tsconfig that sets outDir and rootDir.
```

`${pkgDir}` is repository-relative. The reasons are built from tracked facts
only, and follow the rules ADR-0080 reads a layout by:

- `no tsconfig there sets outDir`
- `its tsconfig sets no rootDir`
- `its tsconfig sets noEmit`
- `its tsconfig emits only declarations`
- `<subpath> is not among what its tsconfig emits`

The sentence contains no resolver message, no `dist` path and no absolute path,
so a built and an unbuilt checkout of one commit, and two machines with
different builds, write the same sentence. The wording exists once, and the
native and JavaScript scans write it alike. It joins the record's other reasons.

The sentence changes no edge.

## 3. A package built by something other than `tsc`

A package built by tsup or Vite typically has a `tsconfig` with `noEmit`, and a
manifest with no `source` condition. Nothing tracked states which source file
produced its bundle, so it gets the sentence, with the reason
`its tsconfig sets noEmit` or `no tsconfig there sets outDir`, and the fix is one
`source` condition in its manifest. The other reading, an edge from the
`dist/*` → `src/*` convention or from the bundle's source map, is foreclosed by
ADR-0080: it is a guess, and a map is an untracked artefact.

## 4. What will discharge this spec

A fixture of workspace packages, committed with no `dist` and no
`node_modules`, whose test links them and, for its built half, writes `dist`
files as plain bytes:

1. A package with no `tsconfig` and `main: dist/index.cjs` stays in
   `unresolved` and `packages`, and its importer's `unknown` is the exact
   sentence, with no `dist` and no absolute path in it.
2. The records of the built half are byte-equal to the unbuilt half's.
3. A subpath the package's `tsconfig` does not emit gives the
   `<subpath> is not among what its tsconfig emits` reason.
4. A third-party package under `node_modules` gets a `packages` edge and no
   `unknown`.
5. The JavaScript and native records are equal.

When those pass, [`source.md`](../source.md#workspace-packages) quotes the
sentence where it now says such an import has no `unknown`, its
[unresolved and unknown](../source.md#unresolved-and-unknown) table gains a row
for a workspace package nothing maps, the decision is written into an ADR, and
this file is deleted.
