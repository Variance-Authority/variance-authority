/**
 * The export conditions a `tsconfig` adds to a resolution:
 * `compilerOptions.customConditions`.
 *
 * A workspace can point each package's `exports` at source under a condition of
 * its own — `"@tanstack/custom-condition": "./src/index.ts"` beside an `import`
 * that names a `build/` directory git does not track — and tell TypeScript so in
 * `customConditions`. TypeScript owns what that specifier means, and without its
 * condition the import lands in built output that is not in the repository: the
 * edge between two packages is missing, and a change to one reaches nothing in
 * the other.
 *
 * `oxc-resolver` does not read the option, so it is read here, from the config
 * that governs the importing file. Which config that is follows the rule
 * `oxc-resolver` uses for `paths` — the nearest `tsconfig.json` that owns the
 * file through `files`, `include` and `exclude`, or through a project it
 * references — so one file's `paths` and conditions come from one config. The
 * native scanner asks `oxc_resolver` for that config directly, and reads the
 * option by the same rule (`native/src/conditions.rs`).
 *
 * `extends` is followed the way TypeScript follows it: a config that sets the
 * option replaces what it inherits, `null` clears it, and of several bases the
 * last one wins.
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import picomatch from 'picomatch';
import { parseConfig } from './witness.js';

/** One config as ownership reads it, with everything it extends folded in. */
interface Config {
  readonly directory: string;
  /** `files`, `include` and `exclude`, as absolute paths and patterns. */
  readonly files: readonly string[] | undefined;
  readonly include: readonly string[] | undefined;
  readonly exclude: readonly string[] | undefined;
  readonly allowJs: boolean;
  readonly references: readonly Config[];
  /** `customConditions`, where `null` is the empty list; absent when unset. */
  readonly conditions: readonly string[] | undefined;
}

/** The raw options of one file and its bases, before placing against a directory. */
interface Chain {
  readonly files?: readonly string[];
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly allowJs?: boolean;
  readonly conditions?: readonly string[];
  readonly references: readonly string[];
}

/**
 * A function from an importing file to the conditions its `tsconfig` adds.
 *
 * `tsconfig` is what a scan was configured with: `'auto'` discovers the config
 * per file, a path names the one config (and the projects it references).
 */
export function customConditionsFor(tsconfig: string): (file: string) => readonly string[] {
  const chains = new Map<string, Chain | undefined>();
  const configs = new Map<string, Config | undefined>();
  const nearest = new Map<string, string | undefined>();

  const load = (path: string): Config | undefined => {
    if (configs.has(path)) return configs.get(path);
    const chain = chainOf(path, chains, new Set());
    const directory = dirname(path);
    const config = chain === undefined
      ? undefined
      : {
          directory,
          files: chain.files?.map((file) => placed(directory, file)),
          include: chain.include?.map((pattern) => placed(directory, pattern)),
          exclude: chain.exclude?.map((pattern) => placed(directory, pattern)),
          allowJs: chain.allowJs === true,
          references: chain.references
            .map((reference) => configFile(normalize(join(directory, reference))))
            .map((found) => found === undefined ? undefined : load(found))
            .filter((found): found is Config => found !== undefined),
          conditions: chain.conditions,
        };
    configs.set(path, config);
    return config;
  };

  const governing = (file: string): Config | undefined => {
    if (tsconfig !== 'auto') {
      const config = load(resolve(tsconfig));
      return config === undefined ? undefined : solution(config, file);
    }
    if (file.split(sep).includes('node_modules')) return undefined;
    for (let directory = dirname(file); ; directory = dirname(directory)) {
      if (!nearest.has(directory)) {
        const candidate = join(directory, 'tsconfig.json');
        nearest.set(directory, isFile(candidate) ? candidate : undefined);
      }
      const candidate = nearest.get(directory);
      if (candidate !== undefined) {
        const config = load(candidate);
        if (config === undefined) return undefined;
        if (claims(config, file)) return solution(config, file);
      }
      if (dirname(directory) === directory) return undefined;
    }
  };

  return (file) => governing(file)?.conditions ?? [];
}

