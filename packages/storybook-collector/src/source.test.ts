import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('ci-info', () => ({ isCI: true }));
import { scanSource } from './source.js';

/**
 * Component to `file:line`, from the directories a project names: the names its
 * code declares, never the ones a comment or a test spells.
 */

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((at) => rm(at, { recursive: true, force: true })));
});

describe('scanSource', () => {
  it('reads the source as it is on disk, in CI and with no index published before it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'Button.tsx'), 'export function Button() { return null; }\n');
    expect(await scanSource(root, { dirs: ['src'] })).toEqual({
      Button: [{ file: 'src/Button.tsx', line: 1, via: 'function' }],
    });
    await writeFile(join(root, 'src', 'Button.tsx'), 'export function Changed() { return null; }\n');
    expect(await scanSource(root, { dirs: ['src'] })).toEqual({
      Changed: [{ file: 'src/Button.tsx', line: 1, via: 'function' }],
    });
  });

  it('skips stories, tests and build output, and reads the extensions and exclusions the scan names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root);
    await mkdir(join(root, 'src', 'dist'), { recursive: true });
    await writeFile(join(root, 'src', 'Button.tsx'), 'export function Button() { return null; }\n');
    await writeFile(join(root, 'src', 'Button.stories.tsx'), 'export function Button() { return null; }\n');
    await writeFile(join(root, 'src', 'Button.spec.tsx'), 'export function Button() { return null; }\n');
    await writeFile(join(root, 'src', 'dist', 'Button.js'), 'export function Button() { return null; }\n');
    await writeFile(join(root, 'src', 'Legacy.mjs'), 'export function Legacy() { return null; }\n');

    expect(await scanSource(root, { dirs: ['src'] })).toEqual({
      Button: [{ file: 'src/Button.tsx', line: 1, via: 'function' }],
    });
    expect(Object.keys(await scanSource(root, { dirs: ['src'], extensions: ['.mjs'], exclude: [] }))).toEqual(['Legacy']);
    await writeFile(join(root, 'src', 'Old.tsx'), 'export function Button() { return null; }\n');
    expect((await scanSource(root, { dirs: ['src'] })).Button).toHaveLength(2);
    expect((await scanSource(root, { dirs: ['src'], exclude: ['Old.'] })).Button).toHaveLength(1);
  });

  it('indexes what the code declares and nothing a comment spells', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'Button.tsx'), '/*\nexport function Retired() { return null; }\n*/\nexport function Button() { return null; }\n');
    await writeFile(join(root, 'src', 'Button.test.tsx'), 'function Harness() { return null; }\n');

    expect(await scanSource(root, { dirs: ['src'] })).toEqual({
      Button: [{ file: join('src', 'Button.tsx'), line: 4, via: 'function' }],
    });
  });

  it('reads an absolute directory inside the repository, and names its files from the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'Button.tsx'), 'export function Button() { return null; }\n');

    expect(await scanSource(root, { dirs: [join(root, 'src')] })).toEqual({
      Button: [{ file: join('src', 'Button.tsx'), line: 1, via: 'function' }],
    });
  });

  it('refuses a dirs list that matches no source file, naming the requested directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    const outside = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root, outside);
    const elsewhere = join(outside, 'absent');

    await expect(scanSource(root, { dirs: ['missing'] })).rejects.toMatchObject({
      message: expect.stringContaining(`no source files under ${join(root, 'missing')}`),
      varianceOperatorError: true,
    });
    await expect(scanSource(root, { dirs: [elsewhere] })).rejects.toMatchObject({
      message: expect.stringContaining('outside the repository'),
      varianceOperatorError: true,
    });
  });
});
