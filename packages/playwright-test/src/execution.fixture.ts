import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { moduleId, type ExecutionJournal } from '@variance-authority/sense/journal';
import { varianceCompletedFixtures } from './completed.js';
import type { ExecutionRecorder } from './execution.js';

// What the execution recorder's tests drive it with: a page that hands over
// journals, and a checkout holding one real module.

export const INSTRUMENTATION = 'sense:instrument/presence-v6';

/** A page that hands over whatever the test says it entered, once per drain. */
export function pageReporting(...journals: readonly (ExecutionJournal | undefined)[]): Page {
  const queue = [...journals];
  return {
    evaluate: async () => queue.shift(),
  } as unknown as Page;
}

const SOURCE = ['export function price(amount) {', '  return amount * 2;', '}'].join('\n');

export async function inRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-playwright-execution-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** One real module on disk, so the ordinals its id names mean something. */
export async function instrumented(
  root: string,
): Promise<{ cacheRoot: string; id: string; ordinals: number[] }> {
  await writeFile(resolve(root, 'price.js'), SOURCE, 'utf8');
  return { cacheRoot: resolve(root, 'cache'), id: moduleId('price.js', SOURCE), ordinals: [0, 1] };
}

/**
 * End one test the way the runner ends it, through the fixture that is supposed
 * to be there for every spec.
 *
 * The bundle is asked for the fixture rather than the module, because what is
 * under test is the wiring: a suite gets whatever `varianceFixtures` carries,
 * and a marking function no fixture reaches marks nothing.
 */
export async function ended(
  recorder: ExecutionRecorder,
  root: string,
  owner: string,
  status: TestInfo['status'],
  duration?: number,
  timeout?: number,
  lane?: number,
): Promise<void> {
  const declared = varianceCompletedFixtures.varianceCompleted as unknown as readonly [
    (
      args: { varianceRecorder: ExecutionRecorder | undefined },
      use: () => Promise<void>,
      testInfo: TestInfo,
    ) => Promise<void>,
    { auto?: boolean },
  ];
  await declared[0]({ varianceRecorder: recorder }, async () => {}, {
    file: resolve(root, owner),
    status,
    project: { name: 'chromium' },
    titlePath: [owner, 'the one test'],
    testId: `${owner}-1`,
    ...(duration === undefined ? {} : { duration }),
    ...(timeout === undefined ? {} : { timeout }),
    ...(lane === undefined ? {} : { parallelIndex: lane }),
  } as unknown as TestInfo);
}
