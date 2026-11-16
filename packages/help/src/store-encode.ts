import type { Deep, Entry, Help, Taken, Use } from '@variance-authority/package/help';
import { encodeHelpStore, type HelpStore, type StoreDeep, type StoreEntry, type StoreUse } from '@variance-authority/sense';
import { specifierOf } from './tools/find.js';

/**
 * A Help value laid out as the addon encodes it, for a value built in memory:
 * a test's, or a read the addon did not publish.
 */

/** A Help value laid out as `encodeHelpStore` takes it; its export list is handed beside it. */
export function storeOf(help: Help): HelpStore {
  return {
    packages: help.packages.map((owner) => ({
      name: owner.name,
      entry: owner.entry,
      openings: owner.openings.map((opening) => ({
        subpath: opening.subpath,
        source: opening.source,
        spec: specifierOf(owner, opening),
        entries: opening.entries.map(storeEntryOf),
        whole: opening.whole.map(storeUseOf),
      })),
    })),
    deep: help.deep.map(storeDeepOf),
    byPath: help.byPath.map(storeDeepOf),
    unfollowed: help.unfollowed.map(storeDeepOf),
    unreadable: help.unreadable,
  };
}

function storeEntryOf(entry: Entry): StoreEntry {
  return {
    name: entry.name,
    kind: entry.kind,
    at: entry.at,
    declared: entry.declared,
    line: entry.line,
    ...(entry.signature === undefined ? {} : { signature: entry.signature }),
    ...(entry.doc === undefined ? {} : { doc: entry.doc }),
    usedBy: entry.usedBy,
    uses: entry.uses,
    sites: entry.sites.map(storeUseOf),
    throughDefault: entry.throughDefault.map(storeUseOf),
    ...(entry.mention === undefined ? {} : { mention: entry.mention }),
  };
}

function storeUseOf(use: Use | Taken): StoreUse {
  return {
    by: use.by,
    at: use.at,
    line: use.line,
    type: use.type,
    kind: use.kind,
    ...(use.local === undefined ? {} : { local: use.local }),
    ...(use.through === undefined ? {} : { through: use.through.kind }),
    throughLine: use.through?.line ?? 0,
    throughDefault: use.through?.throughDefault === true,
    whole: use.through?.whole === true,
    ...('name' in use ? { name: use.name } : {}),
  };
}

function storeDeepOf(deep: Deep): StoreDeep {
  return {
    specifier: deep.specifier,
    by: deep.by,
    at: deep.at,
    line: deep.line,
    ...(deep.to === undefined ? {} : { to: deep.to }),
    names: deep.names.map(storeUseOf),
  };
}

/** One Help value's store, encoded in memory with no generation: the bytes, and the digest of its export list. */
export function encodeStore(help: Help): { readonly bytes: Uint8Array; readonly exported: string } {
  return encodeHelpStore(storeOf(help), help.exported);
}
