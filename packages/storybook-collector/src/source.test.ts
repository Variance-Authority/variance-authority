import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';

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
  it('reads the published component snapshot after source bytes change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'Button.tsx'), 'export function Button() { return null; }\n');
    await updateSourceIndex(root);
    await writeFile(join(root, 'src', 'Button.tsx'), 'export function Changed() { return null; }\n');
    expect(await scanSource(root, { dirs: ['src'] })).toEqual({
      Button: [{ file: 'src/Button.tsx', line: 1, via: 'function' }],
    });
  });

  it('indexes what the code declares and nothing a comment spells', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'Button.tsx'), '/*\nexport function Retired() { return null; }\n*/\nexport function Button() { return null; }\n');
    await writeFile(join(root, 'src', 'Button.test.tsx'), 'function Harness() { return null; }\n');

    await updateSourceIndex(root);
    expect(await scanSource(root, { dirs: ['src'] })).toEqual({
      Button: [{ file: join('src', 'Button.tsx'), line: 4, via: 'function' }],
    });
  });

  it('reads an absolute directory inside the repository, and names its files from the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'Button.tsx'), 'export function Button() { return null; }\n');

    await updateSourceIndex(root);
    expect(await scanSource(root, { dirs: [join(root, 'src')] })).toEqual({
      Button: [{ file: join('src', 'Button.tsx'), line: 1, via: 'function' }],
    });
  });

  it('refuses a dirs list that matches no source file, naming the requested directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    const outside = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root, outside);
    const elsewhere = join(outside, 'absent');

    await updateSourceIndex(root);
    await expect(scanSource(root, { dirs: ['missing'] })).rejects.toMatchObject({
      message: expect.stringContaining(`no published source files under ${join(root, 'missing')}`),
      varianceOperatorError: true,
    });
    await expect(scanSource(root, { dirs: [elsewhere] })).rejects.toMatchObject({
      message: expect.stringContaining('outside the repository'),
      varianceOperatorError: true,
    });
  });
});
