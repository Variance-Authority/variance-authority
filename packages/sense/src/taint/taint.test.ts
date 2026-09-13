import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { movedBy, relationsOfFiles } from '@variance-authority/core/relate';
import { scanRelations } from '../scan.js';
import { taintFile, taintRecords, taintTable, type Taint } from './index.js';
import { isTestLike, mockTaint } from './mocks.js';

/**
 * A taint is a second table joined onto the scan's records, so what is tested
 * is the join: the records the scan produced stay as they were, and every
 * taint's diff lands on top by file path.
 */

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-taint-'));
  await write(root, 'src/api.ts', "export const api = 1;");
  await write(root, 'src/panel.ts', "export const panel = 1;");
  await write(root, 'src/theme.css', ".a{}");
  await write(root, 'src/card.ts', "import { api } from './api';\nexport const card = api;");
  await write(
    root,
    'src/card.test.ts',
    "import { vi } from 'vitest';\nimport { card } from './card';\nimport { api } from './api';\nvi.mock('./api');\nexport const t = [card, api];",
  );
  await write(
    root,
    'src/actual.test.ts',
    "import { vi } from 'vitest';\nimport { api } from './api';\nvi.mock('./api', async () => ({ ...(await vi.importActual('./api')) }));\nexport const t = api;",
  );
  await write(
    root,
    'src/card.stories.ts',
    "import { sb } from 'storybook/test';\nimport { card } from './card';\nimport { api } from './api';\nsb.mock(import('./api'));\nexport const t = [card, api];",
  );
  await write(
    root,
    'src/panel.jest.test.ts',
    "import { api } from './api';\njest.mock('./api');\njest.mock('./panel', () => ({}), { virtual: true });\nexport const t = api;",
  );
  await write(
    root,
    'src/original.test.ts',
    "import { vi } from 'vitest';\nimport { api } from './api';\nvi.mock('./api', async (importOriginal) => ({ ...(await importOriginal()) }));\nexport const t = api;",
  );
  await write(
    root,
    'src/named.test.ts',
    "import { vi } from 'vitest';\nimport { api } from './api';\nimport { factory } from './factory';\nvi.mock('./api', factory);\nexport const t = api;",
  );
  await write(root, 'src/factory.ts', "export const factory = () => ({});");
  await write(
    root,
    'src/late.test.ts',
    "import { vi } from 'vitest';\nimport { api } from './api';\nvi.doMock('./api');\nexport const t = api;",
  );
  await write(root, 'src/relay.ts', "declare const jsresource: (name: string) => unknown;\nexport const lazy = jsresource('./panel');");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const edgesOf = async (taints: readonly Taint[], file: string) => {
  const records = await scanRelations({ root, dirs: ['src'], digests: false, taints });
  return records.find((record) => record.file === file);
};

describe('a static taint table', () => {
  it('removes an edge the file wrote and adds one it did not', async () => {
    const taint = taintTable('hand', {
      'src/card.test.ts': { '-': ['./api'] },
      'src/relay.ts': { '+': ['./panel'] },
    });

    expect((await edgesOf([taint], 'src/card.test.ts'))?.edges?.map((edge) => edge.to)).toEqual(['src/card.ts']);
    expect((await edgesOf([taint], 'src/relay.ts'))?.edges).toEqual([{ to: 'src/panel.ts', kind: 'imports' }]);
  });

  it('adds an asset under the kind its target gives it', async () => {
    const taint = taintTable('hand', { 'src/relay.ts': { '+': ['./theme.css'] } });

    expect((await edgesOf([taint], 'src/relay.ts'))?.edges).toEqual([{ to: 'src/theme.css', kind: 'asset' }]);
  });

  it('leaves a record no taint names as the same object', async () => {
    const records = await scanRelations({ root, dirs: ['src'], digests: false });
    const tainted = await taintRecords(records, [taintTable('hand', { 'src/relay.ts': { '+': ['./panel'] } })], { root });

    expect(tainted.find((record) => record.file === 'src/api.ts')).toBe(records.find((record) => record.file === 'src/api.ts'));
    expect(tainted.map((record) => record.file)).toEqual(records.map((record) => record.file));
  });

  it('treats an added relative specifier that resolves to nothing as a hole', async () => {
    const taint = taintTable('hand', { 'src/relay.ts': { '+': ['./missing', 'not-installed'] } });
    const record = await edgesOf([taint], 'src/relay.ts');

    expect(record?.unresolved).toEqual(['./missing', 'not-installed']);
    expect(record?.unknown).toMatch(/1 tainted relative specifier\(s\) that resolve to nothing: \.\/missing/);
  });

  it('reads a table from a JSON file, named after the file', async () => {
    const path = join(root, 'taint.json');
    await writeFile(path, JSON.stringify({ 'src/card.test.ts': { '-': ['./api'] } }), 'utf8');
    const taint = await taintFile(path);

    expect(taint.name).toBe(path);
    expect((await edgesOf([taint], 'src/card.test.ts'))?.edges?.map((edge) => edge.to)).toEqual(['src/card.ts']);
  });

  it('refuses a file that is not a table', async () => {
    const path = join(root, 'list.json');
    await writeFile(path, '["src/a.ts"]', 'utf8');

    await expect(taintFile(path)).rejects.toThrow(/not a taint table/);
  });
});

