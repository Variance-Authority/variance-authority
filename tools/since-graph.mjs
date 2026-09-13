/**
 * Where the suite's imports point, in one coordinate system.
 *
 * `test-since.mjs` walks the distance from a change to a test through the
 * modules that test entered, and the walk is only as good as the graph it is
 * given. In a workspace that graph arrives in two halves. The scan reads
 * `packages/<name>/src`; the runtime resolves every cross-package import through the
 * manifest and lands on `packages/<name>/dist`. Both names are one module, and a
 * graph that keeps them apart does not answer *further away* — it dead-ends at
 * the first cross-package hop, which in a workspace is most of them.
 *
 * So the built copy is folded onto the source the scan actually read, the same
 * fold `sourceStem` already performs for the snapshot. What survives the fold
 * unmatched is the honest remainder — a package nothing scanned, a dependency
 * outside the tree — and it is reported as such rather than walked through.
 */

import { relationsOfFiles } from '@variance-authority/core/relate';
import { openSourceIndex, scanRelations } from '@variance-authority/sense';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * What each workspace package publishes, read from the manifests.
 *
 * The scan resolves a specifier and then refuses a resolution that landed in
 * `dist`, which is right for a graph of somebody's source and leaves this
 * repository's own graph as one island per package: every cross-package edge is
 * a manifest `exports` entry pointing at built output. The specifier survives on
 * the record as `unresolved`, so the manifest is asked the same question the
 * resolver was, and the answer is folded back onto source by {@link foldBuilt}.
 *
 * The manifest is the authority here for the same reason it is everywhere else:
 * it is what the runtime read. A directory scan guessing `src/<subpath>.ts`
 * would be a second resolver, and would be wrong about every package whose
 * entry points are not spelled after their files.
 */
