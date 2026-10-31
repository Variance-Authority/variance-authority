/**
 * The plugin for Vitest: isolate each module before Vite's own transforms
 * read it. It speaks the plugin hooks Vitest calls and imports neither Vite nor
 * Vitest.
 *
 * ```ts
 * // vitest.config.ts
 * import { isolator } from '@variance-authority/isolator/vite';
 * export default defineConfig({ plugins: [isolator()], test: { isolate: false, setupFiles: ['./reset.setup.ts'] } });
 * ```
 *
 * The setup file calls ioc's `configureResetHandler(beforeEach)` and runs each
 * concurrent test in an `isolated` session through `aroundEach`, and files that
 * mock or render into a DOM keep an isolated project: the package README, "Run
 * it in Vitest", has both.
 *
 * Vitest answers which files it runs itself: a module any project calls a
 * test, by its `include` and `includeSource`, and a project's setup files stay
 * as they are, since each runs once for every file anyway. Everything else
 * follows the rule every seam shares, which `skips.ts` holds. A declaration it
 * leaves is a warning, with the reason.
 */

import { relative } from 'node:path';
import { isolate } from './transform.js';
import { skipper } from './skips.js';

/** What the plugin may be handed. */
export interface IsolatorPluginOptions {
  /** Globs, relative to Vitest's root, of modules whose state stays shared. */
  readonly exclude?: readonly string[];
}

/** The part of a Vitest project this reads. */
export interface IsolatorProject {
  readonly config: { readonly setupFiles: readonly string[] };
  readonly matchesTestGlob: (moduleId: string, source?: () => string) => boolean;
}

/** The plugin, as Vite and Vitest call it. */
export interface IsolatorPlugin {
  readonly name: string;
  readonly enforce: 'pre';
  configureVitest(context: { readonly project: IsolatorProject; readonly vitest: { readonly config: { readonly root: string } } }): void;
  transform(this: { warn(message: string): void }, code: string, id: string): { code: string; map: object | undefined } | undefined;
}

const SCRIPT = /\.[cm]?[jt]sx?$/;

/** The isolator as a Vite plugin, for a Vitest run that keeps its modules across files. */
export function isolator(options: IsolatorPluginOptions = {}): IsolatorPlugin {
  // A plugin of the root config serves every project that extends it.
  const projects: IsolatorProject[] = [];
  const setupFiles = new Set<string>();
  let root = '';
  let skipped: ((path: string) => boolean) | undefined;
  return {
    name: '@variance-authority/isolator',
    enforce: 'pre',
    configureVitest({ project, vitest }) {
      projects.push(project);
      for (const file of project.config.setupFiles) setupFiles.add(file);
      root = vitest.config.root;
      skipped ??= skipper(root, options.exclude);
    },
    transform(code, id) {
      const path = id.split('?')[0]!;
      if (id.startsWith('\0') || !SCRIPT.test(path)) return undefined;
      if (skipped === undefined) throw new Error(`${path} reached the isolator before Vitest configured it: the plugin runs under Vitest`);
      if (setupFiles.has(path) || skipped(path) || projects.some((project) => project.matchesTestGlob(path, () => code))) return undefined;
      const { code: rewritten, map, left } = isolate(code, path);
      for (const { line, name, reason } of left) this.warn(`isolator: ${relative(root, path).replaceAll('\\', '/')}:${line} \`${name}\` stays shared: ${reason}`);
      return { code: rewritten, map };
    },
  };
}
