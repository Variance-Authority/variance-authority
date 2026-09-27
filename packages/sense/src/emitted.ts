/**
 * Built output, read back as the source it is built from.
 *
 * A workspace package whose manifest exports `./dist/index.js` is still the
 * code under `src/`: nobody edits `dist/`. The `tsconfig` that builds the
 * package owns the answer — `outDir` is where output goes, `rootDir` is what it
 * mirrors — so a resolution that lands under `outDir` is read as the file under
 * `rootDir` it is emitted from, and output with no source behind it, left by a
 * build older than a deletion, is not there. A file under `outDir` of a kind
 * TypeScript does not emit, such as a stylesheet a build step copied, stays
 * what it is.
 *
 * Only a directory holding a `package.json`, and not under `node_modules` once
 * its symlinks are followed, declares a layout, and only when the config chain
 * writes both options: without `rootDir`, TypeScript 5 infers the common
 * directory of the inputs and TypeScript 6 takes the config's own directory. A
 * config whose chain sets `noEmit` writes nothing, so its `outDir` is not where
 * anything went, and one that sets `emitDeclarationOnly` writes no code, so the
 * code in its `outDir` is some other tool's. Two configs that name one `outDir`
 * are both kept, and the first whose `rootDir` holds the source answers.
 *
 * The native scanner applies the same rule inside the resolver's file system
 * (`native/src/emitted.rs`), where it holds whether or not the package was
 * built. Here it can only read back what the resolver found on disk.
 */

// compass: variance-authority.reach

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { extendedFile } from './conditions.js';
import { parseConfig } from './witness.js';

/**
 * Where a path's answer comes from: `undefined` for a path that is not emitted
 * output, `null` for output with no source behind it, or the source.
 */
export type Emitted = (path: string) => string | null | undefined;

/** What TypeScript emits, and the sources each is emitted from, preferred first. */
const EMITTED: readonly (readonly [string, readonly string[]])[] = [
  ['.d.ts', ['.ts', '.tsx', '.js', '.jsx', '.d.ts']],
  ['.d.mts', ['.mts', '.mjs', '.d.mts']],
  ['.d.cts', ['.cts', '.cjs', '.d.cts']],
  ['.js', ['.ts', '.tsx', '.js', '.jsx']],
  ['.jsx', ['.tsx', '.jsx']],
  ['.mjs', ['.mts', '.mjs']],
  ['.cjs', ['.cts', '.cjs']],
  ['.json', ['.json']],
];

/** One `outDir` and the `rootDir`s written into it, spelled under the declaring directory. */
interface Layout {
  readonly out: string;
  readonly sources: Mirror[];
}

/** A `rootDir` one or more configs mirror into an `outDir`, and whether any of them writes code there. */
interface Mirror {
  readonly root: string;
  code: boolean;
}

/** An `Emitted` with its own memo of what each package directory declares. */
export function emittedFrom(): Emitted {
  const declared = new Map<string, readonly Layout[]>();
  const declaredBy = (directory: string): readonly Layout[] => {
    let held = declared.get(directory);
    if (held === undefined) declared.set(directory, (held = layoutsOf(directory)));
    return held;
  };

  return (path) => {
    const layout = layoutOf(path, declaredBy);
    if (layout === undefined) return undefined;
    const rest = relative(layout.out, path);
    const name = path.slice(path.lastIndexOf(sep) + 1);
    const emitted = EMITTED.find(([output]) => name.length > output.length && name.endsWith(output));
    const wrote = (mirror: Mirror): boolean => emitted !== undefined && (emitted[0].startsWith('.d.') || mirror.code);
    for (const mirror of layout.sources) {
      const counterpart = join(mirror.root, rest);
      if (isDirectory(counterpart)) return undefined;
      if (emitted === undefined || !wrote(mirror)) continue;
      const [output, sources] = emitted;
      const stem = counterpart.slice(0, counterpart.length - output.length);
      const found = sources.map((extension) => `${stem}${extension}`).find(isFile);
      if (found !== undefined) return found;
    }
    // Output none of the configs wrote is some other tool's, and the disk
    // answers for it.
    return layout.sources.some(wrote) ? null : undefined;
  };
}

