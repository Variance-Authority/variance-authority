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

/** Jest's pattern for the modules it transforms when nothing is configured. */
const DEFAULT_PATTERN = '\\.[jt]sx?$';

/** The patterns to wrap: a transformer each, and none where a script runs as it is. */
export type WrappedTransform = Readonly<Record<string, NonNullable<JestConfig['transform']>[string] | undefined>>;

/** `setupBabelJest`'s question of a pattern: does it take a script? */
function takesScripts(pattern: string): boolean {
  const matcher = new RegExp(pattern);
  return ['a.js', 'a.jsx', 'a.ts', 'a.tsx'].some((file) => matcher.test(file));
}

/**
 * The `transform` Jest will run for an object, by `setupPreset`'s merge and
 * `setupBabelJest`'s default. Scripts no pattern takes run as they are in Jest
 * and are not probed there, so Jest's default pattern follows, with no transformer.
 */
export function transformToWrap(config: JestConfig, rootDir: string): WrappedTransform {
  const own = config.transform;
  const preset = presetTransform(config, rootDir);
  const merged = own && preset ? { ...own, ...preset, ...own } : own ?? preset;
  if (!merged) return { [DEFAULT_PATTERN]: 'babel-jest' };
  return Object.keys(merged).some(takesScripts) ? merged : { ...merged, [DEFAULT_PATTERN]: undefined };
}

/**
 * What the object's preset says of `transform`. A preset that cannot be found
 * or read is absent here: Jest reads it next and says what is wrong in its own
 * words. One only `import` reads is fine by Jest, so the line is ours to write.
 */
function presetTransform(config: JestConfig, rootDir: string): JestConfig['transform'] {
  const preset = config['preset'];
  if (typeof preset !== 'string') return undefined;
  try {
    const resolver = jestDependency(rootDir, 'jest-resolve');
    const require = createRequire(resolver);
    const { findNodeModule } = (require(resolver) as { default: { findNodeModule: FindNodeModule } }).default;
    const file = presets.presetFile(findNodeModule, rootDir, preset);
    if (file === null) return undefined;
    const read = presets.presetAt(require, file) as Pick<JestConfig, 'transform'> | undefined;
    if (read === undefined && Object.keys(config.transform ?? {}).length === 0) {
      process.stderr.write(`variance-authority: preset ${preset} has top-level await, which only Jest can read, so its \`transform\` is not wrapped. Spell \`transform\` out in the object you wrap.\n`);
    }
    return read?.transform;
  } catch {
    return undefined;
  }
}
