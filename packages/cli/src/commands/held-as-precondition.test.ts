import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { writeTestCoverage } from '@variance-authority/sense/test-selection';
import { heldAsPrecondition } from './held-as-precondition.js';

const CART = 'test/cart.test.ts';
const PAGE = 'test/page.test.ts';
const ENV = 'export const env = process.env;\n';

/**
 * Every test file holds its own path, as a recording writes it. `page` loaded
 * `cart` too, and both loaded {@link ENV} as `src/env.ts` without instrumenting it.
 */
async function record(): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'variance-held-')), 'coverage.bin');
  await writeTestCoverage(file, {
    version: 3,
    instrumentation: 'fixture',
    tests: [
      { file: CART, complete: true, preconditions: [{ name: CART, digest: 'source:cart' }, { name: 'src/env.ts', digest: digestString(ENV) }] },
      { file: PAGE, complete: true, preconditions: [{ name: PAGE, digest: 'source:page' }, { name: CART, digest: 'source:cart' }, { name: 'src/env.ts', digest: digestString(ENV) }] },
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

  it('names, of a held text, each test file holding the file that ran another text of it', async () => {
    const at = await record();
    const held = (text: string) => heldAsPrecondition(at, ['src/env.ts'], new Map([['src/env.ts', text]]))?.ranOther;

    expect(held(ENV)).toEqual(new Map());
    expect(held(`// read once\n${ENV}`)).toEqual(new Map([['src/env.ts', [CART, PAGE]]]));
    expect(heldAsPrecondition(at, ['src/env.ts'])?.ranOther).toEqual(new Map());
  });

  it('never names a test file as having run another text of itself', async () => {
    const held = heldAsPrecondition(await record(), [CART], new Map([[CART, '// edited\n']]))?.ranOther;

    expect(held).toEqual(new Map([[CART, [PAGE]]]));
  });
});
