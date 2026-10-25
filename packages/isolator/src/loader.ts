/**
 * The loader for Rspack and webpack: isolate each module before the project's
 * loaders read it. It speaks the loader API both share and imports neither.
 *
 * ```js
 * // rspack.config.mjs
 * module: {
 *   rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, enforce: 'pre', loader: '@variance-authority/isolator/loader' }],
 * }
 * ```
 *
 * Declared `enforce: 'pre'`, it receives the file as it is on disk, so its map
 * names the file, and the loaders after it compose it with theirs. A declaration
 * it leaves is a build warning, with the reason.
 */

import { relative } from 'node:path';
import { skipper } from './skips.js';
import { isolate } from './transform.js';

/** What the loader's rule may carry. */
export interface IsolatorLoaderOptions {
  /** Globs, relative to the build's context, of modules whose state stays shared. */
  readonly exclude?: readonly string[];
}

/** The part of the loader API this uses, which Rspack and webpack both give. */
export interface IsolatorLoaderContext {
  readonly resourcePath: string;
  readonly rootContext: string;
  readonly getOptions: () => IsolatorLoaderOptions | undefined;
  readonly emitWarning: (warning: Error) => void;
  readonly callback: (error: Error | null, code?: string, map?: object) => void;
}

/** One skip rule per build context and `exclude`, so its verdicts outlive a module. */
const skippers = new Map<string, (path: string) => boolean>();

function isolatorLoader(this: IsolatorLoaderContext, code: string): void {
  const path = this.resourcePath;
  const exclude = this.getOptions()?.exclude;
  const key = JSON.stringify([this.rootContext, exclude ?? []]);
  let skipped = skippers.get(key);
  if (skipped === undefined) skippers.set(key, (skipped = skipper(this.rootContext, exclude)));
  if (skipped(path)) {
    this.callback(null, code);
    return;
  }
  const result = isolate(code, path);
  for (const { line, name, reason } of result.left) {
    this.emitWarning(new Error(`isolator: ${relative(this.rootContext, path).replaceAll('\\', '/')}:${line} \`${name}\` stays shared: ${reason}`));
  }
  this.callback(null, result.code, result.map);
}

export { isolatorLoader as default };
