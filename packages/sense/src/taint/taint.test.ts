import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { idOf, affectedBy, relationsOfFiles, type FileRecord } from '@variance-authority/core/relate';
import { memoryParseCache } from '../cache.js';
import { scanRelations } from '../scan.js';
import { moduleCallsTaint } from './calls.js';
import { taintFile, taintRecords, taintTable, type Taint, type Tainted } from './index.js';
import { isTestLike, mockTaint } from './mocks.js';

/**
 * A taint is a second table joined onto the scan's records, so what is tested
 * is the join: the records the scan produced stay as they were, an addition
 * lands on the file's record, and a removal lands in the shadows table that
 * `affectedBy` consults.
 */

let root: string;
let records: readonly FileRecord[];

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
  await write(
    root,
    'src/loaders.ts',
    [
      "declare const JSResourceForUserVisible: <T>(path: string | (() => Promise<T>)) => unknown;",
      "declare const importCond: (gate: string, yes: string, no: string) => unknown;",
      "declare const name: string;",
      "JSResourceForUserVisible<unknown>('./panel');",
      "JSResourceForUserVisible(() => import('./card'));",
      "importCond('gate', './api', `./panel`);",
      "importCond('computed', './api', `./${name}`);",
    ].join('\n'),
  );
  // Outside `src`, so the scan never walks to it and only a taint can name it.
  await write(root, 'outside/tool.ts', "import { api } from '../src/api';\nexport const tool = api;");
  records = await scanRelations({ root, dirs: ['src'], digests: false });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const under = (taints: readonly Taint[]): Promise<Tainted> => taintRecords(records, taints, { root });

const edgesOf = async (taints: readonly Taint[], file: string) =>
  (await under(taints)).records.find((record) => record.file === file);

const targets = (record: FileRecord | undefined) => record?.edges?.map((edge) => edge.to);

/** The files a change to `changed` moves, seen through the taints. */
const affectedUnder = async (taints: readonly Taint[], changed: readonly string[]) => {
  const tainted = await under(taints);
  return affectedBy(relationsOfFiles(tainted.records, { shadows: tainted.shadows }), changed);
};

describe('a static taint table', () => {
  it('shadows what the file wrote off and adds what it did not write', async () => {
    const taint = taintTable('hand', {
      'src/card.test.ts': { '-': ['./api'] },
      'src/relay.ts': { '+': ['./panel'] },
    });
    const tainted = await under([taint]);

    expect(targets(tainted.records.find((record) => record.file === 'src/card.test.ts'))).toEqual(['src/api.ts', 'src/card.ts']);
    expect(tainted.shadows).toEqual(new Map([['src/card.test.ts', ['src/api.ts']]]));
    expect(tainted.records.find((record) => record.file === 'src/relay.ts')?.edges).toEqual([{ to: 'src/panel.ts', kind: 'imports' }]);
    expect(tainted.additions).toEqual(new Map([['src/relay.ts', ['src/panel.ts']]]));
  });

  it('adds an asset under the kind its target gives it', async () => {
    const taint = taintTable('hand', { 'src/relay.ts': { '+': ['./theme.css'] } });

    expect((await edgesOf([taint], 'src/relay.ts'))?.edges).toEqual([{ to: 'src/theme.css', kind: 'asset' }]);
  });

  it('leaves a record no taint adds to as the same object', async () => {
    const tainted = await under([taintTable('hand', { 'src/relay.ts': { '+': ['./panel'] }, 'src/card.test.ts': { '-': ['./api'] } })]);

    for (const file of ['src/api.ts', 'src/card.test.ts']) {
      expect(tainted.records.find((record) => record.file === file), file).toBe(records.find((record) => record.file === file));
    }
    expect(tainted.records.map((record) => record.file)).toEqual(records.map((record) => record.file));
  });

  it('treats an added relative specifier that resolves to nothing as a hole', async () => {
    const taint = taintTable('hand', { 'src/relay.ts': { '+': ['./missing', 'not-installed'] } });
    const record = await edgesOf([taint], 'src/relay.ts');

    expect(record?.unresolved).toEqual(['./missing', 'not-installed']);
    expect(record?.unknown).toMatch(/1 tainted relative specifier\(s\) that resolve to nothing: \.\/missing/);
  });

  it('shadows nothing for a removal that resolves to nothing', async () => {
    const tainted = await under([taintTable('hand', { 'src/relay.ts': { '-': ['./missing'] } })]);

    expect(tainted.shadows.size).toBe(0);
  });

  it('reads a table from a JSON file, named after the file', async () => {
    const path = join(root, 'taint.json');
    await writeFile(path, JSON.stringify({ 'src/card.test.ts': { '-': ['./api'] } }), 'utf8');
    const taint = await taintFile(path);

    expect(taint.name).toBe(path);
    expect((await under([taint])).shadows.get('src/card.test.ts')).toEqual(['src/api.ts']);
  });

  it('refuses a file that is not a table', async () => {
    const path = join(root, 'list.json');
    await writeFile(path, '["src/a.ts"]', 'utf8');

    await expect(taintFile(path)).rejects.toThrow(/not a taint table/);
  });
});

