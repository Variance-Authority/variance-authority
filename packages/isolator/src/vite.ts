/**
 * The plugin for Vite and Vitest: isolate each module before Vite's own
 * transforms read it. It speaks the plugin hooks they call and imports neither.
 * Under Vitest, Vitest answers which files are tests, and they and the setup
 * files stay as they are, since each runs once for every file anyway. Under
 * Vite alone, as in Storybook, every module loads once for the page, so every
 * one is rewritten. Both follow the rule every seam shares, which `skips.ts`
 * holds; a declaration it leaves is a warning.
 */

import { relative } from 'node:path';
import { isolate } from './transform.js';
import { skipper } from './skips.js';

/** What the plugin may be handed. */
export interface IsolatorPluginOptions {
  /** Globs, relative to Vitest's root, or Vite's under Vite alone, of modules whose state stays shared. */
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
  configResolved(config: { readonly root: string }): void;
  configureVitest(context: { readonly project: IsolatorProject; readonly vitest: { readonly config: { readonly root: string } } }): void;
  transform(this: { warn(message: string): void }, code: string, id: string): { code: string; map: object | undefined } | undefined;
}

const SCRIPT = /\.[cm]?[jt]sx?$/;

/**
 * The isolator as a Vite plugin, for a Vitest run that keeps its modules across
 * files, or a page that shows one story after another. The package README, "Run
 * it in Vitest" and "Run it in Storybook", has the reset each pairs with:
 *
 * ```ts
 * export default defineConfig({ plugins: [isolator()], test: { isolate: false, setupFiles: ['./reset.setup.ts'] } });
 * ```
 */
export function isolator(options: IsolatorPluginOptions = {}): IsolatorPlugin {
  // A plugin of the root config serves every project that extends it.
  const projects: IsolatorProject[] = [];
  const setupFiles = new Set<string>();
  let root = '';
  let skipped: ((path: string) => boolean) | undefined;
  return {
    name: '@variance-authority/isolator',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
      skipped ??= skipper(root, options.exclude);
    },
    configureVitest({ project, vitest }) {
      projects.push(project);
      for (const file of project.config.setupFiles) setupFiles.add(file);
      // Vite resolved each project's own root first; Vitest's is the one `exclude` is read from.
      if (root !== vitest.config.root) skipped = skipper(vitest.config.root, options.exclude);
      root = vitest.config.root;
    },
    transform(code, id) {
      const path = id.split('?')[0]!;
      if (id.startsWith('\0') || !SCRIPT.test(path)) return undefined;
      if (skipped === undefined) throw new Error(`${path} reached the isolator before Vite resolved its config: the plugin runs under Vite or Vitest`);
      if (setupFiles.has(path) || skipped(path) || projects.some((project) => project.matchesTestGlob(path, () => code))) return undefined;
      const { code: rewritten, map, left } = isolate(code, path);
      for (const { line, name, reason } of left) this.warn(`isolator: ${relative(root, path).replaceAll('\\', '/')}:${line} \`${name}\` stays shared: ${reason}`);
      return { code: rewritten, map };
    },
  };
}
