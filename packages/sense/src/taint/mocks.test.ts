import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { affectedBy, relationsOfFiles } from '@variance-authority/core/relate';
import { readModule } from '../read.js';
import { scanRelations } from '../scan.js';
import { taintRecords, type Node } from './index.js';
import { mockDiff, mockTaint } from './mocks.js';


describe.each([
  { name: 'native', read: (source: string) => readModule('src/a.test.ts', source).mocks },
  { name: 'oracle', read: (source: string) => mockDiff(source, () => parseSync('src/a.test.ts', source).program as Node) },
])('$name mock import cancellation', ({ read }) => {
  it.each([
    { source: "import './api';", diff: undefined },
    { source: "jest.mock('./api');", diff: { minus: ['./api'] } },
    { source: "jest.mock('./api', () => jest.requireActual('./api'));", diff: undefined },
    { source: "import './api'; jest.mock('./api', () => jest.requireActual('./api'));", diff: undefined },
    { source: "jest.mock('./api', () => jest.requireActual('./panel'));", diff: { minus: ['./api'], plus: ['./panel'] } },
    { source: "vi.mock('./api', async () => await vi.importActual('./api'));", diff: undefined },
    { source: "vi.mock('./api', async (importOriginal) => await importOriginal());", diff: undefined },
    { source: "vi.mock('./api', async (original) => ({ ...(await original()) }));", diff: undefined },
    { source: "vi.mock('./api', async (load) => { const real = load; return real(); });", diff: undefined },
    { source: "vi.mock('./api', async (load) => wrap(load));", diff: undefined },
    { source: "vi.mock('./api', async (...given) => given[0]());", diff: undefined },
    { source: "vi.mock('./api', async (load = fallback) => load());", diff: undefined },
    { source: "vi.mock('./api', async function () { return arguments[0](); });", diff: undefined },
    { source: "vi.mock('./api', async (original) => ({ api: 1 }));", diff: { minus: ['./api'] } },
    { source: "vi.mock('./api', async ({ name }) => ({ name }));", diff: { minus: ['./api'] } },
    { source: "vi.mock('./api', async (load) => ({ load: other.load }));", diff: { minus: ['./api'] } },
    { source: "vi.mock('./api', async (load) => ({ load }));", diff: undefined },
    { source: "vi.mock('./api', async (...[load]) => load());", diff: undefined },
    { source: "vi.mock('./api', (load) => { class A { load = 1; load() {} } return {}; });", diff: { minus: ['./api'] } },
    { source: "vi.mock('./api', (load) => { load: for (;;) break load; return {}; });", diff: { minus: ['./api'] } },
    { source: "vi.mock('./api', (load) => { function f(load) {} const { load: x } = y; try {} catch (load) {} return {}; });", diff: { minus: ['./api'] } },
    { source: "vi.mock('./api', (meta) => ({ url: import.meta.url }));", diff: { minus: ['./api'] } },
    { source: "vi.mock('./api', (load) => { const [a = load] = []; return a; });", diff: undefined },
    { source: "vi.mock('./api', async function (this: unknown, load) { return load(); });", diff: undefined },
    { source: "vi.mock('./api', async (...[a, b = a()]) => ({}));", diff: undefined },
    { source: "vi.mock('./api', (load) => { @decorate(load) class Api {} return { Api }; });", diff: undefined },
    { source: "vi.mock('./api', (load) => { class Api { @decorate(load) run() {} } return { Api }; });", diff: undefined },
    { source: "vi.mock('./api', () => ({ importOriginal: 1 }));", diff: { minus: ['./api'] } },
    { source: "vi.mock('./api', () => ({ api: vi.fn() }));", diff: { minus: ['./api'] } },
    { source: "vi.mock('./api', factory);", diff: undefined },
    { source: "sb.mock(import('./api'), { spy: true });", diff: undefined },
    { source: "jest.mock('./api', () => require('./api'));", diff: undefined },
    { source: "jest.mock('./api', () => module.require('./api'));", diff: undefined },
    { source: "jest.mock('./api', () => require('./panel'));", diff: { minus: ['./api'], plus: ['./panel'] } },
    { source: "jest.mock('./api', () => module.require('./panel'));", diff: { minus: ['./api'], plus: ['./panel'] } },
    { source: "jest.mock('./api', () => ({}), { value: jest.requireActual('./api') });", diff: { plus: ['./api'] } },
    { source: "jest.requireActual('./api');", diff: { plus: ['./api'] } },
    { source: "jest.mock('./api'); beforeEach(() => jest.requireActual('./api'));", diff: { plus: ['./api'] } },
  ])('normalizes $source', ({ source, diff }) => {
    expect(read(source)).toEqual(diff);
  });
});