/**
 * The deepest layout a path lies in. Walked from the top: a directory declares
 * only while it is outside every layout, and of two declarations of one
 * `outDir` the nearer directory's wins.
 */
function layoutOf(path: string, declaredBy: (directory: string) => readonly Layout[]): Layout | undefined {
  const chain: string[] = [];
  for (let at = path; dirname(at) !== at; at = dirname(at)) chain.unshift(at);
  let active: readonly Layout[] = [];
  let within: Layout | undefined;
  let directory = dirname(chain[0] ?? path);
  for (const child of chain) {
    if (within === undefined) active = [...declaredBy(directory), ...active];
    within = active.find((layout) => layout.out === child) ?? within;
    directory = child;
  }
  return within;
}

function layoutsOf(directory: string): readonly Layout[] {
  if (!isFile(join(directory, 'package.json'))) return [];
  let real: string;
  let names: string[];
  try {
    real = realpathSync.native(directory);
    names = readdirSync(real);
  } catch {
    return [];
  }
  if (real.split(sep).includes('node_modules')) return [];
  const configs = names
    .filter((name) => name.startsWith('tsconfig') && name.endsWith('.json'))
    .sort((a, b) => Number(a !== 'tsconfig.json') - Number(b !== 'tsconfig.json') || (a < b ? -1 : a > b ? 1 : 0));
  const layouts: Layout[] = [];
  for (const config of configs) {
    const path = join(real, config);
    const set = (name: string): boolean => setting(path, name, new Set())?.value === true;
    if (set('noEmit')) continue;
    const out = pathOption(path, real, 'outDir');
    const source = pathOption(path, real, 'rootDir');
    if (out === undefined || source === undefined) continue;
    const inside = relative(real, out);
    if (inside === '' || outside(inside) || within(source, out)) continue;
    const spelledOut = join(directory, inside);
    const fromReal = relative(real, source);
    const root = outside(fromReal) ? source : join(directory, fromReal);
    const code = !set('emitDeclarationOnly');
    const layout = layouts.find((known) => known.out === spelledOut);
    const mirror = layout?.sources.find((known) => known.root === root);
    if (layout === undefined) layouts.push({ out: spelledOut, sources: [{ root, code }] });
    else if (mirror === undefined) layout.sources.push({ root, code });
    else mirror.code ||= code;
  }
  return layouts;
}

/**
 * A compiler option as the config chain sets it, with the directory of the
 * config that wrote it. The nearest config that names it wins, and of several
 * bases the last one.
 */
function setting(path: string, name: string, seen: Set<string>): { value: unknown; directory: string } | undefined {
  if (seen.has(path)) return undefined;
  seen.add(path);
  const raw = read(path);
  if (raw === undefined) return undefined;
  const options = raw['compilerOptions'];
  const value = typeof options === 'object' && options !== null
    ? (options as Record<string, unknown>)[name]
    : undefined;
  if (value !== undefined) return { value, directory: dirname(path) };
  const extended = raw['extends'];
  const bases = typeof extended === 'string'
    ? [extended]
    : Array.isArray(extended) ? extended.filter((base): base is string => typeof base === 'string') : [];
  for (const base of bases.reverse()) {
    const found = extendedFile(dirname(path), base);
    if (found === undefined) continue;
    const inherited = setting(found, name, seen);
    if (inherited !== undefined) return inherited;
  }
  return undefined;
}

/**
 * A path option, unset or cleared by `null` alike. A relative value is relative
 * to the config that wrote it, and `${configDir}` is the directory of the
 * config being built.
 */
function pathOption(path: string, leaf: string, name: string): string | undefined {
  const found = setting(path, name, new Set());
  if (found === undefined) return undefined;
  const { value, directory } = found;
  if (typeof value !== 'string') return undefined;
  const template = '${configDir}';
  return normalize(value.startsWith(template)
    ? `${leaf}${value.slice(template.length)}`
    : isAbsolute(value) ? value : join(directory, value));
}

function read(path: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  return text.trim() === '' ? {} : parseConfig(text);
}

function within(path: string, directory: string): boolean {
  return !outside(relative(directory, path));
}

/** Whether a relative path leaves the directory it is relative to. */
function outside(path: string): boolean {
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
}

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}
