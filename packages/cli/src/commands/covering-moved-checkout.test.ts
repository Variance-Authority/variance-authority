import { existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheRootFor, pruneSelection, testCoverageFile } from '@variance-authority/sense/test-selection';
import { main } from '../bin.fixture.js';
import { recordFixture } from './covering-record.fixture.js';

// `ci-info` decides CI once, when it loads, so the module is cut: these questions are asked outside CI.
vi.mock('ci-info', () => ({ isCI: false }));

/**
 * A cache inside its checkout holds that checkout wherever both are moved to:
 * the recording is named from the cache, not from the root of the file system.
 */

const { checkout } = recordFixture();
const moved: string[] = [];
const RECORDED = { ran: { stands: [{ tests: ['src/pay.test.ts'] }] } };

/** What `covering --file src/pay.ts` answers on stdout in `root`: its one suite, or the refusal it printed instead. */
async function covering(root: string): Promise<unknown> {
  let out = '';
  await main(['covering', '--root', root, '--file', 'src/pay.ts', '--format', 'json'], { out: (text) => (out += text), err: () => {} });
  const said = JSON.parse(out) as { readonly suites?: readonly unknown[] };
  return said.suites?.[0] ?? said;
}

/** A recorded checkout that keeps the default cache, renamed with the cache inside it. */
async function movedCheckout(): Promise<string> {
  const { at } = await checkout();
  expect(await covering(at)).toMatchObject(RECORDED);
  const to = `${at}-moved`;
  moved.push(to);
  await rename(at, to);
  return to;
}

describe('a recorded checkout renamed with the default cache inside it', () => {
  // The fixture names a cache of its own; these checkouts keep the default one, inside them.
  beforeEach(() => void vi.stubEnv('VARIANCE_AUTHORITY_CACHE', ''));
  afterEach(() => void vi.unstubAllEnvs());
  afterAll(() => Promise.all(moved.map((dir) => rm(dir, { recursive: true, force: true }))));

  it('still names the recorded test file when `covering` is asked there', async () => {
    const to = await movedCheckout();

    expect(await covering(to)).toMatchObject(RECORDED);
  });

  it('keeps its recording through a prune', async () => {
    const to = await movedCheckout();
    const pruned = await pruneSelection(cacheRootFor(to));

    expect(pruned.removed.map((entry) => entry.reason)).toEqual([]);
    expect(existsSync(testCoverageFile(to, { suite: 'unit' }))).toBe(true);
    expect(await covering(to)).toMatchObject(RECORDED);
  });
});
