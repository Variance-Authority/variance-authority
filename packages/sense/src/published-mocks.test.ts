import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { publishedMocks } from './published-mocks.js';
import { SourceIndexUnpublished, updateSourceIndex } from './published.js';

let root: string;
let indexRoot: string;
let index: string;
const policy = { ci: true, step: 'variance index', announce: () => {} };
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sense-published-mocks-'));
  indexRoot = await mkdtemp(join(tmpdir(), 'sense-published-mocks-index-'));
  index = join(indexRoot, 'index.bin');
  await writeFile(join(root, 'api.ts'), 'export const api = 1;');
  await writeFile(join(root, 'mocked.test.ts'), "import './api'; vi.mock('./api');");
  await writeFile(join(root, 'plain.test.ts'), "import './api';");
  await updateSourceIndex(root, { index });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(indexRoot, { recursive: true, force: true });
});

it('answers asked mock declarations from the published parses after source bytes disappear', async () => {
  await rm(join(root, 'mocked.test.ts'));
  expect(await publishedMocks(root, ['mocked.test.ts', 'plain.test.ts', 'missing.test.ts', 'mocked.test.ts'], { ...policy, index }))
    .toEqual([true, false, false, true]);
});

it('takes the newest record and parse after a mock is removed', async () => {
  await writeFile(join(root, 'mocked.test.ts'), "import './api';");
  await updateSourceIndex(root, { index });
  expect(await publishedMocks(root, ['mocked.test.ts'], { ...policy, index })).toEqual([false]);
});

it('refuses an unpublished index in CI before reading source', async () => {
  await expect(publishedMocks(root, ['plain.test.ts'], { ...policy, index: join(indexRoot, 'absent.bin') }))
    .rejects.toBeInstanceOf(SourceIndexUnpublished);
});