describe('configured module calls', () => {
  const configured = (files: readonly string[]) =>
    moduleCallsTaint({
      name: 'framework-loaders-v1',
      files: new Set(files),
      calls: { JSResourceForUserVisible: 0, importCond: [1, 2] },
    });

  it('adds literal module arguments and leaves native import expressions alone', async () => {
    const record = await edgesOf([configured(['src/loaders.ts'])], 'src/loaders.ts');
    expect(targets(record)).toEqual(['src/api.ts', 'src/card.ts', 'src/panel.ts']);
  });

  it('opens no file outside the caller-supplied candidate set', async () => {
    const record = await edgesOf([configured([])], 'src/loaders.ts');
    expect(targets(record)).toEqual(['src/card.ts']);
  });

  it('ignores a computed template rather than inventing a path', async () => {
    const tainted = await under([configured(['src/loaders.ts'])]);
    expect(tainted.records.find((record) => record.file === 'src/loaders.ts')?.unresolved).toBeUndefined();
  });
});

describe('an addition the scan never walked to', () => {
  const outside = () => under([taintTable('hand', { 'src/relay.ts': { '+': ['../outside/tool'] } })]);

  it('brings the file in as unknown rather than as a node with no edges', async () => {
    const tainted = await outside();

    expect(records.some((record) => record.file === 'outside/tool.ts')).toBe(false);
    const brought = tainted.records.find((record) => record.file === 'outside/tool.ts');
    expect(brought?.edges).toBeUndefined();
    expect(brought?.unknown).toMatch(/outside the scanned directories/);
  });

  it('records that file unknown on the graph, so a report can name it', async () => {
    const tainted = await outside();
    const relations = relationsOfFiles(tainted.records, { shadows: tainted.shadows });
    const id = idOf(relations, 'file', 'outside/tool.ts');

    expect(id).toBeDefined();
    expect(relations.unknown[id!]).toBe(1);
  });

  it('says nothing extra about a file the scan already read', async () => {
    const tainted = await under([taintTable('hand', { 'src/relay.ts': { '+': ['./panel'] } })]);

    expect(tainted.records.map((record) => record.file)).toEqual(records.map((record) => record.file));
  });
});

describe('what a second run costs', () => {
  /** A reader that parses every file it is handed, and counts the parses. */
  const counting = (name: string, minus: readonly string[]) => {
    const asked: string[] = [];
    const taint: Taint = {
      name,
      files: (file) => file.endsWith('.test.ts'),
      read: (subject) => {
        subject.program();
        asked.push(subject.file);
        return { minus };
      },
    };
    return { taint, asked };
  };

  it('asks a reader nothing about a file whose bytes it has already answered for', async () => {
    const cache = memoryParseCache();
    const { taint, asked } = counting('counter', ['./api']);

    const first = await taintRecords(records, [taint], { root, cache });
    const parsed = asked.length;
    const second = await taintRecords(records, [taint], { root, cache });

    expect(parsed).toBeGreaterThan(0);
    expect(asked.length).toBe(parsed);
    expect(second.shadows).toEqual(first.shadows);
    expect(second.shadows.get('src/card.test.ts')).toEqual(['src/api.ts']);
  });

  it('asks again when nothing remembers the answer', async () => {
    const { taint, asked } = counting('counter', ['./api']);

    await taintRecords(records, [taint], { root });
    const parsed = asked.length;
    await taintRecords(records, [taint], { root });

    expect(asked.length).toBe(parsed * 2);
  });

  it('keeps one file’s two readers apart', async () => {
    const cache = memoryParseCache();
    const one = counting('one', ['./api']);
    const two = counting('two', ['./card']);

    await taintRecords(records, [one.taint, two.taint], { root, cache });
    const tainted = await taintRecords(records, [one.taint, two.taint], { root, cache });

    expect(tainted.shadows.get('src/card.test.ts')).toEqual(['src/api.ts', 'src/card.ts']);
    expect(tainted.shadowedBy.get('src/card.test.ts')).toEqual(
      new Map([
        ['src/api.ts', ['one']],
        ['src/card.ts', ['two']],
      ]),
    );
  });
});

