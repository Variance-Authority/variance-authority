import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { moduleId, type ExecutionJournal } from '@variance-authority/sense/journal';

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
