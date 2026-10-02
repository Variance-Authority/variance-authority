import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encodeExecutionIndex,
  testCoverageFile,
  withCaseSections,
  writeTestCoverage,
} from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { distillFiles, formatDistill } from './distill.js';

const CASE = 'test/cart.spec.ts > adds one item';

/** What a click on the cart's button leaves in a journal, addressed to `file`. */
function clicked(file: string) {
  return {
    complete: true,
    attention: [{
      kind: 'document-event', event: 'click', trusted: true, sequence: 0,
      target: { nodeName: 'button', provenance: { status: 'resolved', provenance: {
        owners: [{ name: 'Cart', propsDigest: 'cart' }],
        source: { file, line: 3, column: 1 },
      } } },
    }],
  };
}

/** The checkout's own record: one case, its crossings, and, when given, its journals. */
async function recorded(root: string, journals?: readonly unknown[]): Promise<string> {
  const at = testCoverageFile(root);
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [{ file: 'test/cart.spec.ts', complete: true, preconditions: [] }],
    modules: [],
  });
  const block = { kind: 'function' as const, name: 'Cart', path: 'entry', startLine: 1, endLine: 9, source: true };
  writeFileSync(at, withCaseSections(readFileSync(at), {
    index: encodeExecutionIndex({
      tests: [{ id: CASE, file: 'test/cart.spec.ts', name: 'adds one item' }],
      modules: [
        { file: 'src/cart.tsx', blocks: [{ ...block, crossings: [{ test: 0, distance: 1 }] }] },
        { file: 'src/price.ts', blocks: [{ ...block, name: 'price', crossings: [{ test: 0, distance: 2 }] }] },
      ],
    }),
    ...(journals === undefined ? {} : {
      eyes: Buffer.from(`${JSON.stringify({ version: 1, watched: [CASE], journals })}\n`),
    }),
  }));
  return at;
}

async function checkout(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'variance-distill-'));
}

describe('the CLI distillation boundary', () => {
  it('reads the checkout\'s own record, every attempt of the case named', async () => {
    const root = await checkout();
    try {
      await recorded(root, [
        { case: CASE, attempt: 1, journal: clicked('src/cart.tsx') },
        { case: CASE, attempt: 2, journal: clicked('src/cart.tsx') },
      ]);

      const result = await distillFiles({ test: CASE, root });

      expect(result.attempts?.map((attempt) => attempt.attempt)).toEqual([1, 2]);
      // The record's paths are relative to the checkout on both sides, and join.
      expect(result.execution.opportunities).toEqual([{ file: 'src/price.ts', distance: 2 }]);
      const text = formatDistill(result, 'text');
      expect(text).toContain('Eyes journal, attempt 1: complete.');
      expect(text).toContain('Eyes journal, attempt 2: complete.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reads a record that kept no journals as one without Eyes', async () => {
    const root = await checkout();
    try {
      await recorded(root);
      const result = await distillFiles({ test: CASE, root });
      expect(result.attempts).toBeUndefined();
      expect(formatDistill(result, 'text')).toContain('the record keeps no Eyes journals');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses an id the record does not hold', async () => {
    const root = await checkout();
    try {
      await recorded(root, [{ case: CASE, attempt: 1, journal: clicked('src/cart.tsx') }]);
      await expect(distillFiles({ test: 'adds one item', root }))
        .rejects.toThrow('The record holds no case with id adds one item.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('says where it looked when the checkout has no record', async () => {
    const root = await checkout();
    try {
      await expect(distillFiles({ test: CASE, root }))
        .rejects.toThrow(`nothing is recorded at ${testCoverageFile(root)}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reads a case index named with --execution, which carries no journals', async () => {
    const root = await checkout();
    try {
      const execution = join(root, 'execution.json');
      await writeFile(execution, JSON.stringify({
        tests: [{ id: 'plain', file: 'plain.test.ts', name: 'works' }],
        modules: [{ file: 'plain.ts', blocks: [{
          kind: 'function', name: 'work', path: 'entry', startLine: 1, endLine: 2,
          source: true, crossings: [{ test: 0, distance: 1 }],
        }] }],
      }));

      const result = await distillFiles({ test: 'plain', execution, root });

      expect(result.execution.entered).toEqual([{ file: 'plain.ts', distance: 1 }]);
      expect(result.execution.opportunities).toBeUndefined();
      expect(formatDistill(result, 'json')).toContain('"entered"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
