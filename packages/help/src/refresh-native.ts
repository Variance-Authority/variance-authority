import { resolve } from 'node:path';
import { indexedUsage, sourceIndexPath, sourceTreeBytes } from '@variance-authority/sense';

import { readOfferings, type Deep, type Help, type HelpOptions, type Named, type Usage, type Use } from '@variance-authority/package/help';
import { joinUsage, sameSurface } from './read.js';
import { coversWhole, scanScope } from './scan-scope.js';
import { tryPublishWorkspaceSnapshot } from './snapshot.js';

// compass: variance-authority.report.agent-surface


/**
 * Refresh a published value from an index that was just written, with the
 * chain read and folded by the native scanner instead of decoded into records.
 *
 * The caller says the index is current, which is what `variance index` knows
 * and a scan would spend its time re-proving. Everything that moved is usage,
 * exports and the graph; the documented surface is kept, exactly as
 * `refreshWorkspace` keeps it, and this answers `undefined` when it cannot be:
 * the offerings or the exported set changed, the scope is not the whole
 * checkout, or there is no native scanner. The caller then reads the way it
 * always did.
 */
export async function refreshWorkspaceFromIndex(
  root: string,
  documented: Help,
  options: HelpOptions & { readonly index?: string } = {},
): Promise<Help | undefined> {
  const where = resolve(root);
  const offerings = readOfferings(where, { ...options, tolerant: options.tolerant ?? true });
  const scope = scanScope(where, offerings);
  if (!coversWhole(scope.dirs)) return undefined;
  const opened = offerings.flatMap((offering) => offering.entrypoints.map((entry) => `${offering.name} ${entry.subpath}`));
  const index = options.index ?? sourceIndexPath(scope.root);
  let read: ReturnType<typeof indexedUsage>;
  try {
    read = indexedUsage(scope.root, opened, index);
  } catch {
    return undefined;
  }
  if (read === null) return undefined;

  const names = new Map<string, Map<string, Use[]>>();
  for (const use of read.names) {
    const held = names.get(use.key) ?? new Map<string, Use[]>();
    names.set(use.key, held);
    const uses = held.get(use.name) ?? [];
    held.set(use.name, uses);
    uses.push({
      by: use.by, at: use.at, line: use.line, type: use.type, kind: use.kind,
      ...(use.through === undefined ? {} : { through: { kind: use.through, line: use.throughLine } }),
    });
  }
  const usage: Usage = { names, deep: read.deep as Deep[], exported: read.exported as Named[], unreadable: read.unreadable };
  if (!sameSurface({ root: scope.root, offerings }, usage.exported, documented)) return undefined;
  const help = joinUsage(documented, offerings, usage);
  const tree = sourceTreeBytes(scope.root, index);
  if (tree === null) return undefined;
  await tryPublishWorkspaceSnapshot(where, scope.root, help, tree, index);
  return help;
}
