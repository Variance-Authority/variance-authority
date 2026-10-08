/**
 * Where a Jest run places a `--shard` by recorded time: its `testSequencer`.
 *
 * Jest hands a sequencer's `shard` every test file of every project once, after
 * the filter has dropped what a selection skips, and only when `--shard` was
 * asked for. A sequencer is named by path, so the seam names
 * [`jest-sequencer.cts`](./jest-sequencer.cts) and leaves the project's own
 * sequencer and the placement on `globalThis`, as the filter is left.
 *
 * `testSequencer` is a global setting, so the project's own is chained rather
 * than replaced: it sorts, caches and answers everything else, and cuts the
 * shard itself when the record times none of the files.
 */

// compass: variance-authority.reach

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPath } from './instrumented-modules.js';
import { shardOf } from './shard-placement.js';
import type { SuiteTimes } from './suite-selection.js';

/** The sequencer module a wrapped configuration names, by absolute path. */
export const PLACING_SEQUENCER = fileURLToPath(new URL('./jest-sequencer.cjs', import.meta.url));

/** Where the configuration leaves the sequencer; mirrors `HANDED` in `jest-sequencer.cts`. */
const HANDED = Symbol.for('variance-authority:jest-sequencer');

interface Shard {
  readonly shardIndex: number;
  readonly shardCount: number;
}

interface Inner {
  shard?(tests: unknown[], options: Shard): unknown;
}

type SequencerClass = new (options: unknown) => Inner;

/** Jest's own sequencer, and the packages it is a dependency of, from the outside in. */
const JEST_SEQUENCER = '@jest/test-sequencer';
const JEST_CHAIN = ['jest', '@jest/core', 'jest-config'] as const;

/**
 * Where Jest's own sequencer is, for a configuration that names none. Jest
 * resolves it from `jest-config`, its dependency, not from the project: under
 * pnpm or any layout that does not hoist it, the project cannot resolve it, and
 * a run that never asked for `--shard` would fail on a sequencer it never named.
 * So it is looked for from the project, then from each package on Jest's path to it.
 */
function jestSequencer(rootDir: string): string {
  let from = resolve(rootDir, 'package.json');
  for (const next of [...JEST_CHAIN, undefined]) {
    const require = createRequire(from);
    try {
      return require.resolve(JEST_SEQUENCER);
    } catch (error) {
      if (next === undefined) throw error;
      from = require.resolve(next);
    }
  }
  throw new Error(`unreachable: ${JEST_SEQUENCER}`);
}

export interface PlacingOptions {
  /** The checkout the record names its files from. */
  readonly root: string;
  /** The configuration's `rootDir`, which the project's sequencer resolves from. */
  readonly rootDir: string;
  /** The suite's recorded times, read once, and only by a run under `--shard`. */
  readonly times: () => Promise<SuiteTimes>;
  readonly say?: (line: string) => void;
}

/** The `testSequencer` a configuration takes to place a `--shard` by recorded time. */
export function placingSequencer(
  config: { readonly [key: string]: unknown },
  options: PlacingOptions,
): { testSequencer?: string } {
  if (config.testSequencer === PLACING_SEQUENCER) return {};
  const say = options.say ?? ((line: string) => process.stderr.write(`${line}\n`));
  const from = createRequire(resolve(options.rootDir, 'package.json'));
  const spelled = typeof config.testSequencer === 'string' ? config.testSequencer : undefined;
  const path = spelled === undefined
    ? undefined
    : spelled.startsWith('<rootDir>') ? resolve(options.rootDir, spelled.replace(/^<rootDir>\/?/, '')) : spelled;
  let own: SequencerClass | undefined;
  let read: Promise<SuiteTimes> | undefined;
  let told = false;
  const handed = {
    own: (): SequencerClass => {
      const at = path === undefined ? jestSequencer(options.rootDir) : from.resolve(path, { paths: [options.rootDir] });
      const module = from(at) as SequencerClass | { default: SequencerClass };
      return (own ??= typeof module === 'function' ? module : module.default);
    },
    shard: async (tests: { path: string }[], shard: Shard, inner: Inner): Promise<unknown[]> => {
      const asked = { index: shard.shardIndex, count: shard.shardCount };
      const part = shardOf(tests.map((test) => projectPath(options.root, test.path)), asked, await (read ??= options.times()));
      if (!told) say(part.line);
      told = true;
      if (part.take !== undefined) return part.take.map((at) => tests[at]!);
      if (inner.shard === undefined) {
        throw new TypeError(`Shard ${shard.shardIndex}/${shard.shardCount} requested, but the test sequencer ${path ?? JEST_SEQUENCER} has no shard method.`);
      }
      return (await inner.shard(tests, shard)) as unknown[];
    },
  };
  (globalThis as { [HANDED]?: typeof handed })[HANDED] = handed;
  return { testSequencer: PLACING_SEQUENCER };
}
