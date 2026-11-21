import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checksOf, type RanCase } from './case-checks.js';

const SOURCE = `import { checked } from '@variance-authority/sense/checked';
it('sends', () => {
  checked('title', () => 1);
});
it('drafts', () => {});
`;

describe('checksOf', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-authority-case-checks-'));
    await writeFile(join(root, 'a.test.ts'), SOURCE);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const ran = (attempts: RanCase['attempts'], entered: RanCase['entered'] = []): RanCase =>
    ({ file: 'a.test.ts', name: 'sends', attempts, entered });

  it('keeps the declared checks beside what each attempt entered, and leaves out a case that declares none', () => {
    expect(checksOf(root, [
      ran([{ attempt: 1, ended: 'passed' }], [{ attempt: 1, check: 'title' }, { attempt: 1, check: 'undeclared' }]),
      { ...ran([{ attempt: 1, ended: 'passed' }]), name: 'drafts' },
    ])).toEqual({
      incomplete: [],
      cases: [{
        file: 'a.test.ts',
        line: 2,
        name: 'sends',
        declared: [{ id: 'title', line: 3 }],
        attempts: [{ attempt: 1, ended: 'passed', entered: ['title'] }],
      }],
    });
  });

  it('keeps a file whose case failed and then passed a retry complete', () => {
    expect(checksOf(root, [ran([{ attempt: 1, ended: 'failed' }, { attempt: 2, ended: 'passed' }])])?.incomplete).toEqual([]);
  });

  it.each([
    ['an attempt the runner did not end', [{ attempt: 1 }]],
    ['an attempt it interrupted', [{ attempt: 1, ended: 'interrupted' }]],
    ['an attempt before the last it did not report', [{ attempt: 2, ended: 'passed' }]],
  ])('marks the file incomplete for %s', (_, attempts) => {
    expect(checksOf(root, [ran(attempts)])?.incomplete).toEqual(['a.test.ts']);
  });

  it('keeps no section when no case declares a check', () => {
    expect(checksOf(root, [{ ...ran([{ attempt: 1, ended: 'passed' }]), name: 'drafts' }])).toBeUndefined();
  });
});
