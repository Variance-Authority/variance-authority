# @variance-authority/sense

**Requires:** the repository on a disk this process can read, in the state its
imports were written against — dependencies installed, so a bare specifier
resolves to something, and any `tsconfig.json` whose `paths` the source relies on
present where the source expects it.

What this project can tell about a codebase by reading it rather than by running
it: what a change could have moved, and what a run actually crossed.

## The question

A visual-regression suite that runs everything on every commit is a suite people
turn off. `--since` already narrows a run to the subjects whose components a diff
touched — and it gives up the moment a changed file declares no component:

```
src/tokens.css changed → nothing declares a component in it → run everything
```

That file is the one every design system is most afraid of. So is the shared
helper, the theme provider, the icon nobody thinks about. Naming the components a
file *declares* cannot answer for any of them, because the answer is two hops
away: `tokens.css` ← `button.css` ← `Button.tsx` ← `Button`.

This package walks those hops.

| entrypoint | requires | holds, and when you want it |
|---|---|---|
| `.` | a readable checkout | the scan: walk the configured roots, resolve what they import, follow it, and produce one record per file. This is the one to take. |
| `@variance-authority/sense/read` | nothing but a string | the two readers, without a disk. Take it when the file contents come from somewhere else — a bundler plugin, an editor buffer, an already-open VFS — and only the specifier extraction is wanted. |
| `@variance-authority/sense/instrument` | nothing but a string | the transform that records which regions a run entered. A different question from the rest of this package: not *what could a change reach* but *what did execution actually cross*. Take it in a bundler plugin. |

## What it produces, and who answers with it

A `FileRecord` per file. The graph, the traversals, and every question asked of
them live in [`@variance-authority/core`](../core/src/relate), which requires
nothing and opens nothing: the fold from records to structure is a pure function,
so a repository that already computes its own dependency graph can produce
records from that instead and every answer downstream is identical.

```ts
import { scanRelations } from '@variance-authority/sense';
import { movedBy, relationsOfFiles } from '@variance-authority/core';

const relations = relationsOfFiles(await scanRelations({ root: '.', dirs: ['src'] }));
const moved = movedBy(relations, ['src/tokens.css']);

moved.components; // ['Button']
moved.opaque;     // files seeded because their own edges could not be read
```

## What a second scan costs

A scan is on the path of every run that selects, so the interesting number is not
the first one — it is the one after a one-line edit. Three things arrive already
known, and each removes a layer:

```ts
import { openParseCache, openRecordCache, scanRelations } from '@variance-authority/sense';

// Anywhere outside the work tree. The CLI puts both under `XDG_CACHE_HOME`,
// keyed by repository root.
const cache = await openParseCache('/var/cache/variance/parse.json');   // what bytes said
const reuse = await openRecordCache('/var/cache/variance/records.json'); // what edges they became

const records = await scanRelations({ root: '.', dirs: ['src'], cache, reuse });
await Promise.all([cache.save(), reuse.save()]);
```

`gitDigests` names every file's content **without opening one** — a blob's name
*is* the hash of its contents, so `git ls-tree` plus `git status` is the whole
walk. It is called for you unless a caller passes its own map or `digests: false`.
`openParseCache` is keyed by those digests and so can never go stale: two files
with one digest had one content, on any machine, in any branch, in any year — a CI
runner that has never seen this branch still holds an entry for nearly every blob
in it. `openRecordCache` keeps the **edges** as well, which is not a pure function
of the bytes, so it is additionally keyed by a digest over the repository's path
set and resolution settings: any file appearing, disappearing or moving costs one
full scan, and every run that only edits files costs the diff.

30,500 files and 40,479 edges, one Mac, `yarn workspace @variance-authority/sense bench`:

| | cost | what it did |
|---|---|---|
| `gitDigests` | 95 ms | 30,501 digests, no file opened |
| cold | 3002 ms | every file opened, decoded, parsed, resolved |
| parses remembered | 657 ms | nothing opened, nothing parsed — every specifier still resolved |
| records too | 236 ms | nothing resolved. ~95 ms of it is the `git` call |
| after a one-file edit | 236 ms | the diff, and nothing else — inside the noise of the row above |

