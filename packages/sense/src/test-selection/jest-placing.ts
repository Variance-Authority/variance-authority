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
  const spelled = typeof config.testSequencer === 'string' ? config.testSequencer : '@jest/test-sequencer';
  const path = spelled.startsWith('<rootDir>') ? resolve(options.rootDir, spelled.replace(/^<rootDir>\/?/, '')) : spelled;
  let own: SequencerClass | undefined;
  let read: Promise<SuiteTimes> | undefined;
  let told = false;
  const handed = {
    own: (): SequencerClass => {
      const module = from(from.resolve(path, { paths: [options.rootDir] })) as SequencerClass | { default: SequencerClass };
      return (own ??= typeof module === 'function' ? module : module.default);
    },
    shard: async (tests: { path: string }[], shard: Shard, inner: Inner): Promise<unknown[]> => {
      const asked = { index: shard.shardIndex, count: shard.shardCount };
      const part = shardOf(tests.map((test) => projectPath(options.root, test.path)), asked, await (read ??= options.times()));
      if (!told) say(part.line);
      told = true;
      if (part.take !== undefined) return part.take.map((at) => tests[at]!);
      if (inner.shard === undefined) {
        throw new TypeError(`Shard ${shard.shardIndex}/${shard.shardCount} requested, but the test sequencer ${path} has no shard method.`);
      }
      return (await inner.shard(tests, shard)) as unknown[];
    },
  };
  (globalThis as { [HANDED]?: typeof handed })[HANDED] = handed;
  return { testSequencer: PLACING_SEQUENCER };
}
