/**
 * A Jest preset by jest-config's steps, for the two places that read one
 * outside Jest: the wrap, before Jest starts, and the runtime, in a worker.
 * Each hands in the `findNodeModule` of the `jest-resolve` it can reach.
 */

import path = require('node:path');

type FindNodeModule = (path: string, options: { basedir: string; extensions?: readonly string[]; resolver?: string }) => string | null;

/** jest-config's `replaceRootDirInPath`. */
const rooted = (rootDir: string, name: string): string =>
  name.startsWith('<rootDir>') ? path.resolve(rootDir, path.normalize(`./${name.slice('<rootDir>'.length)}`)) : name;

/** Jest's `interopRequireDefault(…).default`, the way it reads a preset, an environment or a runtime module. */
const interop = (loaded: unknown): unknown =>
  (loaded as { __esModule?: boolean } | null)?.__esModule === true ? (loaded as { default: unknown }).default : loaded;

/** The file `setupPreset` finds for a preset as written; `null` when it finds none. */
function presetFile(find: FindNodeModule, rootDir: string, name: string): string | null {
  const preset = rooted(rootDir, name);
  return find(preset.startsWith('.') || path.isAbsolute(preset) ? preset : `${preset}/jest-preset`, {
    basedir: rootDir,
    extensions: ['.json', '.js', '.cjs', '.mjs'],
  });
}

export = { interop, presetFile, rooted };