The last two rows are the claim: **a warm scan costs the diff rather than the
repository**, and the residue is the directory walk. Note where the saving is not
— parsing was never the expensive half once it was cached; resolution was.

## The rule that makes it safe to select on

**A missed edge is not a smaller answer. It is a wrong one.**

A file that imports the file that changed, and whose imports could not be
enumerated, produces a green run over a surface nobody looked at. So a file that
cannot be read says why, and every consumer treats it as though it changed:

| what was found | what happens |
|---|---|
| `import('./' + name)` — a computed specifier | the file widens |
| `require(whatever)` — a call this could not read as a literal | the file widens |
| a parse that did not finish | the file widens |
| `./missing-thing` — a relative specifier that resolves to nothing | the file widens |
| `some-package` — a bare specifier that resolves to nothing | recorded, and nothing widens |

The last row is the only asymmetry and it is deliberate. A relative specifier
names a path inside this repository and could not be identified; a bare one names
a package, and no package is in a diff of this repository.

Widening is reported separately from reaching — `opaque` beside `components` — so
"we could not tell" never arrives dressed as "we found".

## What it reads

A **module** is parsed by `oxc`, and only its ES module record is touched: static
imports, static exports, `import()`. The full syntax tree is available behind the
same result and is the expensive half, so a scan pays for a parse and not for a
tree. `require` is a text scan, because the module record cannot see it.

A **stylesheet** is a text scan: `@import`, `@use`, `@forward`, `url()`, and CSS
Modules' `composes … from`. There is no CSS grammar here, and this over-reads
rather than under-reads — a specifier inside a comment costs a collection, and a
specifier nobody saw costs a component.

An edge's kind comes from how it was written and what it landed on. `import
'./button.css'` is written as an import and is an **asset**, which is what lets a
caller walk code only. A type-only import stays a type import wherever it points:
nothing it names survives compilation.

## Where it stops

At the repository edge, and at the package boundary.

A specifier that resolves outside the root — into `node_modules`, or into a
sibling package's built `dist` — is dropped rather than drawn. Neither can appear
in a diff of this repository, so an edge to one could never carry a change.

That leaves a real gap wherever one workspace package imports another, and it is
the gap `nx` and `turbo` were built to fill: both already compute which projects a
diff affects, across exactly that boundary. The CLI unions their answer into the
seed set rather than choosing between them —
see [`docs/selecting.md`](../../docs/selecting.md).

## What a run crossed

Everything above answers *what could a change reach*. `/instrument` answers the
other half — *what did execution actually cross* — by splicing a recording call in
front of every execution boundary.

```ts
import { instrument } from '@variance-authority/sense/instrument';

// undefined if the source could not be parsed — *not instrumented* is a report,
// and an empty block list would read as *not executed*.
const done = instrument('export const price = (n: number) => (n > 0 ? n : 0);', 'src/price.ts');

done?.code;            // the same source, with probes, on the same lines
done?.blocks;          // one entry per region. `blocks[0]` is always the module
```

A **block** is a region with exactly one arrival condition, and a probe goes only
where control can diverge. Entering a `try` follows from entering the region around
it, so it gets nothing; entering its `catch` does not, so it gets a probe. That
test is the whole of the design, and it is why this is a third of the counters
statement coverage would insert rather than a rename of it.

Every insertion is single-line, so **line numbers are preserved exactly** and a
stack trace still points where it did. Nothing is re-printed: probes are spliced at
offsets in the original text.

The emitted runtime is two hoisted functions and a global lookup. Its absence is
not a crash — instrumented code with nothing listening runs correctly and records
into a private array, which is what makes differential execution possible. Every
call site is guarded with `typeof`, so a function whose *source* crosses into
another realm — `page.evaluate(fn)`, a worker built from `fn.toString()` — runs
there and records nothing rather than throwing.

It is presence, not path: a counter per region, no stack, so it answers *this test
entered this block* and not yet *by what route*.

```bash
yarn workspace @variance-authority/sense census
```

```bash
yarn workspace @variance-authority/sense overhead
```

The first counts what it would place across a real repository and prices it against
Istanbul's rules. The second times a real workload with and without probes, beside
a second uninstrumented copy that establishes the noise floor —
[journal 0027](../../docs/context/journal/0027-what-instrumentation-costs.md) has
the numbers.
