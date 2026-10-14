import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanSource } from './source.js';

/**
 * Component to `file:line`, from the directories a project names: the names its
 * code declares at the top level of a module, never the ones a comment, a
 * template or a function body spells.
 */

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((at) => rm(at, { recursive: true, force: true })));
});

describe('scanSource', () => {
  it('indexes what the code declares and nothing a comment, a template or a function body spells', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-source-'));
    made.push(root);
    await mkdir(join(root, 'src'));
    await writeFile(
      join(root, 'src', 'Button.tsx'),
      [
        '/*',
        'export function Retired() { return null; }',
        '*/',
        'export function Button() { return null; }',
        'export const page = `',
        'export function Generated() { return null; }',
        '`;',
        'export function Shell() {',
        '  function Inner() { return null; }',
        '  return Inner;',
        '}',
      ].join('\n'),
    );
    await writeFile(join(root, 'src', 'Button.test.tsx'), 'function Harness() { return null; }\n');

    expect(scanSource(root, { dirs: ['src'] })).toEqual({
      Button: [{ file: join('src', 'Button.tsx'), line: 4, via: 'function' }],
      Shell: [{ file: join('src', 'Button.tsx'), line: 8, via: 'function' }],
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
    made.push(root);
    const elsewhere = join(tmpdir(), 'variance-source-absent');

    expect(() => scanSource(root, { dirs: ['missing', elsewhere] })).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(`no source files under ${join(root, 'missing')}, ${elsewhere} matching`),
        varianceOperatorError: true,
      }),
    );
  });
});
