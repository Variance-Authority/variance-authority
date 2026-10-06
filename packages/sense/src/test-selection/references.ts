// compass: variance-authority.reach
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Relations } from '@variance-authority/core/relate';
import { native } from '../addon.js';
import type { Read } from '../read.js';
import { listedIn } from './effects.js';

/** Where one file references what it imports, by the repository file each import lands on. */
export interface FileReferences {
  /**
   * Each reference to an imported binding: the file its import lands on, the
   * name taken (`default`, a namespace member, or `*` for a namespace used
   * whole), the 1-based line, and whether it runs when the file loads.
   */
  readonly references: readonly {
    readonly file: string;
    readonly name: string;
    readonly line: number;
    readonly load: boolean;
  }[];
  /** The files it re-exports a name from, which its importers use. */
  readonly passed: readonly string[];
  /** Every file a value import or re-export of it lands on, side effects included. */
  readonly imported: readonly string[];
  /** The files it imports with no binding, `import './x'`, which it loads for their effect. */
  readonly effects: readonly string[];
  /** A `require`, an `import()` or an `import x = require()` no name traces. */
  readonly untraced: boolean;
  /**
   * Every value name the file exports, `default` included. Absent when an
   * `export *` leaves the set to another file, or the file's exports were not read.
   */
  readonly exports?: readonly string[];
  /**
   * The exports whose value carries a name the file reads when it loads, with
   * the file that name is imported from and the name as imported: a reader of
   * the export sees a mock of that import.
   */
  readonly carries: readonly { readonly name: string; readonly file: string; readonly origin: string }[];
}

/**
 * Where `file` references what it imports, each specifier landed on a file of
 * the checkout. A specifier that lands outside it is left out. Nothing when the
 * file cannot be read or parsed, or the addon is missing.
 */
export function importReferences(root: string, relations: Relations | undefined, file: string): FileReferences | undefined {
  const scanner = native();
  if (scanner?.moduleReferences === undefined || scanner.resolveSources === undefined) return undefined;
  let text: string;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    return undefined;
  }
  const found = scanner.moduleReferences(file, text);
  if (found === null) return undefined;
  const sources = found.sources;
  const landed = sources.length === 0 ? [] : scanner.resolveSources(root, file, sources, listedIn(relations));
  // An absolute path lands outside the checkout, and `''` nowhere.
  const at = new Map(sources.flatMap((source, index) => {
    const target = landed[index];
    return target && !isAbsolute(target) ? [[source, target] as const] : [];
  }));
  const references = found.references.flatMap(({ source, name, line, load }) => {
    const target = at.get(source);
    return target === undefined ? [] : [{ file: target, name, line, load }];
  });
  // The reader takes names as imported, not by source: two imports of one name are charged to the first read at load.
  const atLoad = new Map<string, string>();
  for (const { name, file: from, load } of references) if (load && !atLoad.has(name)) atLoad.set(name, from);
  const readers = atLoad.size === 0 ? null : scanner.moduleReaders?.(file, text, [...atLoad.keys()], true) ?? null;
  const exports = exportsOf(file, text);
  return {
    references,
    passed: [...new Set(found.passed.flatMap(({ source }) => at.get(source) ?? []))],
    imported: [...new Set(at.values())],
    effects: [...new Set(found.effects.flatMap((source) => at.get(source) ?? []))],
    untraced: found.untraced,
    ...(exports === undefined ? {} : { exports }),
    carries: (readers?.exported ?? []).map(({ name, origin }) => ({ name, file: atLoad.get(origin)!, origin })),
  };
}

/** The value names `file` exports, or nothing when an `export *` leaves them to another file. */
function exportsOf(file: string, text: string): readonly string[] | undefined {
  let read: Read;
  try {
    read = JSON.parse(native()!.readSource(file, text)) as Read;
  } catch {
    return undefined;
  }
  const values = (read.exports ?? []).filter((entry) => !entry.type);
  if (values.some((entry) => entry.exported === undefined)) return undefined;
  const types = new Set((read.symbols ?? []).filter(({ kind }) => kind === 'interface' || kind === 'type').map(({ name }) => name));
  return [...new Set(values.flatMap(({ exported, local }) => (local !== undefined && types.has(local) ? [] : [exported!])))];
}
