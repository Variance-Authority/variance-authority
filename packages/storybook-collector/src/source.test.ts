import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
  it('indexes what the code declares and nothing a comment spells', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'Button.tsx'), '/*\nexport function Retired() { return null; }\n*/\nexport function Button() { return null; }\n');
    await writeFile(join(root, 'src', 'Button.test.tsx'), 'function Harness() { return null; }\n');

    expect(scanSource(root, { dirs: ['src'] })).toEqual({
      Button: [{ file: join('src', 'Button.tsx'), line: 4, via: 'function' }],
    });
  });

  it('walks an absolute directory where it is, and names its files from the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'Button.tsx'), 'export function Button() { return null; }\n');

    expect(scanSource(root, { dirs: [join(root, 'src')] })).toEqual({
      Button: [{ file: join('src', 'Button.tsx'), line: 1, via: 'function' }],
    });
  });

  it('refuses a dirs list that matches no source file, naming the directories it walked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    const outside = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root, outside);
    const elsewhere = join(outside, 'absent');

    expect(() => scanSource(root, { dirs: ['missing', elsewhere] })).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(`no source files under ${join(root, 'missing')}, ${elsewhere} matching`),
        varianceOperatorError: true,
      }),
    );
  });
});
