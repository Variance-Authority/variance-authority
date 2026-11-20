import { relative, resolve } from 'node:path';
import { createReader, namesReachedBy, readOfferings, type Names, type Offering } from '@variance-authority/package';
import { readUsage, type Deep, type Help, type HelpOptions, type Taken, type Use } from '@variance-authority/package/help';
import { joinWalkedHelp, type NameUse, type PublishedName, type PublishPackage, type StoreDeep, type StoreUse } from '@variance-authority/sense';
import { heldStore } from './snapshot.js';
import { specifierOf } from './tools/find.js';

// compass: variance-authority.report.agent-surface

/**
 * Read a workspace's active, documented API with no index: the manifests, the
 * source behind each opening, and every module file of the repository, read
 * here, then joined by the addon as the index's publish joins them.
 *
 * Entries within a subpath are ordered by how much of the repository reaches
 * for them, then by name. That ordering is the product rather than a
 * presentation choice: everything downstream truncates somewhere, and what
 * survives the truncation should be what somebody was most likely to ask about.
 */
export function readHelp(root: string, options: HelpOptions = {}): Help {
  const where = resolve(root);
  const offerings = readOfferings(where, options);

  const entrypoints = new Map<string, string>();
  for (const offering of offerings) {
    for (const entry of offering.entrypoints) entrypoints.set(`${offering.name} ${entry.subpath}`, entry.source);
  }

  const reader = createReader(where, entrypoints);
  const usage = options.usage ?? readUsage(where, new Set(entrypoints.keys()), options, reader.parses);

  const uses: NameUse[] = [];
  for (const [key, byName] of usage.names) {
    for (const [name, held] of byName) {
      for (const use of held) uses.push({ key, ...flatUseOf(use), name });
    }
  }
  return heldStore(joinWalkedHelp({
    readmeRoot: where,
    packages: publishedPackages(where, offerings),
    names: offerings.flatMap((offering) => offering.entrypoints.map((entry) => publishedNames(namesReachedBy(reader, entry.source)))),
    uses,
    deep: usage.deep.map(flatDeepOf),
    byPath: usage.byPath.map(flatDeepOf),
    unfollowed: usage.unfollowed.map(flatDeepOf),
    exported: [...usage.exported],
    unreadable: [...offerings.flatMap((offering) => offering.unreadable ?? []), ...usage.unreadable],
  }));
}

/**
 * The packages the manifests publish as the addon joins them: each opening's
 * file relative to `where` and the specifier a search line prints for it, in
 * the order of `offerings`, which the names given beside them follow.
 */
export function publishedPackages(where: string, offerings: readonly Offering[]): PublishPackage[] {
  return offerings.map((offering) => ({
    name: offering.name,
    entry: offering.entry,
    openings: offering.entrypoints.map((entry) => ({
      subpath: entry.subpath,
      source: relative(where, entry.source),
      spec: specifierOf(offering, entry),
    })),
  }));
}

function publishedNames(names: Names): PublishedName[] {
  return [...names].map(([name, kinds]) => ({ name, kinds: [...kinds.values()] }));
}

/** A use with its `through` laid flat, as the addon takes it. */
function flatUseOf(use: Use | Taken): StoreUse {
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

function flatDeepOf(deep: Deep): StoreDeep {
  return {
    specifier: deep.specifier,
    by: deep.by,
    at: deep.at,
    line: deep.line,
    ...(deep.to === undefined ? {} : { to: deep.to }),
    names: deep.names.map(flatUseOf),
  };
}
