/**
 * The `transform` of a Jest preset, read before Jest reads it.
 *
 * The wrap sees the object in the config file, and Jest fills an unnamed
 * `transform` from the preset afterwards. A pattern the wrap adds in its place
 * matches first, so the preset's transformer would never run: the wrap wraps
 * what the preset names instead.
 */

import { createRequire } from 'node:module';
import { jestDependency, type FindNodeModule } from './jest-config-paths.js';
import presets from './jest-preset-file.cjs';
import type { JestConfig } from './jest.js';

/**
 * What the object's preset says of `transform`. A preset that cannot be found
 * or read is absent here: Jest reads it next and says what is wrong in its own
 * words.
 */
export function presetTransform(config: JestConfig, rootDir: string): JestConfig['transform'] {
  const preset = config['preset'];
  if (typeof preset !== 'string') return undefined;
  try {
    const resolver = jestDependency(rootDir, 'jest-resolve');
    const require = createRequire(resolver);
    const { findNodeModule } = (require(resolver) as { default: { findNodeModule: FindNodeModule } }).default;
    const file = presets.presetFile(findNodeModule, rootDir, preset);
    if (file === null) return undefined;
    return (presets.interop(require(file)) as Pick<JestConfig, 'transform'>).transform;
  } catch {
    return undefined;
  }
}