/** A config's own options, then each unset one from its bases, last base first. */
function chainOf(
  path: string,
  chains: Map<string, Chain | undefined>,
  seen: ReadonlySet<string>,
): Chain | undefined {
  if (chains.has(path)) return chains.get(path);
  if (seen.has(path)) return undefined;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  const raw = text.trim() === '' ? {} : parseConfig(text);
  if (raw === undefined) return undefined;

  const options = (raw['compilerOptions'] ?? {}) as Record<string, unknown>;
  const custom = options['customConditions'];
  let chain: Chain = {
    ...list('files', raw['files']),
    ...list('include', raw['include']),
    ...list('exclude', raw['exclude']),
    ...(typeof options['allowJs'] === 'boolean' ? { allowJs: options['allowJs'] } : {}),
    ...(custom === undefined ? {} : { conditions: Array.isArray(custom) ? strings(custom) : [] }),
    references: Array.isArray(raw['references'])
      ? raw['references'].flatMap((reference: unknown) => {
          const at = (reference as { path?: unknown } | null)?.path;
          return typeof at === 'string' ? [at] : [];
        })
      : [],
  };

  const extended = raw['extends'];
  const bases = typeof extended === 'string' ? [extended] : Array.isArray(extended) ? strings(extended) : [];
  for (const base of bases.reverse()) {
    const found = extendedFile(dirname(path), base);
    if (found === undefined) return undefined;
    const inherited = chainOf(found, chains, new Set([...seen, path]));
    if (inherited === undefined) return undefined;
    chain = {
      ...(chain.files ?? inherited.files) === undefined ? {} : { files: chain.files ?? inherited.files },
      ...(chain.include ?? inherited.include) === undefined ? {} : { include: chain.include ?? inherited.include },
      ...(chain.exclude ?? inherited.exclude) === undefined ? {} : { exclude: chain.exclude ?? inherited.exclude },
      ...(chain.allowJs ?? inherited.allowJs) === undefined ? {} : { allowJs: chain.allowJs ?? inherited.allowJs },
      ...(chain.conditions ?? inherited.conditions) === undefined
        ? {}
        : { conditions: chain.conditions ?? inherited.conditions },
      references: chain.references,
    };
  }

  chains.set(path, chain);
  return chain;
}

function list(key: 'files' | 'include' | 'exclude', value: unknown): Partial<Chain> {
  return Array.isArray(value) ? { [key]: strings(value) } : {};
}

function strings(values: readonly unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string');
}

/** A path or pattern from a config, placed against the governing config's directory. */
function placed(directory: string, path: string): string {
  const template = '${configDir}';
  const at = path.startsWith(template)
    ? join(directory, path.slice(template.length).replace(/^\/+/u, ''))
    : isAbsolute(path) ? path : join(directory, path);
  return normalize(at).split(sep).join('/');
}

/** The file an `extends` entry names: a path, or a package under a `node_modules` above. */
function extendedFile(directory: string, specifier: string): string | undefined {
  if (specifier.startsWith('/') || specifier.startsWith('.')) {
    return configFile(normalize(join(directory, specifier)));
  }
  if (specifier === '' || specifier.startsWith('#')) return undefined;
  for (let at = directory; ; at = dirname(at)) {
    const found = configFile(join(at, 'node_modules', specifier));
    if (found !== undefined) return found;
    if (dirname(at) === at) return undefined;
  }
}

/** The order `oxc-resolver` loads a config in: the file, a directory's `tsconfig.json`, the name plus `.json`. */
function configFile(path: string): string | undefined {
  if (isFile(path)) return path;
  const chosen = isDirectory(path) ? join(path, 'tsconfig.json') : `${path}.json`;
  return isFile(chosen) ? chosen : undefined;
}

function solution(config: Config, file: string): Config {
  return config.references.find((reference) => included(reference, file)) ?? config;
}

function claims(config: Config, file: string): boolean {
  if (config.references.some((reference) => included(reference, file))) return true;
  const solutionStyle = config.references.length > 0
    && config.files?.length === 0
    && config.include?.length === 0;
  return !solutionStyle && included(config, file);
}

function included(config: Config, file: string): boolean {
  const path = file.split(sep).join('/');
  if (config.files?.some((listed) => listed === path)) return true;
  const extension = extname(file).slice(1);
  if (extension === '' || (!config.allowJs && JS.has(extension))) return false;
  const inside = config.include === undefined
    ? config.files === undefined && file.startsWith(`${config.directory}${sep}`) && allowed(config, extension)
    : config.include.some((pattern) => globbed(config, pattern, path, extension));
  return inside && !(config.exclude ?? []).some((pattern) => globbed(config, pattern, path, extension));
}

function globbed(config: Config, pattern: string, path: string, extension: string): boolean {
  if (pattern === path) return true;
  const last = pattern.slice(pattern.lastIndexOf('/') + 1);
  const full = /[.*?]/u.test(last) ? pattern : `${pattern}${pattern.endsWith('/') ? '' : '/'}**/*`;
  if (full.endsWith('*') && !allowed(config, extension)) return false;
  return matcher(full)(path);
}

const TS = new Set(['ts', 'tsx', 'mts', 'cts']);
const JS = new Set(['js', 'jsx', 'mjs', 'cjs']);

function allowed(config: Config, extension: string): boolean {
  return TS.has(extension) || (config.allowJs && JS.has(extension));
}

const matchers = new Map<string, (path: string) => boolean>();

function matcher(pattern: string): (path: string) => boolean {
  let held = matchers.get(pattern);
  if (held === undefined) matchers.set(pattern, (held = picomatch(pattern, { dot: true })));
  return held;
}

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}
