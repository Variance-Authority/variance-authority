import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { native } from '../addon.js';
import { checksOf, type RanCase } from './case-checks.js';

vi.mock('../addon.js', async (actual) => {
  const loaded = await actual<typeof import('../addon.js')>();
  return { ...loaded, native: vi.fn(loaded.native) };
});

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
    await writeFile(join(root, 'b.test.ts'), `${SOURCE}it('saves', () => {\n  checked('stored', () => 1);\n});\n`);
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
    ['a case whose runner reported no attempt and that entered none of its checks', undefined],
  ])('marks the file incomplete for %s', (_, attempts) => {
    expect(checksOf(root, [ran(attempts)])?.incomplete).toEqual(['a.test.ts']);
  });

  it('marks the file incomplete for an attempt cut short in a case that declares no check', () => {
    expect(checksOf(root, [
      ran([{ attempt: 1, ended: 'passed' }]),
      { ...ran([{ attempt: 1, ended: 'interrupted' }]), name: 'drafts' },
    ])?.incomplete).toEqual(['a.test.ts']);
  });

  it('orders the cases by file, then by the line their body is registered at', () => {
    const passed = ran([{ attempt: 1, ended: 'passed' }]);
    const cases = checksOf(root, [
      { ...passed, file: 'b.test.ts', name: 'saves' },
      { ...passed, file: 'b.test.ts' },
      passed,
    ])?.cases;
    expect(cases?.map(({ file, line, name }) => [file, line, name])).toEqual([
      ['a.test.ts', 2, 'sends'],
      ['b.test.ts', 2, 'sends'],
      ['b.test.ts', 6, 'saves'],
    ]);
  });

  it('keeps no section where the addon is not loaded, rather than one that declares nothing', () => {
    vi.mocked(native).mockReturnValueOnce(undefined);
    expect(checksOf(root, [ran([{ attempt: 1, ended: 'passed' }])])).toBeUndefined();
  });

  it('keeps no section when no case declares a check', () => {
    expect(checksOf(root, [{ ...ran([{ attempt: 1, ended: 'passed' }]), name: 'drafts' }])).toBeUndefined();
  });
});
