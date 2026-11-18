/**
 * The records one native batch's columns hold, in the shapes TypeScript keeps.
 *
 * `built` in [`record.rs`](../native/src/record.rs) is the same rule on the
 * walk's side of the boundary, and the two give one answer: a guess that lands
 * is an edge and one that misses is silence, every further file a request
 * reaches is an edge of the request's kind, and a miss is a hole only where the
 * file's own language spells a path in this repository.
 */
import type { FileEdge, FileRecord, PackageEdge } from '@variance-authority/core/relate';
import type { Digest } from '@variance-authority/core/format';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Parsed } from './cache.js';
import { parseWay } from './files.js';
import { languageOf } from './language.js';
import type { NativeBuilt, NativeFrontierOptions, NativeScanBatch } from './native.js';
import { isRelative, kindFor, packageOf, requestOf } from './specifier.js';
import { witnessesOf } from './witness.js';

/** Every file of `options.files` built from the batch that read it, in that order. */
export function builtFromBatch(
  options: NativeFrontierOptions,
  batch: NativeScanBatch,
): readonly NativeBuilt[] {
  const kinds = options.addon.kinds();
  const built: NativeBuilt[] = [];
  let at = 0;
  let declareAt = 0;
  let moreAt = 0;

  for (const [index, file] of options.files.entries()) {
    const count = batch.counts[index] ?? 0;
    const declareCount = batch.declareCounts[index] ?? 0;
    const declares = batch.declares.slice(declareAt, declareAt + declareCount);
    declareAt += declareCount;
    const encoded = batch.parses[index] ?? '';
    if (batch.parsed[index] !== 1) {
      // A file its bytes declined names them; a failed read names nothing, and
      // is tried again. `built` in `record.rs` is the same rule.
      const declined = batch.declined[index] === 1
        ? options.digests[index] ?? asDigest(batch.digests[index])
        : undefined;
      built.push({
        record: {
          file,
          ...(declined === undefined ? {} : { digest: declined }),
          ...(batch.unknown[index] === '' ? {} : { unknown: batch.unknown[index] }),
        },
        witnesses: [],
      });
      at += count;
      while ((batch.moreAt[moreAt] ?? Infinity) < at) moreAt += 1;
      continue;
    }
    const digest = options.digests[index] ?? asDigest(batch.digests[index]);
    const language = languageOf(parseWay(file).suffix) ?? 'module';

    const read = encoded === '' ? undefined : JSON.parse(encoded) as Parsed;
    const edges: FileEdge[] = [];
    const packages: PackageEdge[] = [];
    const unresolved: string[] = [];
    const holes: string[] = [];
    const requests: string[] = [];
    const targets: (string | undefined)[] = [];
    for (let step = 0; step < count; step += 1) {
      const value = batch.values[at + step] ?? '';
      requests.push(value);
      const target = batch.targets[at + step] ?? '';
      targets.push(target === '' ? undefined : target);
      const request = requestOf(value);
      if (request === undefined) continue;
      const kind = kinds[batch.kinds[at + step] ?? -1];
      if (target === '') {
        // A guess that lands is an edge; one that does not is silence.
        if (batch.guessed[at + step] === 1) continue;
        unresolved.push(value);
        // Without the package edge a bumped package has no importer in the
        // graph, and the install walk selects nothing for it.
        const named = packageOf(request);
        if (named !== undefined && kind !== undefined) packages.push({ to: named, kind });
        if (isRelative(request, language)) holes.push(value);
        continue;
      }
      if (kind === undefined) continue;
      edges.push({ to: target, kind: kindFor(kind, target) });
      // Every further file the request reaches is an edge too: a Swift
      // target's, a Java package's.
      while ((batch.moreAt[moreAt] ?? Infinity) <= at + step) {
        const to = batch.more[moreAt]!;
        edges.push({ to, kind: kindFor(kind, to) });
        moreAt += 1;
      }
    }
    at += count;
    while ((batch.moreAt[moreAt] ?? Infinity) < at) moreAt += 1;

    const reasons = [
      ...(batch.unknown[index] === '' ? [] : [batch.unknown[index]!]),
      ...(holes.length === 0
        ? []
        : [`${holes.length} relative specifier(s) that resolve to nothing: ${holes.join(', ')}`]),
    ];
    const settled = dedupe(edges);
    const record: FileRecord = {
      file,
      ...(digest === undefined ? {} : { digest }),
      ...(settled.length === 0 ? {} : { edges: settled }),
      ...(packages.length === 0 ? {} : { packages: dedupe(packages) }),
      ...(declares.length === 0 ? {} : { declares }),
      ...(unresolved.length === 0
        ? {}
        : { unresolved: [...new Set(unresolved)].sort(codeUnitOrder) }),
      ...(reasons.length === 0 ? {} : { unknown: `${file} — ${reasons.join('; ')}` }),
    };
    const witnesses = options.remembering
      ? witnessesOf({
        file,
        requests,
        edges: settled.map((edge) => edge.to),
        directories: options.directories,
        aliases: options.aliases,
      })
      : [];
    const crossed = batch.kept[index] === 1 ? { kept: true as const } : { parsed: true as const };
    built.push({ record, ...(read === undefined ? {} : { read }), targets, witnesses, ...crossed });
  }

  return built;
}

/** A digest column's entry, or nothing where the column is empty. */
export function asDigest(value: string | undefined): Digest | undefined {
  return value === undefined || value === '' ? undefined : value;
}

/** Each edge once by its kind and target, in code-unit order of target, then kind. */
export function dedupe<Edge extends FileEdge>(edges: readonly Edge[]): readonly Edge[] {
  const seen = new Set<string>();
  return edges
    .filter((edge) => {
      const key = `${edge.kind} ${edge.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => codeUnitOrder(a.to, b.to) || codeUnitOrder(a.kind, b.kind));
}