export function manifests(root, dirs) {
  const found = new Map();
  for (const dir of dirs) {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(join(root, dir, entry.name, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      if (typeof manifest.name === 'string') {
        found.set(manifest.name, { at: `${dir}/${entry.name}`, manifest });
      }
    }
  }
  return found;
}

/** The first file path in an `exports` value, whichever condition holds it. */
function target(value) {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return undefined;
  for (const condition of ['import', 'default', 'require', 'types']) {
    const found = target(value[condition]);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The repository path a bare specifier names, when a workspace package publishes
 * it. `undefined` for a real third-party package, which is not this graph's
 * business.
 */
export function published(packages, specifier) {
  for (const [name, { at, manifest }] of packages) {
    if (specifier !== name && !specifier.startsWith(`${name}/`)) continue;
    const subpath = specifier === name ? '.' : `./${specifier.slice(name.length + 1)}`;
    const exports = manifest.exports;
    const found =
      exports === undefined
        ? subpath === '.'
          ? target(manifest.module ?? manifest.main)
          : undefined
        : typeof exports === 'string'
          ? subpath === '.'
            ? exports
            : undefined
          : target(exports[subpath]);
    if (found === undefined) return undefined;
    return `${at}/${found.replace(/^\.\//, '')}`;
  }
  return undefined;
}

/**
 * Put back the edges the resolver dropped for landing in built output.
 *
 * Kind `imports` for all of them, including the ones that were written `import
 * type`: the record keeps the specifier and not what it was asked for, and this
 * repository's rule for an uncertainty is to resolve it towards running more.
 * The cost is bounded — a type-only edge can only shorten a path between two
 * modules the test entered at runtime anyway, because the walk never leaves what
 * ran.
 */
export function bridgeWorkspace(records, packages) {
  return records.map((record) => {
    const extra = [];
    for (const specifier of record.unresolved ?? []) {
      const to = published(packages, specifier);
      if (to !== undefined) extra.push({ to, kind: 'imports' });
    }
    return extra.length === 0 ? record : { ...record, edges: [...(record.edges ?? []), ...extra] };
  });
}

/**
 * Fold every edge that landed on a built copy onto the source it was built from.
 *
 * Edges only. A `dist` node with in-edges and no out-edges is not a leaf — it is
 * a file nobody opened — and the two are indistinguishable in the structure, so
 * the fold happens before the graph exists rather than being patched around
 * afterwards. `enumerated` answers for what is left: the nodes the scan read,
 * which is the set a walk may treat a dead end in as an actual dead end.
 *
 * `named` is the other direction, for a caller holding a name from the snapshot
 * rather than from the graph: *which node is this file, now that the two copies
 * are one*.
 */
export function foldBuilt(records, stemOf) {
  const read = new Set();
  const scanned = new Map();
  for (const record of records) {
    // A file whose imports could not be enumerated is still a file the scan
    // read, and is still the copy a built twin folds onto. It is only missing
    // from `read`, which answers a different question: whether a dead end here
    // is a dead end in the code.
    if (record.unknown === undefined) read.add(record.file);
    // First name wins, and the scan reads `src` before `dist` is even a
    // candidate — but a tree holding both would fold onto whichever it read
    // first, which is stable within a run and is all the fold needs.
    const stem = stemOf(record.file);
    if (!scanned.has(stem)) scanned.set(stem, record.file);
  }

  const folded = records.map((record) => ({
    ...record,
    edges: (record.edges ?? []).map((edge) => {
      if (read.has(edge.to)) return edge;
      const onto = scanned.get(stemOf(edge.to));
      return onto === undefined ? edge : { ...edge, to: onto };
    }),
  }));

  return {
    records: folded,
    enumerated: (file) => read.has(file),
    named: (file) => scanned.get(stemOf(file)),
  };
}

/**
 * Every path a package publishes, folded onto the source it was built from.
 *
 * One walk of the `exports` tree rather than a lookup per question: a face
 * provider is asked once per hop on every trail in the reading, and the set it
 * answers from does not change between them.
 */
function published_entries(manifest) {
  const found = [];
  const walk = (value) => {
    if (typeof value === 'string') found.push(value);
    else if (value !== null && typeof value === 'object') for (const member of Object.values(value)) walk(member);
  };
  walk(manifest.exports ?? manifest.module ?? manifest.main);
  return found;
}

/**
 * A face provider for a workspace: the unit is the package, and its face is
 * whatever its manifest publishes.
 *
 * `indexFaces` next door reads the convention most application repositories
 * keep — a directory is entered through its `index` module — and it is the wrong
 * convention *here*. This repository's boundary is the package: `boundaries.check.ts`
 * holds every import against the importing package's manifest, and a module
 * reaching sideways into a sibling directory of its own package has crossed
 * nothing anyone declared. Asked with the directory rule, nine hops in ten of
 * this repository's own graph report as reaching past an interface, which is a
 * finding about the provider rather than about the code.
 *
 * What it does catch is the hop that matters here: something outside a package
 * landing on a file that package does not publish — a relative path up and over
 * into `packages/<other>/src`, which resolves, runs, and is exactly the
 * dependency the manifest says does not exist.
 */
export function packageFaces(packages, stemOf, named) {
  const units = [];
  for (const [name, { at, manifest }] of packages) {
    const entries = new Set();
    for (const path of published_entries(manifest)) {
      const file = named(`${at}/${path.replace(/^\.\//, '')}`);
      if (file !== undefined) entries.add(file);
    }
    if (entries.size > 0) units.push({ name, at, entries, entry: [...entries].sort()[0] });
  }

  return (reached, importer) => {
    const unit = units.find(({ at }) => reached.startsWith(`${at}/`));
    if (unit === undefined) return undefined;
    if (importer.startsWith(`${unit.at}/`)) return undefined;
    if (unit.entries.has(reached)) return undefined;
    return { unit: unit.at, entry: unit.entry, as: unit.name };
  };
}

/** The graph, scanned from the same directories `yarn test` collects. */
export async function importGraph({ root, snapshotFile, stemOf, dirs = ['packages', 'tools', 'cases', 'examples'] }) {
  const index = await openSourceIndex(resolve(dirname(snapshotFile), 'source-index.bin'));
  const records = await scanRelations({
    root,
    dirs,
    cache: index.cache,
    reuse: index.reuse,
  });
  await index.save();

  const packages = manifests(root, ['packages', 'cases', 'examples']);
  const { records: folded, enumerated, named } = foldBuilt(bridgeWorkspace(records, packages), stemOf);
  return {
    relations: relationsOfFiles(folded),
    enumerated,
    named,
    faces: packageFaces(packages, stemOf, named),
  };
}
