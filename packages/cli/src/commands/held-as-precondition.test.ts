import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeTestCoverage } from '@variance-authority/sense/test-selection';
import { heldAsPrecondition } from './held-as-precondition.js';

const CART = 'test/cart.test.ts';
const PAGE = 'test/page.test.ts';

/**
 * Every test file holds its own path, as a recording writes it. `page` loaded
 * `cart` too, and both loaded `src/env.ts` without instrumenting it.
 */
async function record(): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'variance-held-')), 'coverage.bin');
  await writeTestCoverage(file, {
    version: 3,
    instrumentation: 'fixture',
    tests: [
      { file: CART, complete: true, preconditions: [{ name: CART, digest: 'source:cart' }, { name: 'src/env.ts', digest: 'source:env' }] },
      { file: PAGE, complete: true, preconditions: [{ name: PAGE, digest: 'source:page' }, { name: CART, digest: 'source:cart' }, { name: 'src/env.ts', digest: 'source:env' }] },
    ],
    modules: [],
  });
  return file;
}

describe('heldAsPrecondition', () => {
  it('names the other test files that hold a test file, never the test file itself', async () => {
    const held = heldAsPrecondition(await record(), [CART, PAGE, 'src/env.ts']);

    expect(held?.tests).toBe(2);
    expect(held?.of.get(CART)).toEqual([PAGE]);
    expect(held?.of.has(PAGE)).toBe(false);
    expect(held?.of.get('src/env.ts')).toEqual([CART, PAGE]);
  });
});
