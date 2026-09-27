/**
 * What a specifier meant to the test runner, asked of the runner's own
 * configuration.
 *
 * The manifest says what an import means to a consumer; the runner's
 * `resolve.alias` can say something else under test, and the recording was made
 * under the runner. Docusaurus's `vitest.config.ts` sends `@docusaurus/utils`
 * to `src/` and leaves `@docusaurus/logger` on `lib/`, so a journey that asked
 * the manifest would lose every call into the one and keep the other.
 *
 * The configs are loaded by the repository's own Vite with its in-memory
 * loader, so nothing is written beside them. That costs a second on a
 * repository with dozens of configs, so the table is stamped with a digest of
 * every file it was read from — each config and every module the config
 * imported — and read again only when one of them changed. A config Vite
 * cannot load is named with why, and its aliases are missing, not guessed.
 */

// compass: variance-authority.reach.relations

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** A Vite or Vitest config, and not one a fixture, template or example ships. */
const CONFIG = /(^|\/)(vitest|vite)\.config(\.[a-z]+)?\.[cm]?[jt]s$/;
const ASIDE = /(^|\/)(node_modules|fixtures?|__fixtures__|test-cases|templates?|examples?)\//;

/** One alias as the addon reads it: a string matched whole or as a leading segment, or a pattern. */
export type RunnerAlias =
  | { readonly find: string; readonly replacement: string }
  | { readonly source: string; readonly flags: string; readonly replacement: string };

/** The runner's alias table and the stamp it is kept under. */
export interface RunnerAliases {
  /** sha256 over every file in `files`, path and bytes. */
  readonly digest: string;
  /** The configs and every module they imported, from the root. */
  readonly files: readonly string[];
  /** Configs Vite could not load, each with why. */
  readonly unread: readonly string[];
  readonly configs: readonly { readonly directory: string; readonly aliases: readonly RunnerAlias[] }[];
}

/** The tracked Vite and Vitest configs, in code-unit order; absent when git cannot list them. */
export async function runnerConfigs(root: string): Promise<readonly string[] | undefined> {
  try {
    const { stdout } = await run(
      'git',
      ['-c', 'core.quotePath=false', 'ls-files', '-z', '--', ':(glob)**/vite.config.*', ':(glob)**/vitest.config.*'],
      { cwd: root, maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout.split('\0').filter((file) => CONFIG.test(file) && !ASIDE.test(file)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch {
    return undefined;
  }
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

interface Vite {
  loadConfigFromFile(
    env: { command: 'serve'; mode: string; isSsrBuild: boolean; isPreview: boolean },
    file: string,
    root: string,
    logLevel: 'silent',
    logger: undefined,
    loader: 'runner',
  ): Promise<{ config: { resolve?: { alias?: unknown } }; dependencies: string[] } | null>;
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

function aliasesOf(config: { resolve?: { alias?: unknown } }): RunnerAlias[] {
  const alias = config.resolve?.alias;
  const listed: { find: unknown; replacement: unknown }[] = alias === undefined || alias === null
    ? []
    : Array.isArray(alias)
    ? alias as { find: unknown; replacement: unknown }[]
    : Object.entries(alias as Record<string, unknown>).map(([find, replacement]) => ({ find, replacement }));
  return listed.flatMap(({ find, replacement }): RunnerAlias[] => {
    if (typeof replacement !== 'string') return [];
    if (typeof find === 'string') return [{ find, replacement }];
    if (find instanceof RegExp) return [{ source: find.source, flags: find.flags, replacement }];
    return [];
  });
}

/** Read each config's `resolve.alias` with the repository's Vite. */
export async function runnerAliases(root: string, configs: readonly string[]): Promise<RunnerAliases> {
  const unread: string[] = [];
  const read: { directory: string; aliases: RunnerAlias[] }[] = [];
  const files = new Set(configs);
  if (configs.length > 0) {
    let vite: Vite | undefined;
    try {
      vite = await repositoryVite(root);
    } catch (error) {
      for (const file of configs) unread.push(`${file}: no Vite to load it with (${firstLine(error)})`);
    }
    const cwd = process.cwd();
    for (const file of vite === undefined ? [] : configs) {
      const directory = dirname(file) === '.' ? '' : dirname(file);
      try {
        // A config that reads `process.cwd()` means the directory it sits in,
        // which is where its runner starts.
        try {
          process.chdir(join(root, directory));
        } catch {
          // A worker cannot change directory; the config is loaded from here.
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
        read.push({ directory, aliases: aliasesOf(loaded.config) });
        for (const dependency of loaded.dependencies) {
          const path = relative(root, isAbsolute(dependency) ? dependency : resolve(root, directory, dependency));
          if (!path.startsWith('..') && !path.split('/').includes('node_modules')) files.add(path);
        }
      } catch (error) {
        unread.push(`${file}: ${firstLine(error)}`);
      } finally {
        process.chdir(cwd);
      }
    }
  }
  const listed = [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { digest: runnerDigest(root, listed), files: listed, unread, configs: read };
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0]!.slice(0, 200);
}
