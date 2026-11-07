/**
 * A Jest preset by jest-config's steps, for the two places that read one
 * outside Jest: the wrap, before Jest starts, and the runtime, in a worker.
 * Each hands in the `findNodeModule` of the `jest-resolve` it can reach.
 */

import path = require('node:path');
import type { FindNodeModule } from './jest-config-paths.js';

/** The options of a preset's the two readers ask for. */
interface Preset {
  readonly runtime?: string;
  readonly transform?: Readonly<Record<string, unknown>>;
}

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

/** What the preset as written says, by `load`, which is each reader's `require`; `null` when no file is found. */
function readPreset(find: FindNodeModule, load: (file: string) => unknown, rootDir: string, name: string): Preset | null {
  const file = presetFile(find, rootDir, name);
  return file === null ? null : (interop(load(file)) as Preset);
}

export = { interop, readPreset, rooted };
