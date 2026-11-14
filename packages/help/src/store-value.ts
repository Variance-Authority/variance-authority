import type { Deep, Documented, Entry, Help, Named, Opening, Taken, Use } from '@variance-authority/package/help';
import { NONE } from '@variance-authority/core/segment';
import { THROUGH, USE_KINDS, type Sections } from './store-layout.js';

/**
 * The Help value of one opened store, decoded a field at a time: a question
 * that reads only `packages` never decodes the export list.
 */
export function helpOf({ bytesOf, u32, string, maybe, slice }: Sections): Help {
  const nameString = u32('names.name');
  const name = (id: number): string => string(nameString[id] ?? NONE);
  const useAt = u32('use.at');
  const use = {
    by: u32('use.by'), line: u32('use.line'), flags: bytesOf('use.flags'),
    throughLine: u32('use.throughLine'), local: u32('use.local'), name: u32('use.name'),
  };
  const useOf = (row: number): Use => {
    const flags = use.flags[row] ?? 0;
    const local = maybe(use.local[row]);
    const through = THROUGH[(flags >> 3) & 3];
    return {
      by: string(use.by[row] ?? NONE),
      at: string(useAt[row] ?? NONE),
      line: use.line[row] ?? 0,
      type: (flags & 1) === 1,
      kind: USE_KINDS[(flags >> 1) & 3] ?? 'source',
      ...(local === undefined ? {} : { local }),
      ...(through === undefined
        ? {}
        : {
            through: {
              kind: through,
              line: use.throughLine[row] ?? 0,
              ...((flags & 32) === 0 ? {} : { throughDefault: true as const }),
              ...((flags & 64) === 0 ? {} : { whole: true as const }),
            },
          }),
    };
  };
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
    const deep = {
      specifier: u32('deep.specifier'), by: u32('deep.by'), at: u32('deep.at'), line: u32('deep.line'),
      to: u32('deep.to'), namesOff: u32('deep.namesOff'), groups: u32('deep.groups'),
    };
    const from = group === 0 ? 0 : (deep.groups[group - 1] ?? 0);
    const found: Deep[] = [];
    for (let row = from; row < (deep.groups[group] ?? 0); row += 1) {
      const to = maybe(deep.to[row]);
      const names: Taken[] = [];
      for (let at = deep.namesOff[row] ?? 0; at < (deep.namesOff[row + 1] ?? 0); at += 1) {
        names.push({ name: string(use.name[at] ?? NONE), ...useOf(at) });
      }
      found.push({
        specifier: string(deep.specifier[row] ?? NONE),
        by: string(deep.by[row] ?? NONE),
        at: string(deep.at[row] ?? NONE),
        line: deep.line[row] ?? 0,
        ...(to === undefined ? {} : { to }),
        names,
      });
    }
    return found;
  };
  const exported = (): Named[] => {
    const exp = { name: u32('exp.name'), at: u32('exp.at'), by: u32('exp.by'), line: u32('exp.line'), doc: u32('exp.doc') };
    const expKind = bytesOf('exp.kind');
    const more = {
      type: bytesOf('exp.type'), bound: u32('exp.bound'), declaration: u32('exp.declaration'),
      boundLine: u32('exp.boundLine'), signature: u32('exp.signature'),
    };
    const found: Named[] = [];
    for (let row = 0; row < exp.name.length; row += 1) {
      const bound = maybe(more.bound[row]);
      const declaration = maybe(more.declaration[row]);
      const boundLine = more.boundLine[row] ?? NONE;
      const doc = maybe(exp.doc[row]);
      const signature = maybe(more.signature[row]);
      found.push({
        name: name(exp.name[row] ?? NONE),
        at: string(exp.at[row] ?? NONE),
        by: string(exp.by[row] ?? NONE),
        line: exp.line[row] ?? 0,
        type: more.type[row] === 1,
        kind: USE_KINDS[expKind[row] ?? 0] ?? 'source',
        ...(bound === undefined ? {} : { bound }),
        ...(declaration === undefined ? {} : { declaration }),
        ...(boundLine === NONE ? {} : { boundLine }),
        ...(doc === undefined ? {} : { doc }),
        ...(signature === undefined ? {} : { signature }),
      });
    }
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
