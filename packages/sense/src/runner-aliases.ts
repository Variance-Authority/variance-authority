/**
 * What a specifier meant to the test runner, asked of the runner's own
 * configuration.
 *
 * The manifest says what an import means to a consumer; the runner's
 * `resolve.alias` and Vitest's `test.alias` can say something else under test,
 * and the recording was made under the runner. Docusaurus's `vitest.config.ts` sends `@docusaurus/utils`
 * to `src/` and leaves `@docusaurus/logger` on `lib/`, so a journey that asked
 * the manifest would lose every call into the one and keep the other.
 *
 * The configs are loaded by the repository's own Vite with its in-memory
 * loader, so nothing is written beside them. That costs a second on a
 * repository with dozens of configs, so the table is kept beside the source
 * index, stamped with a digest of every file it was read from — each config
 * and every module the config imported — and read again only when one of them
 * changed ({@link keptRunnerAliases}). A config Vite cannot load, and an alias
 * the table cannot carry, is named with why, and its answer is missing, not
 * guessed.
 */

// compass: variance-authority.reach.relations

import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { native } from './native.js';
import type { NativeJourneysListing } from './native-journeys.js';

/** One alias as the addon reads it: a string matched whole or as a leading segment, or a pattern. */
export type RunnerAlias =
  | { readonly find: string; readonly replacement: string }
  | { readonly source: string; readonly flags: string; readonly replacement: string };

/** The runner's alias table and the stamp it is kept under. */
export interface RunnerAliases {
  /** sha256 over every file in `files`, path and bytes, and over `unread` when a config did not load. */
  readonly digest: string;
  /** The configs and every module they imported, from the root. */
  readonly files: readonly string[];
  /** Configs Vite could not load and aliases the table cannot carry, each with why. */
  readonly unread: readonly string[];
  /**
   * The configs that did not load. What they need sits outside the digest — an
   * installed plugin, a Vite to load with — so a table with any is read again
   * rather than kept.
   */
  readonly unloaded?: readonly string[];
  readonly configs: readonly { readonly directory: string; readonly aliases: readonly RunnerAlias[] }[];
}

/**
 * The tracked Vite and Vitest configs, in code-unit order, not counting one a
 * fixture, a template or an example ships: from `listing` when a scan carries
 * one, else as git lists them. Absent when git cannot list them.
 */
export function runnerConfigs(root: string, listing?: NativeJourneysListing): readonly string[] | undefined {
  const carried = listing?.runnerConfigs?.bind(listing);
  if (carried !== undefined) return carried();
  const listed = native()?.runnerConfigs;
  return listed === undefined ? undefined : listed(root) ?? undefined;
}

/** The table when git could not list the configs: nothing is read, and the answer says so. */
export function unlistedRunnerAliases(root: string, why: string): RunnerAliases {
  return { digest: runnerDigest(root, []), files: [], unread: [`runner configs were not listed: ${why}`], configs: [] };
}

