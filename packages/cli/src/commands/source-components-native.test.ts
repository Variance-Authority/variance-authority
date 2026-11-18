import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateSourceIndex } from '@variance-authority/sense';
import { expect, it, vi } from 'vitest';
import { sourceDeclarationsFor } from './source-graph.js';

vi.mock('ci-info', () => ({ isCI: true }));

it('attributes components from the published generation without rereading checkout source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'va-component-publication-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/Button.tsx'), 'export function Button() { return null; }\n');
    await updateSourceIndex(root);
    await writeFile(join(root, 'src/Button.tsx'), 'export function Changed() { return null; }\n');

    expect((await sourceDeclarationsFor(root, [join(root, 'src')])).source).toEqual({
      Button: [{ file: 'src/Button.tsx', line: 1, via: 'function' }],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
