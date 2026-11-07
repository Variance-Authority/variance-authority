/**
 * The `transform` Jest will run, read before Jest reads it.
 *
 * The wrap sees the object in the config file, and Jest merges a preset's
 * `transform` in afterwards. A pattern left out of what the wrap returns would
 * run unwrapped, and one the wrap adds would match first, so the wrap wraps
 * what the merge gives instead.
 */

import { createRequire } from 'node:module';
import { jestDependency, type FindNodeModule } from './jest-config-paths.js';
import presets from './jest-preset-file.cjs';
import type { JestConfig } from './jest.js';

/** What the object's preset says of `transform`. Jest reads a preset it cannot load next, and says what is wrong. */
function presetTransform(preset: string, rootDir: string): JestConfig['transform'] {
  const resolver = jestDependency(rootDir, 'jest-resolve');
  const require = createRequire(resolver);
  const { findNodeModule } = (require(resolver) as { default: { findNodeModule: FindNodeModule } }).default;
  try {
    return presets.readPreset(findNodeModule, require, rootDir, preset)?.transform as JestConfig['transform'];
  } catch {
    return undefined;
  }
}

/** The object's `transform` as `setupPreset` leaves it: the preset's merged behind it, and the object's own winning. */
export function mergedTransform(config: JestConfig, rootDir: string): JestConfig['transform'] {
  const { preset, transform } = config;
  const theirs = typeof preset === 'string' ? presetTransform(preset, rootDir) : undefined;
  return transform && theirs ? { ...transform, ...theirs, ...transform } : transform ?? theirs;
}