/** The digest a table read from `files` is stamped with. A missing file is part of the stamp. */
export function runnerDigest(root: string, files: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    hash.update(file).update('\0');
    try {
      hash.update(readFileSync(join(root, file)));
    } catch {
      hash.update('\0missing');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** The part of a loaded config the table reads. */
interface Config {
  readonly resolve?: { readonly alias?: unknown };
  readonly test?: { readonly alias?: unknown };
}

interface Vite {
  loadConfigFromFile(
    env: { command: 'serve'; mode: string; isSsrBuild: boolean; isPreview: boolean },
    file: string,
    root: string,
    logLevel: 'silent',
    logger: undefined,
    loader: 'runner',
  ): Promise<{ config: Config; dependencies: string[] } | null>;
}

/** The repository's own Vite, as its manifest exports it for `import`. */
async function repositoryVite(root: string): Promise<Vite> {
  const manifest = createRequire(join(root, 'package.json')).resolve('vite/package.json');
  const exported = (JSON.parse(readFileSync(manifest, 'utf8')) as { exports: Record<string, unknown> }).exports['.'];
  const entry = typeof exported === 'string'
    ? exported
    : ((exported as { import?: string | { default?: string } }).import as { default?: string } | string | undefined);
  const path = typeof entry === 'string' ? entry : entry?.default;
  if (path === undefined) throw new Error(`${manifest} exports no entry to import`);
  return (await import(pathToFileURL(join(dirname(manifest), path)).href)) as Vite;
}

interface Written {
  readonly find: unknown;
  readonly replacement: unknown;
  readonly customResolver?: unknown;
}

function listed(alias: unknown): readonly Written[] {
  if (alias === undefined || alias === null) return [];
  return Array.isArray(alias)
    ? (alias as Written[])
    : Object.entries(alias as Record<string, unknown>).map(([find, replacement]) => ({ find, replacement }));
}

/**
 * The aliases a loaded config sends specifiers through, in the order the
 * runner tries them: Vitest merges `test.alias` ahead of `resolve.alias`. An
 * alias the table cannot carry is named in `unread`, with why.
 */
function aliasesOf(file: string, config: Config): { aliases: RunnerAlias[]; unread: string[] } {
  const aliases: RunnerAlias[] = [];
  const unread: string[] = [];
  for (const [where, alias] of [['test.alias', config.test?.alias], ['resolve.alias', config.resolve?.alias]] as const) {
    for (const { find, replacement, customResolver } of listed(alias)) {
      const named = typeof find === 'string' ? `\`${find}\`` : find instanceof RegExp ? String(find) : `a ${typeof find} find`;
      if (typeof find !== 'string' && !(find instanceof RegExp)) {
        unread.push(`${file}: ${where} ${named} is neither a string nor a pattern, and is not read`);
      } else if (customResolver !== undefined && customResolver !== null) {
        unread.push(`${file}: ${where} ${named} has a customResolver, which is not read`);
      } else if (typeof replacement !== 'string') {
        unread.push(`${file}: ${where} ${named} is replaced by a ${typeof replacement}, which is not read`);
      } else {
        aliases.push(typeof find === 'string' ? { find, replacement } : { source: find.source, flags: find.flags, replacement });
      }
    }
  }
  return { aliases, unread };
}

/** Read each config's aliases with the repository's Vite. */
export async function runnerAliases(root: string, configs: readonly string[]): Promise<RunnerAliases> {
  const unread: string[] = [];
  const unloaded: string[] = [];
  const read: { directory: string; aliases: RunnerAlias[] }[] = [];
  const files = new Set(configs);
  if (configs.length > 0) {
    let vite: Vite | undefined;
    try {
      vite = await repositoryVite(root);
    } catch (error) {
      for (const file of configs) unread.push(`${file}: no Vite to load it with (${firstLine(error)})`);
      unloaded.push(...configs);
    }
    const cwd = process.cwd();
    for (const file of vite === undefined ? [] : configs) {
      const directory = dirname(file) === '.' ? '' : dirname(file);
      try {
        // A config that reads `process.cwd()` means the directory it sits in,
        // which is where its runner starts.
        try {
          process.chdir(join(root, directory));
        } catch (error) {
          // A worker cannot change directory: the config is loaded from here,
          // and whatever it reads from `process.cwd()` is read from here too.
          unread.push(`${file}: loaded from ${cwd} rather than its own directory, which this process could not enter (${firstLine(error)})`);
        }
        // FIXME: the in-memory loader evaluates a config as an ES module, so a
        // config that reads `__dirname` does not load (MUI's
        // `test/regressions/vitest.config.ts`) and its aliases are missing;
        // Vite's default loader defines it, but writes a bundle beside the config.
        const loaded = await vite!.loadConfigFromFile(
          { command: 'serve', mode: 'test', isSsrBuild: false, isPreview: false },
          join(root, file),
          join(root, directory),
          'silent',
          undefined,
          'runner',
        );
        if (loaded === null) continue;
        const { aliases, unread: dropped } = aliasesOf(file, loaded.config);
        read.push({ directory, aliases });
        unread.push(...dropped);
        for (const dependency of loaded.dependencies) {
          const path = relative(root, isAbsolute(dependency) ? dependency : resolve(root, directory, dependency));
          if (!path.startsWith('..') && !path.split('/').includes('node_modules')) files.add(path);
        }
      } catch (error) {
        unread.push(`${file}: did not load (${firstLine(error)})`);
        unloaded.push(file);
      } finally {
        process.chdir(cwd);
      }
    }
  }
  const listed = [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const digest = runnerDigest(root, listed);
  if (unloaded.length === 0) return { digest, files: listed, unread, configs: read };
  // A config that did not load reads nothing, and loading it later reads
  // something: the stamp carries why, so journeys walked without it are not
  // kept once it loads.
  const stamped = createHash('sha256').update(digest).update(JSON.stringify(unread)).digest('hex');
  return { digest: stamped, files: listed, unread, unloaded, configs: read };
}

/**
 * The runner's alias table for `configs`, kept at `kept`: the one kept there
 * when every file it was read from is unchanged, it was read from every one of
 * `configs` and every one of them loaded, else read again with Vite and kept.
 */
export async function keptRunnerAliases(root: string, configs: readonly string[], kept: string): Promise<RunnerAliases> {
  try {
    const held = JSON.parse(readFileSync(kept, 'utf8')) as RunnerAliases;
    const files = new Set(held.files);
    const loaded = (held.unloaded ?? []).length === 0;
    if (loaded && configs.every((config) => files.has(config)) && runnerDigest(root, [...configs, ...held.files]) === held.digest) return held;
  } catch {
    // Nothing kept, or nothing readable: the table is read again.
  }
  const table = await runnerAliases(root, configs);
  const written = `${kept}.${process.pid}`;
  writeFileSync(written, JSON.stringify(table));
  renameSync(written, kept);
  return table;
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0]!.slice(0, 200);
}
