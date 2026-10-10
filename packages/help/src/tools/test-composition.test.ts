import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testCompositionTool } from './test-composition.js';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('docs_test_composition, before it reads a recording', () => {
  it('refuses a host that names no checkout', () => {
    expect(() => testCompositionTool.run(undefined, { file: 'a.test.ts' })).toThrow(/named no checkout/u);
  });

  it('refuses a call that names no test file', () => {
    expect(() => testCompositionTool.run(undefined, { file: '  ' }, { root: '/checkout' })).toThrow(/takes `--file`/u);
  });

  it('refuses a checkout with no recorded suite, naming the checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'test-composition-'));
    made.push(root);
    expect(() => testCompositionTool.run(undefined, { file: 'a.test.ts' }, { root })).toThrow(`the recording under ${root} holds no suite to read`);
  });
});
