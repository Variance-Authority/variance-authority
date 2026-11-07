/**
 * The `transform` Jest will run, read before Jest reads it.
 *
 * The wrap sees the object in the config file, and Jest merges a preset's
 * `transform` in afterwards. A pattern left out of what the wrap returns would
 * run unwrapped, and one the wrap adds would match first, so the wrap wraps
 * what the merge gives instead.
 */

import { createRequire } from 'node:module';
import { jestDependency, readFromConfigFile, type FindNodeModule } from './jest-config-paths.js';
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

/**
 * What the object's preset says of `transform`; `null` from a preset is Jest's
 * none. A preset that throws is left to Jest, which reads it next and says what
 * is wrong, and so is a missing one when the wrap searched from Jest's directory.
 * One missing from a `rootDir` Jest reads from the config file is refused: Jest
 * may find it, and the wrap's default would then match ahead of its patterns.
 * One only `import` can read is refused too: Jest awaits it and runs, so nothing
 * would name what the wrap failed to read.
 */
function presetTransform(preset: string, config: JestConfig, rootDir: string): JestConfig['transform'] {
  const { find, load } = resolver(preset, rootDir);
  let read: ReturnType<typeof presets.readPreset>;
  try {
    read = presets.readPreset(find, load, rootDir, preset);
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    if (code !== 'ERR_REQUIRE_ASYNC_MODULE' && code !== 'ERR_REQUIRE_ESM') return undefined;
    throw new Error(
      `variance-authority: preset ${preset} cannot be read synchronously, and the wrap needs its \`transform\` before Jest starts: ${message} ` +
        'Load it without top-level await, or move its options into this configuration and drop `preset`.',
      { cause: error },
    );
  }
  if (read === null && readFromConfigFile(config)) {
    throw new Error(
      `variance-authority: preset ${preset} is not found from ${rootDir}. ` +
        'Jest reads a relative `rootDir` from the config file, whose directory the wrap is never told. ' +
        'Write `rootDir` as an absolute path, such as `import.meta.dirname` in an ES module or `__dirname` in CommonJS.',
    );
  }
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