describe.each([
  { name: 'native', read: (source: string) => readModule('src/a.test.tsx', source).mocks },
  { name: 'oracle', read: (source: string) => mockDiff(source, () => parseSync('src/a.test.tsx', source).program as Node) },
])('$name mock factory in JSX', ({ read }) => {
  it.each([
    { source: "vi.mock('./api', (Load) => ({ View: () => <Load.Part /> }));", diff: undefined },
    { source: "vi.mock('./api', (load) => ({ View: () => <load.Part /> }));", diff: undefined },
    { source: "vi.mock('./api', (load) => ({ View: () => <load load={1} /> }));", diff: { minus: ['./api'] } },
  ])('normalizes $source', ({ source, diff }) => {
    expect(read(source)).toEqual(diff);
  });
});


describe('a forwarding setup does not import the module it can forward', () => {
  it.each(['jest.requireActual', 'require', 'module.require'])('%s preserves only an existing import', async (loader) => {
    const root = await mkdtemp(join(tmpdir(), 'variance-mock-cancellation-'));
    try {
      const setup = `jest.mock('./api', () => ${loader}('./api'));`;
      await Promise.all([
        writeFile(join(root, 'api.ts'), 'export const api = 1;'),
        writeFile(join(root, 'panel.ts'), 'export const panel = 1;'),
        writeFile(join(root, 'setup.ts'), setup),
        writeFile(join(root, 'unused.test.ts'), "import './setup';"),
        writeFile(join(root, 'used.test.ts'), "import './setup'; import './api';"),
        writeFile(join(root, 'swap.test.ts'), `import './api'; jest.mock('./api', () => ${loader}('./panel'));`),
      ]);
      expect(readModule('setup.ts', setup).requests).toEqual([]);
      const scanned = await scanRelations({ root, dirs: ['.'], digests: false });
      const tainted = await taintRecords(scanned, [mockTaint()], { root });
      expect(tainted.additions.has('setup.ts')).toBe(false);
      const relations = relationsOfFiles(tainted.records, { shadows: tainted.shadows });
      const moved = affectedBy(relations, ['api.ts']).files;
      expect(moved).toContain('used.test.ts');
      expect(moved).not.toContain('unused.test.ts');
      expect(moved).not.toContain('swap.test.ts');
      expect(affectedBy(relations, ['panel.ts']).files).toContain('swap.test.ts');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});


it.each(['require', 'module.require'])('keeps %s requests outside same-target forwarding', (loader) => {
  const same = `jest.mock('./api', () => ${loader}('./api'));`;
  expect(readModule('common/mocks.js', same).requests).toEqual([]);
  expect(readModule('common/mocks.js', `import './api'; ${same}`).requests.map((request) => request.value)).toEqual(['./api']);
  expect(readModule('common/mocks.js', `jest.mock('./api', () => ${loader}('./panel'));`).requests.map((request) => request.value)).toEqual(['./panel']);
  expect(readModule('common/mocks.js', `${loader}('./api'); ${same}`).requests.map((request) => request.value)).toEqual(['./api']);
});