describe('several taints at once', () => {
  it('unions the removals and the additions', async () => {
    const one = taintTable('one', { 'src/card.test.ts': { '-': ['./api'] } });
    const two = taintTable('two', { 'src/card.test.ts': { '-': ['./card'], '+': ['./panel'] } });
    const tainted = await under([one, two]);

    expect(tainted.shadows.get('src/card.test.ts')).toEqual(['src/api.ts', 'src/card.ts']);
    expect(targets(tainted.records.find((record) => record.file === 'src/card.test.ts'))).toEqual(['src/api.ts', 'src/card.ts', 'src/panel.ts']);
  });

  it('credits every taint that named a target, and each only for what it named', async () => {
    const one = taintTable('one', { 'src/card.test.ts': { '-': ['./api'] } });
    const two = taintTable('two', { 'src/card.test.ts': { '-': ['./api', './card'] }, 'src/relay.ts': { '+': ['./panel'] } });
    const tainted = await under([one, two, mockTaint()]);

    expect(tainted.shadowedBy.get('src/card.test.ts')).toEqual(
      new Map([
        ['src/api.ts', ['mocks', 'one', 'two']],
        ['src/card.ts', ['two']],
      ]),
    );
    expect(tainted.addedBy.get('src/relay.ts')).toEqual(new Map([['src/panel.ts', ['two']]]));
  });

  it('lets a shadow hold over an addition of the same file', async () => {
    const cut = taintTable('cut', { 'src/card.test.ts': { '-': ['./api'] } });
    const add = taintTable('add', { 'src/card.test.ts': { '+': ['./api'] } });

    expect((await affectedUnder([cut, add], ['src/api.ts'])).files).not.toContain('src/card.test.ts');
  });
});

describe('the mock taint', () => {
  it('shadows a vitest, jest or storybook mock for the file that wrote it', async () => {
    const { shadows } = await under([mockTaint()]);

    expect(shadows.get('src/card.test.ts')).toEqual(['src/api.ts']);
    expect(shadows.get('src/card.stories.ts')).toEqual(['src/api.ts']);
    expect(shadows.get('src/panel.jest.test.ts')).toEqual(['src/api.ts', 'src/panel.ts']);
  });

  it('keeps the module when the factory reaches for the real one, or is written elsewhere', async () => {
    const { shadows } = await under([mockTaint()]);

    for (const file of ['src/actual.test.ts', 'src/original.test.ts', 'src/named.test.ts']) {
      expect(shadows.has(file), file).toBe(false);
    }
  });

  it('does not read a doMock: the static imports above it ran the real module', async () => {
    expect((await under([mockTaint()])).shadows.has('src/late.test.ts')).toBe(false);
  });

  it('takes the mocked module out of the run at every level', async () => {
    // `card.test.ts` mocks `./api`; the `api.ts` under `card.ts` is the mock too.
    const affected = await affectedUnder([mockTaint()], ['src/api.ts']);

    expect(affected.files).toContain('src/card.ts');
    expect(affected.files).not.toContain('src/card.test.ts');
    expect(affected.files).not.toContain('src/card.stories.ts');
    expect(affected.shadowed).toEqual(['src/card.stories.ts', 'src/card.test.ts', 'src/panel.jest.test.ts']);
    expect(affected.files).toContain('src/actual.test.ts');
  });

  it('still moves the test for a change beside the mock', async () => {
    const affected = await affectedUnder([mockTaint()], ['src/card.ts']);

    expect(affected.files).toContain('src/card.test.ts');
    expect(affected.shadowed).toEqual([]);
  });

  it('opens only files a mock is expected in, unless told otherwise', async () => {
    expect(['src/a.test.ts', 'src/a.spec.tsx', 'src/a.stories.ts', '.storybook/preview.ts', 'test/setup.ts'].every(isTestLike)).toBe(true);
    expect(isTestLike('src/card.ts')).toBe(false);

    const everywhere = mockTaint({ files: () => true });
    expect((await under([everywhere])).shadows.get('src/card.test.ts')).toEqual(['src/api.ts']);
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
    await under([spy]);

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
