/**
 * A page, as a browser driver meets one: a module with a decision in it, the
 * transform under test, and a realm to run the result in.
 *
 * The realm is the load-bearing part. A page arrives with no collector and the
 * one the build hoists keeps whatever identity it finds
 * ({@link executionCollectorSource}), so under an instrumented suite the runner
 * has already installed a collector of its own and the fixture would defer to
 * it — handing the page's crossings to whichever run is watching the test file.
 * The page therefore holds the global only while page code runs, and everything
 * between belongs to the runner.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  EXECUTION_GLOBAL,
  executionCollectorSource,
  type ExecutionCollector,
  type InstrumentMode,
} from '../journal.js';

/** A module with one decision in it, and no export, so a test can evaluate it. */
export const SOURCE = [
  'function price(amount) {',
  '  if (amount > 10) {',
  '    return amount * 2;',
  '  }',
  '  return amount;',
  '}',
  'globalThis.__browser_test_price = price;',
].join('\n');

export const PREMIUM_LINE = 3;
export const PLAIN_LINE = 5;

/**
 * The same decision, and a helper the top level calls once while the module
 * evaluates: a region no subject enters on its own, and every subject depends
 * on.
 */
export const INITIALIZING = [
  'function label(amount) {',
  '  if (amount > 10) {',
  '    return "premium";',
  '  }',
  '  return "plain";',
  '}',
  'const DEFAULT = label(1);',
  ...SOURCE.split('\n'),
].join('\n');

export const LABEL_PREMIUM_LINE = 3;
export const LABEL_PLAIN_LINE = 5;
export const LATER_PLAIN_LINE = 7 + PLAIN_LINE;

export interface Realm {
  readonly price: (amount: number) => number;
  readonly collector: ExecutionCollector;
}

/**
 * Run the transformed module the way a page would: collector first, then the
 * module body, with the hoisted import spent by hand because a `new Function`
 * has no module loader to spend it.
 *
 * A page arrives with no collector, and the one the build hoists keeps whatever
 * identity it finds ({@link executionCollectorSource}) so that a second script
 * cannot displace the first. This file borrows the runner's `globalThis` to play
 * that page, and under an instrumented suite the runner has already installed a
 * collector of its own — so the fixture would defer to it and hand `price.js`
 * to whichever run is watching this test file. The page therefore holds the
 * global only while page code is running: the module body, and each call into
 * it. Everything between belongs to the runner, and reports to the runner.
 */
export function evaluate(transformed: string, mode?: InstrumentMode): Realm {
  const global = globalThis as unknown as Record<string, unknown>;
  const runner = Object.getOwnPropertyDescriptor(globalThis, '__VA__');
  const asRunner = (): void => {
    if (runner === undefined) delete global['__VA__'];
    else Object.defineProperty(globalThis, '__VA__', runner);
  };

  delete global['__VA__'];
  let page: PropertyDescriptor;
  try {
    new Function(executionCollectorSource(mode))();
    page = Object.getOwnPropertyDescriptor(globalThis, '__VA__')!;
    new Function(transformed.replace(/^import "[^"]+";/, ''))();
  } finally {
    asRunner();
  }

  const price = global['__browser_test_price'] as (amount: number) => number;
  return {
    price: (amount) => {
      Object.defineProperty(globalThis, '__VA__', page);
      try {
        return price(amount);
      } finally {
        asRunner();
      }
    },
    collector: global[EXECUTION_GLOBAL] as ExecutionCollector,
  };
}

/**
 * Registered by every file that evaluates a page: the module writes its export
 * onto `globalThis`, and a second file's page would otherwise find the first's.
 */
export function forgetThePage(): void {
  const global = globalThis as unknown as Record<string, unknown>;
  delete global['__browser_test_price'];
  delete global[EXECUTION_GLOBAL];
}

export async function inRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-browser-selection-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function diffAt(file: string, line: number): string {
  return `--- a/${file}\n+++ b/${file}\n@@ -${line},1 +${line},1 @@\n`;
}

/** Turn a scratch directory into a checkout with one commit, and name it. */
export async function checkout(root: string): Promise<string> {
  const git = async (...args: string[]): Promise<string> =>
    (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
  await git('init', '--quiet');
  await git('config', 'user.email', 'fixture@example.invalid');
  await git('config', 'user.name', 'Fixture');
  await git('add', '--all');
  await git('commit', '--quiet', '--message', 'the state this index stands at');
  return git('rev-parse', 'HEAD');
}
