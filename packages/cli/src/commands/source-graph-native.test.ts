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
  return { ...actual, publishedSources: vi.fn(actual.publishedSources), readPublishedSources: vi.fn(actual.readPublishedSources), openSourceIndex: vi.fn(actual.openSourceIndex), runGraphOf: vi.fn(actual.runGraphOf) };
});

it('answers selection from native graph state without decoding or rebuilding the whole source index in JavaScript', async () => {
  const root = await mkdtemp(join(tmpdir(), 'va-native-selection-'));
  await writeFile(join(root, 'value.ts'), 'export const value = 1;\n');
  await writeFile(join(root, 'live.test.ts'), "import { value } from './value';\nexport const result = value;\n");
  await writeFile(join(root, 'mocked.test.ts'), "import { vi } from 'vitest';\nimport { value } from './value';\nvi.mock('./value');\nexport const result = value;\n");
  await writeFile(join(root, 'types.test.ts'), "import type { value } from './value';\nexport type Result = typeof value;\n");
  await sense.updateSourceIndex(root);
  vi.mocked(sense.publishedSources).mockClear();
  vi.mocked(sense.readPublishedSources).mockClear();
  vi.mocked(sense.openSourceIndex).mockClear();
  vi.mocked(sense.runGraphOf).mockClear();

  const graph = await relationsFor(root, ['.']);
  const reached = affectedBy(graph, ['value.ts'], { through: RUNTIME_EDGES });

  expect(reached.files).toEqual(['live.test.ts', 'value.ts']);
  expect(reached.shadowed).toEqual(['mocked.test.ts']);
  expect(sense.publishedSources).not.toHaveBeenCalled();
  expect(sense.readPublishedSources).not.toHaveBeenCalled();
  expect(sense.openSourceIndex).not.toHaveBeenCalled();
  expect(sense.runGraphOf).not.toHaveBeenCalled();
});