describe('several taints at once', () => {
  it('unions the removals and the additions', async () => {
    const one = taintTable('one', { 'src/card.test.ts': { '-': ['./api'] } });
    const two = taintTable('two', { 'src/card.test.ts': { '-': ['./card'], '+': ['./panel'] } });

    expect((await edgesOf([one, two], 'src/card.test.ts'))?.edges?.map((edge) => edge.to)).toEqual(['src/panel.ts']);
  });

  it('keeps an edge one taint adds and another removes', async () => {
    const cut = taintTable('cut', { 'src/card.test.ts': { '-': ['./api'] } });
    const add = taintTable('add', { 'src/card.test.ts': { '+': ['./api'] } });

    expect((await edgesOf([cut, add], 'src/card.test.ts'))?.edges?.map((edge) => edge.to)).toEqual(['src/api.ts', 'src/card.ts']);
  });
});

describe('the mock taint', () => {
  it('subtracts a vitest, jest or storybook mock from the file that wrote it', async () => {
    const taints = [mockTaint()];

    expect((await edgesOf(taints, 'src/card.test.ts'))?.edges?.map((edge) => edge.to)).toEqual(['src/card.ts']);
    expect((await edgesOf(taints, 'src/card.stories.ts'))?.edges?.map((edge) => edge.to)).toEqual(['src/card.ts']);
    expect((await edgesOf(taints, 'src/panel.jest.test.ts'))?.edges).toBeUndefined();
  });

  it('keeps the edge when the factory reaches for the real module, or is written elsewhere', async () => {
    for (const file of ['src/actual.test.ts', 'src/original.test.ts', 'src/named.test.ts']) {
      expect((await edgesOf([mockTaint()], file))?.edges?.map((edge) => edge.to), file).toContain('src/api.ts');
    }
  });

  it('does not read a doMock: the static imports above it ran the real module', async () => {
    expect((await edgesOf([mockTaint()], 'src/late.test.ts'))?.edges?.map((edge) => edge.to)).toEqual(['src/api.ts']);
  });

  it('cuts the file\'s own edge and no further', async () => {
    // `card.test.ts` mocks `./api`, and still reaches `api.ts` through `card.ts`.
    const records = await scanRelations({ root, dirs: ['src'], digests: false, taints: [mockTaint()] });
    const moved = movedBy(relationsOfFiles(records), ['src/api.ts']);

    expect(moved.files).toContain('src/card.test.ts');
  });

  it('opens only files a mock is expected in, unless told otherwise', async () => {
    expect(['src/a.test.ts', 'src/a.spec.tsx', 'src/a.stories.ts', '.storybook/preview.ts', 'test/setup.ts'].every(isTestLike)).toBe(true);
    expect(isTestLike('src/card.ts')).toBe(false);

    const everywhere = mockTaint({ files: () => true });
    expect((await edgesOf([everywhere], 'src/card.test.ts'))?.edges?.map((edge) => edge.to)).toEqual(['src/card.ts']);
  });

  it('is a reader: it costs a read of the files it names and no parse of the others', async () => {
    const opened: string[] = [];
    const spy: Taint = {
      name: 'spy',
      files: (file) => file.endsWith('.test.ts'),
      read: (subject) => {
        opened.push(subject.file);
        return undefined;
      },
    };
    await scanRelations({ root, dirs: ['src'], digests: false, taints: [spy] });

    expect(opened).toEqual([
      'src/actual.test.ts',
      'src/card.test.ts',
      'src/late.test.ts',
      'src/named.test.ts',
      'src/original.test.ts',
      'src/panel.jest.test.ts',
    ]);
  });
});

async function write(root: string, path: string, contents: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${contents}\n`, 'utf8');
}
