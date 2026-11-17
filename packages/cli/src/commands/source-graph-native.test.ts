import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sense from '@variance-authority/sense';
import { affectedBy, RUNTIME_EDGES } from '@variance-authority/core/relate';
import { expect, it, vi } from 'vitest';
import { relationsFor } from './source-graph.js';

vi.mock('ci-info', () => ({ isCI: true }));
vi.mock('@variance-authority/sense', async (original) => {
  const actual = await original<typeof import('@variance-authority/sense')>();
  return { ...actual, runGraphOf: vi.fn(actual.runGraphOf) };
});

it('answers selection from native graph state without decoding or rebuilding the whole source index in JavaScript', async () => {
  const root = await mkdtemp(join(tmpdir(), 'va-native-selection-'));
  await writeFile(join(root, 'value.ts'), 'export const value = 1;\n');
  await writeFile(join(root, 'live.test.ts'), "import { value } from './value';\nexport const result = value;\n");
  await writeFile(join(root, 'mocked.test.ts'), "import { vi } from 'vitest';\nimport { value } from './value';\nvi.mock('./value');\nexport const result = value;\n");
  await writeFile(join(root, 'types.test.ts'), "import type { value } from './value';\nexport type Result = typeof value;\n");
  await sense.updateSourceIndex(root);
  vi.mocked(sense.runGraphOf).mockClear();

  const graph = await relationsFor(root, ['.']);
  expect('native' in graph).toBe(true);
  expect('names' in graph).toBe(false);
  expect('depends' in graph).toBe(false);
  const reached = affectedBy(graph, ['value.ts'], { through: RUNTIME_EDGES });

  expect(reached.files).toEqual(['live.test.ts', 'value.ts']);
  expect(reached.shadowed).toEqual(['mocked.test.ts']);
  expect('publishedSources' in sense).toBe(false);
  expect('readPublishedSources' in sense).toBe(false);
  expect('openSourceIndex' in sense).toBe(false);
  expect(sense.runGraphOf).not.toHaveBeenCalled();
});
