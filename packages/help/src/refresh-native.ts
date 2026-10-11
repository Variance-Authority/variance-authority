import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { readHelp, sourceIndexPath } from '@variance-authority/sense';

import {
  readImportTargets,
  readOfferings,
  type Deep,
  type Help,
  type HelpOptions,
  type Taken,
  type Usage,
  type Use,
} from '@variance-authority/package/help';
import { joinUsage, samePackages } from './read.js';
import { coversWhole, scanScope } from './scan-scope.js';
import { publishedRows } from './search-index.js';
import {
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  indexManifestDigest,
  workspaceExportedDigest,
  workspaceGeneration,
  workspaceIndexDigest,
  workspaceSearchPath,
  workspaceSnapshotPath,
  workspaceTreePrefix,
} from './snapshot.js';

// compass: variance-authority.report.agent-surface


/**
 * Refresh a published value from an index that was just written, with the
 * chain read and the value written by the native scanner.
 *
 * The caller says the index is current, which is what `variance index` knows
 * and a scan would spend its time re-proving. Everything that moved is usage,
 * exports and the graph; the documented surface is kept, exactly as
 * `refreshWorkspace` keeps it. On a large repository the value is mostly its
 * export list, and that list never crosses into JavaScript here: it is compared
 * by digest and written by the addon that read it. So what this answers is the
 * generation it published, not the value, and `undefined` when it cannot
 * refresh: the offerings or the exported set changed, the scope is not the
 * whole checkout, or there is no native scanner. The caller then reads the way
 * it always did.
 *
 * A value refreshed from this very manifest, over the same packages, is the
 * value this refresh would write, so it is kept and its generation answered:
 * an index that did not move costs its value nothing.
 */
export async function refreshWorkspaceFromIndex(
  root: string,
  documented: Help,
  options: HelpOptions & { readonly index?: string } = {},
): Promise<string | undefined> {
  const where = resolve(root);
  const offerings = readOfferings(where, { ...options, tolerant: options.tolerant ?? true });
  const scope = scanScope(where, offerings);
  if (!coversWhole(scope.dirs)) return undefined;
  if (!samePackages({ root: scope.root, offerings }, documented)) return undefined;
  const opened = offerings.flatMap((offering) => offering.entrypoints.map((entry) => `${offering.name} ${entry.subpath}`));
  const index = options.index ?? sourceIndexPath(scope.root);
  const indexDigest = await indexManifestDigest(index);
  if (indexDigest === undefined) return undefined;
  const kept = workspaceGeneration(documented);
  if (kept !== undefined && workspaceIndexDigest(documented) === indexDigest) return kept;
  let reading: Awaited<ReturnType<typeof readHelp>>;
  try {
    reading = await readHelp(scope.root, opened, readImportTargets(where), index);
  } catch {
    return undefined;
  }
  if (reading === null || reading.exportedDigest !== workspaceExportedDigest(documented)) return undefined;
  const read = reading.usage();

  const names = new Map<string, Map<string, Use[]>>();
  for (const use of read.names) {
    const held = names.get(use.key) ?? new Map<string, Use[]>();
    names.set(use.key, held);
    const uses = held.get(use.name) ?? [];
    held.set(use.name, uses);
    uses.push(useOf(use));
  }
  // The export list is the reading's; the value joined here carries none of it.
  const usage: Usage = {
    names,
    deep: read.deep.map(byPathOf),
    byPath: read.byPath.map(byPathOf),
    unfollowed: read.unfollowed.map(byPathOf),
    exported: [],
    unreadable: read.unreadable,
  };
  const help: Help = joinUsage(documented, offerings, usage);
  const generatedAt = new Date().toISOString();
  try {
    await reading.publish({
      snapshot: workspaceSnapshotPath(index),
      search: workspaceSearchPath(index),
      graph: workspaceTreePrefix(index),
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      root: realpathSync(where),
      graphRoot: realpathSync(scope.root),
      generatedAt,
      indexDigest,
      packages: JSON.stringify(help.packages),
      deep: JSON.stringify(help.deep),
      byPath: JSON.stringify(help.byPath),
      unfollowed: JSON.stringify(help.unfollowed),
      unreadable: JSON.stringify(help.unreadable),
      published: publishedRows(help),
    });
  } catch {
    // The value is complete. An unwritable cache costs reuse, and the caller reads it back.
  }
  return generatedAt;
}

type NativeUsage = ReturnType<NonNullable<Awaited<ReturnType<typeof readHelp>>>['usage']>;
type NativeUse = NativeUsage['names'][number];

/** A use as the addon hands it over: `through` flattened, and `null` for absent. */
export function useOf(use: NativeUse): Use {
  return {
    by: use.by, at: use.at, line: use.line, type: use.type, kind: use.kind,
    ...(use.through === undefined || use.through === null ? {} : { through: { kind: use.through, line: use.throughLine } }),
  };
}

/** An import by path as the addon hands it over. */
function byPathOf(held: NativeUsage['deep'][number]): Deep {
  const names: Taken[] = held.names.map((use) => ({ name: use.name, ...useOf(use) }));
  return {
    specifier: held.specifier, by: held.by, at: held.at, line: held.line,
    ...(held.to === undefined || held.to === null ? {} : { to: held.to }),
    names,
  };
}
