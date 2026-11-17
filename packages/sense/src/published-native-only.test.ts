import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';

const { update } = vi.hoisted(() => ({ update: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./native-update.js', () => ({ updateNatively: update }));
import { updateSourceIndex } from './published.js';

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue(undefined);
});

it('surfaces a native indexing refusal without constructing an index in JavaScript', async () => {
  await expect(updateSourceIndex('/native-only-fixture', { index: '/native-only-fixture/index.bin' }))
    .rejects.toThrow('native source indexing');
  expect(update).toHaveBeenCalledOnce();
});

it.each([
  { prepareMap: true, exists: false, prepared: true },
  { prepareMap: true, exists: true, prepared: false },
  { prepareMap: false, exists: false, prepared: false },
  { prepareMap: undefined, exists: false, prepared: false },
])('prepares map metadata=$prepared when requested=$prepareMap and an index exists=$exists', async ({ prepareMap, exists, prepared }) => {
  const root = mkdtempSync(join(tmpdir(), 'sense-prepare-map-'));
  const index = join(root, 'index.bin');
  if (exists) writeFileSync(index, 'the existing publication');
  update.mockResolvedValue({ was: exists ? 'damaged' : 'missing', files: 1, reread: 1, parsed: 1 });

  await updateSourceIndex(root, { index, ...(prepareMap === undefined ? {} : { prepareMap }) });

  expect(update).toHaveBeenCalledOnce();
  expect(update.mock.calls[0]?.[7]).toBe(prepared);
});

it('publishes no whole-index JavaScript scanner or cache API', async () => {
  const sense = await import('./index.js');
  for (const name of ['scanRelations', 'openSourceIndex', 'readSourceRecords', 'publishedSources', 'readPublishedSources', 'openParseCache', 'openRecordCache', 'memoryRecordCache']) {
    expect(sense).not.toHaveProperty(name);
  }
});
