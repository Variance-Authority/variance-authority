/**
 * The `transform` Jest will run, read before Jest reads it.
 *
 * The wrap sees the object in the config file, and Jest merges a preset's
 * `transform` in afterwards. A pattern left out of what the wrap returns would
 * run unwrapped, and one the wrap adds would match first, so the wrap wraps
 * what the merge gives instead.
 */

import { createRequire } from 'node:module';
import { readFromConfigFile, type FindNodeModule } from './jest-config-paths.js';
import { jestDependency } from './jest-dependency.js';
import presets from './jest-preset-file.cjs';
import type { JestConfig } from './jest.js';

/** The `jest-resolve` Jest reads a preset through, and a `require` beside it. */
function resolver(preset: string, rootDir: string): { readonly find: FindNodeModule; readonly load: NodeJS.Require } {
  let file: string;
  try {
    file = jestDependency(rootDir, 'jest-resolve');
  } catch (cause) {
    throw new Error(
      `variance-authority: preset ${preset} cannot be read: \`jest-resolve\` is not reachable from ${rootDir}. ` +
        'Set `rootDir` to the absolute path of the project that has Jest installed.',
      { cause },
    );
  }
  const load = createRequire(file);
  return { find: (load(file) as { default: { findNodeModule: FindNodeModule } }).default.findNodeModule, load };
}

/** The refusal of a preset Jest looks for from a directory the wrap cannot name. */
const unplaced = (preset: string, rootDir: string): Error => new Error(
  `variance-authority: preset ${preset} cannot be read as Jest will read it: ` +
    `Jest reads a relative \`rootDir\` from the config file, whose directory the wrap is never told, and ${rootDir} may not be it. ` +
    'Write `rootDir` as an absolute path, such as `import.meta.dirname` in an ES module or `__dirname` in CommonJS.',
);

/** The refusal of a preset Jest awaits, which a synchronous wrap cannot. */
const awaited = (preset: string, reason: string, cause?: unknown): Error => new Error(
  `variance-authority: preset ${preset} cannot be read synchronously, and the wrap needs its \`transform\` before Jest starts: ${reason} ` +
    'Give it a synchronous export, or move its options into this configuration and drop `preset`.',
  { cause },
);

/**
 * What the object's preset says of `transform`; `null` from a preset is Jest's
 * none. A preset that throws is left to Jest, which reads it next and says what
 * is wrong, and so is a missing one when the wrap searched from Jest's directory.
 *
 * Under a `rootDir` Jest reads from the config file, a preset spelled as a path
 * is refused unread: the file there may not be the file Jest runs, and a run
 * through the wrong one passes. A bare name missing there is refused too: Jest
 * may find it, and the wrap's default would then match ahead of its patterns.
 * One Jest awaits is refused: it runs, so nothing would name what the wrap
 * failed to read.
 */
function presetTransform(preset: string, config: JestConfig, rootDir: string): JestConfig['transform'] {
  const relative = readFromConfigFile(config);
  if (relative && (preset.startsWith('.') || preset.startsWith('<rootDir>'))) throw unplaced(preset, rootDir);
  const { find, load } = resolver(preset, rootDir);
  let read: ReturnType<typeof presets.readPreset>;
  try {
    read = presets.readPreset(find, load, rootDir, preset);
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    if (code !== 'ERR_REQUIRE_ASYNC_MODULE' && code !== 'ERR_REQUIRE_ESM') return undefined;
    throw awaited(preset, message, error);
  }
  if (read === null && relative) throw unplaced(preset, rootDir);
  if (typeof (read as Partial<PromiseLike<unknown>> | null)?.then === 'function') throw awaited(preset, 'it exports a promise.');
  return read?.transform as JestConfig['transform'] | null ?? undefined;
}

/**
 * The object's `transform` as `setupPreset` leaves it: the preset's merged
 * behind it, the object's own winning, and an own `undefined` or `null`
 * shadowing the preset's. `jest-config` is not asked, because
 * its public readers are async, `setupPreset` is not exported, and the wrap is sync.
 */
export function mergedTransform(config: JestConfig, rootDir: string): JestConfig['transform'] {
  const { preset, transform } = config;
  if ('transform' in config && !transform) return undefined;
  const theirs = typeof preset === 'string' ? presetTransform(preset, config, rootDir) : undefined;
  return transform && theirs ? { ...transform, ...theirs, ...transform } : transform ?? theirs;
}
