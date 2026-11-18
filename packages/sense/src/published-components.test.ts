import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { publishedComponentSources } from './published-components.js';

it('reads duplicate declarations and identity within the configured directories, as the checkout is now and in CI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'published-components-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/one.ts'), 'export function Button() {}\n');
    await writeFile(join(root, 'src/two.ts'), 'export class Button {}\n');
    await writeFile(join(root, 'outside.ts'), 'export const Outside = 1;\n');
    const options = { ci: true, step: 'variance index', announce: () => {} };
    const before = await publishedComponentSources(root, [join(root, 'src')], options);
    expect(before).toMatchObject({ files: 2, source: { Button: [
      { file: 'src/one.ts', line: 1, via: 'function' },
      { file: 'src/two.ts', line: 1, via: 'class' },
    ] } });
    expect(before.source.Outside).toBeUndefined();
    expect(await publishedComponentSources(root, [join(root, 'absent')], options)).toMatchObject({ files: 0, source: {} });
    await writeFile(join(root, 'src/one.ts'), 'export function Changed() {}\n');
    const after = await publishedComponentSources(root, ['src'], options);
    expect(after.source.Changed).toEqual([{ file: 'src/one.ts', line: 1, via: 'function' }]);
    expect(after.digest).not.toBe(before.digest);
    await expect(publishedComponentSources(root, ['..'], options)).rejects.toThrow('outside the repository');
    await writeFile(join(root, 'src/one.stories.ts'), 'export function Changed() {}\n');
    expect(await publishedComponentSources(root, ['src'], options)).toEqual(after);
    expect((await publishedComponentSources(root, ['src'], { ...options, exclude: [] })).digest).not.toBe(after.digest);
    expect((await publishedComponentSources(root, ['src'], { ...options, exclude: ['two.'] })).source.Button).toBeUndefined();
    expect(await publishedComponentSources(root, ['src'], { ...options, index: join(root, 'elsewhere.bin') })).toEqual(after);
  } finally { await rm(root, { recursive: true, force: true }); }
});
