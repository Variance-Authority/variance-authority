import type { Deep, Documented, Entry, Help, Named, Opening, Use } from '@variance-authority/package/help';
import { NONE } from '@variance-authority/core/segment';
import type { Sections } from './store-layout.js';
import { decodersOf } from './store-rows.js';

/**
 * The Help value of one opened store, decoded a field at a time: a question
 * that reads only `packages` never decodes the export list.
 */
export function helpOf(sections: Sections): Help {
  const { bytesOf, u32, string, maybe, slice } = sections;
  const nameString = u32('names.name');
  const name = (id: number): string => string(nameString[id] ?? NONE);
  const decoders = decodersOf(sections);
  const useOf = decoders.use;
  const usesIn = (from: number, to: number): Use[] => {
    const found: Use[] = [];
    for (let row = from; row < to; row += 1) found.push(useOf(row));
    return found;
  };
  const pub = {
    name: u32('pub.name'), kind: u32('pub.kind'), doc: u32('pub.doc'), at: u32('pub.at'),
    usedByOff: u32('pub.usedByOff'), usedByList: u32('pub.usedByList'), uses: u32('pub.uses'),
    sitesOff: u32('pub.sitesOff'), tdOff: u32('pub.tdOff'),
  };
  const pubMore = {
    declared: u32('pub.declared'), line: u32('pub.line'), signature: u32('pub.signature'),
    mentionAt: u32('pub.mentionAt'), mentionLine: u32('pub.mentionLine'), mentionText: u32('pub.mentionText'),
  };
  const entryOf = (row: number): Entry => {
    const signature = maybe(pubMore.signature[row]);
    const doc = maybe(pub.doc[row]);
    const mentionAt = maybe(pubMore.mentionAt[row]);
    return {
      name: name(pub.name[row] ?? NONE),
      kind: string(pub.kind[row] ?? NONE),
      at: string(pub.at[row] ?? NONE),
      declared: string(pubMore.declared[row] ?? NONE),
      line: pubMore.line[row] ?? 0,
      ...(signature === undefined ? {} : { signature }),
      ...(doc === undefined ? {} : { doc }),
      ...(mentionAt === undefined
        ? {}
        : { mention: { at: mentionAt, line: pubMore.mentionLine[row] ?? 0, text: string(pubMore.mentionText[row] ?? NONE) } }),
      usedBy: [...slice(pub.usedByOff, pub.usedByList, row)].map(string),
      uses: pub.uses[row] ?? 0,
      sites: usesIn(pub.sitesOff[row] ?? 0, pub.sitesOff[row + 1] ?? 0),
      throughDefault: usesIn(pub.tdOff[row] ?? 0, pub.tdOff[row + 1] ?? 0),
    };
  };
  const packages = (): Documented[] => {
    const pkgName = u32('pkg.name');
    const pkgEntry = bytesOf('pkg.entry');
    const pkgOpenOff = u32('pkg.openOff');
    const open = {
      subpath: u32('open.subpath'), source: u32('open.source'), entryOff: u32('open.entryOff'), wholeOff: u32('open.wholeOff'),
    };
    const found: Documented[] = [];
    for (let owner = 0; owner < pkgName.length; owner += 1) {
      const openings: Opening[] = [];
      for (let at = pkgOpenOff[owner] ?? 0; at < (pkgOpenOff[owner + 1] ?? 0); at += 1) {
        const entries: Entry[] = [];
        for (let row = open.entryOff[at] ?? 0; row < (open.entryOff[at + 1] ?? 0); row += 1) entries.push(entryOf(row));
        openings.push({
          subpath: string(open.subpath[at] ?? NONE),
          source: string(open.source[at] ?? NONE),
          entries,
          whole: usesIn(open.wholeOff[at] ?? 0, open.wholeOff[at + 1] ?? 0),
        });
      }
      found.push({ name: string(pkgName[owner] ?? NONE), entry: pkgEntry[owner] === 1, openings });
    }
    return found;
  };
  const deepGroup = (group: 0 | 1 | 2): Deep[] => {
    const groups = u32('deep.groups');
    const found: Deep[] = [];
    for (let row = group === 0 ? 0 : (groups[group - 1] ?? 0); row < (groups[group] ?? 0); row += 1) found.push(decoders.path(row));
    return found;
  };
  const exported = (): Named[] => {
    const found: Named[] = [];
    const count = u32('exp.name').length;
    for (let row = 0; row < count; row += 1) found.push(decoders.named(row));
    return found;
  };
  return lazily<Help>({
    packages,
    deep: () => deepGroup(0),
    byPath: () => deepGroup(1),
    unfollowed: () => deepGroup(2),
    exported,
    unreadable: () => [...u32('unreadable')].map(string),
  });
}

/**
 * An object whose fields are computed the first time each is read, and held
 * from then on. Each field is enumerable, so the object spreads and compares as
 * the plain value it stands for.
 */
function lazily<T extends object>(fields: { readonly [K in keyof T]: () => T[K] }): T {
  const held = {} as T;
  for (const key of Object.keys(fields) as (keyof T & string)[]) {
    Object.defineProperty(held, key, {
      enumerable: true,
      configurable: true,
      get(): T[typeof key] {
        const value = fields[key]();
        Object.defineProperty(held, key, { value, enumerable: true, writable: false, configurable: false });
        return value;
      },
    });
  }
  return held;
}
