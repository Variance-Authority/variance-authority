import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { relationsOfFiles, type FileRecord, type Relations } from '@variance-authority/core/relate';
import { CrossingSets } from './crossing-sets.js';
import type { LineRange } from './diff-lines.js';
import { decodeExecutionIndex } from './execution-format.js';
import { narrowByJourneys } from './execution-select.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { projectJourneyFile, selectJourneyFile } from './journey-native.js';

/**
 * `api.ts` imports `http.ts`; `card.ts` imports `api.ts`. `card.test.ts` mocks
 * `api.ts` and reaches `http.ts` only through it, `wire.test.ts` mocks `api.ts`
 * and imports `http.ts` itself, `plain.test.ts` mocks nothing, and
 * `other.test.ts` imports `solo.ts` alone. `http.ts` imports the package `ky`,
 * which rests on `ky-core`; `solo.ts` imports `left-pad` for its types only.
 */
const RECORDS: readonly FileRecord[] = [
  { file: 'src/http.ts', packages: [{ to: 'ky', kind: 'imports' }] },
  { file: 'src/api.ts', edges: [{ to: 'src/http.ts', kind: 'imports' }] },
  { file: 'src/card.ts', edges: [{ to: 'src/api.ts', kind: 'imports' }] },
  { file: 'src/solo.ts', packages: [{ to: 'left-pad', kind: 'type' }] },
  { file: 'test/card.test.ts', edges: [{ to: 'src/card.ts', kind: 'imports' }, { to: 'src/api.ts', kind: 'imports' }] },
  { file: 'test/plain.test.ts', edges: [{ to: 'src/card.ts', kind: 'imports' }] },
  {
    file: 'test/wire.test.ts',
    edges: [{ to: 'src/card.ts', kind: 'imports' }, { to: 'src/api.ts', kind: 'imports' }, { to: 'src/http.ts', kind: 'imports' }],
  },
  { file: 'test/other.test.ts', edges: [{ to: 'src/solo.ts', kind: 'imports' }] },
];
const depends = [['ky', 'ky-core']] as const;
const mocked = relationsOfFiles(RECORDS, {
  shadows: new Map([['test/card.test.ts', ['src/api.ts']], ['test/wire.test.ts', ['src/api.ts']]]),
  depends,
});
const plain = relationsOfFiles(RECORDS, { depends });

const TESTS = [
  { id: 'card > a', file: 'test/card.test.ts', name: 'a' },
  { id: 'plain > a', file: 'test/plain.test.ts', name: 'a' },
  { id: 'wire > a', file: 'test/wire.test.ts', name: 'a' },
  { id: 'other > a', file: 'test/other.test.ts', name: 'a' },
  { id: 'plain > b', file: 'test/plain.test.ts', name: 'b' },
];

const region = (kind: string, name: string, startLine: number, endLine: number) =>
  ({ kind, name, path: name, startLine, endLine, source: true });

function journeyFile(): string {
  const sets = new CrossingSets(TESTS.length);
  const bytes = encodeSetExecutionIndex({
    tests: TESTS,
    modules: [
      {
        file: 'src/api.ts',
        blocks: [region('module', '', 1, 10), region('function', 'get', 3, 6), region('function', 'nested', 4, 4)],
        called: Uint32Array.of(sets.intern([]), sets.intern([0, 1, 2]), sets.intern([4])),
        loaded: Uint8Array.of(1, 0, 0),
      },
      {
        file: 'src/http.ts',
        blocks: [region('function', 'send', 1, 4)],
        called: Uint32Array.of(sets.intern([0, 1, 2])),
        loaded: Uint8Array.of(0),
      },
      {
        file: 'src/card.ts',
        blocks: [region('function', 'render', 1, 5)],
        called: Uint32Array.of(sets.intern([1])),
        loaded: Uint8Array.of(0),
      },
    ],
    sets: sets.pool(),
  });
  const file = join(mkdtempSync(join(tmpdir(), 'journey-native-')), 'journeys.bin');
  writeFileSync(file, bytes);
  return file;
}

const FILE = journeyFile();
const lines = (start: number, end = start): readonly LineRange[] => [{ start, end }];

const CHANGES: readonly (readonly [string, ReadonlyMap<string, readonly LineRange[]>])[] = [
  ['a nested region', new Map([['src/api.ts', lines(4)]])],
  ['a region only mocked tests and one real one entered', new Map([['src/api.ts', lines(3)]])],
  ['a file one mocked test reaches for real', new Map([['src/http.ts', lines(2)]])],
  ['a whole file', new Map([['src/api.ts', []]])],
  ['a load-time region', new Map([['src/api.ts', lines(1)]])],
  ['a range across regions', new Map([['src/api.ts', lines(1, 10)]])],
  ['a test file', new Map([['test/other.test.ts', []]])],
  ['a file the journey has no row for', new Map([['src/solo.ts', []]])],
  ['a path nothing knows', new Map([['nowhere.ts', []]])],
  ['everything at once', new Map<string, readonly LineRange[]>([
    ['src/api.ts', lines(4)], ['src/http.ts', lines(2)], ['src/card.ts', []], ['nowhere.ts', []],
  ])],
];

const BUMPS: readonly (readonly [string, readonly string[]])[] = [
  ['a package a file imports', ['ky']],
  ['a package under the one a file imports', ['ky-core']],
  ['a package only a type import names', ['left-pad']],
  ['a package nothing names', ['nowhere']],
];

describe('selecting off a journey file in the addon', () => {
  const index = decodeExecutionIndex(readFileSync(FILE));

  for (const [graph, relations] of [['mocks', mocked], ['no mocks', plain], ['no graph', undefined]] as const) {
    for (const [what, packages] of BUMPS) {
      it(`answers ${what} bumped as narrowByJourneys does, with ${graph}`, async () => {
        const options = { ...(relations === undefined ? {} : { relations: relations as Relations }), packages };
        const changed = new Map<string, readonly LineRange[]>();
        expect(await selectJourneyFile(FILE, changed, options)).toEqual(narrowByJourneys(index, changed, options));
      });
    }
  }

  it('traces a bump through the install to the files importing it, and to every case the record saw enter one', async () => {
    const bumped = async (name: string) =>
      (await selectJourneyFile(FILE, new Map(), { relations: mocked, packages: [name] }))?.entered;
    // `card.test.ts` reaches `http.ts` only through its mock of `api.ts`, and
    // one of its cases called `send` anyway: the call is the record's word.
    expect(await bumped('ky-core')).toEqual(['test/card.test.ts', 'test/plain.test.ts', 'test/wire.test.ts']);
    expect(await bumped('ky')).toEqual(['test/card.test.ts', 'test/plain.test.ts', 'test/wire.test.ts']);
    expect(await bumped('left-pad')).toEqual([]);
    expect(await bumped('nowhere')).toEqual([]);
  });

  for (const [graph, relations] of [['mocks', mocked], ['no mocks', plain], ['no graph', undefined]] as const) {
    for (const [what, changed] of CHANGES) {
      it(`answers ${what} as narrowByJourneys does, with ${graph}`, async () => {
        const options = relations === undefined ? {} : { relations: relations as Relations };
        expect(await selectJourneyFile(FILE, changed, options)).toEqual(narrowByJourneys(index, changed, options));
      });
    }
  }

  it('charges a line to the innermost region, and holds every case to what it entered, mocks or not', async () => {
    const at = async (file: string, line: number) =>
      (await selectJourneyFile(FILE, new Map([[file, lines(line)]]), { relations: mocked }))?.entered;
    expect(await at('src/api.ts', 4)).toEqual(['test/plain.test.ts']);
    expect(await at('src/api.ts', 3)).toEqual(['test/card.test.ts', 'test/plain.test.ts', 'test/wire.test.ts']);
    expect(await at('src/http.ts', 2)).toEqual(['test/card.test.ts', 'test/plain.test.ts', 'test/wire.test.ts']);
  });

  it('lets a mock cut only what ran while the module evaluated, which the graph answers', async () => {
    const loadTime = new Map([['src/api.ts', lines(1)]]);
    expect((await selectJourneyFile(FILE, loadTime, { relations: mocked }))?.entered).toEqual(['test/plain.test.ts']);
    expect((await selectJourneyFile(FILE, loadTime, { relations: plain }))?.entered)
      .toEqual(['test/card.test.ts', 'test/plain.test.ts', 'test/wire.test.ts']);
  });

  it('names a path neither the record nor the graph knows', async () => {
    const selected = await selectJourneyFile(FILE, new Map([['nowhere.ts', []]]), { relations: mocked });
    expect(selected?.unread).toEqual(['nowhere.ts']);
    expect(selected?.whole).toEqual(['test/card.test.ts', 'test/other.test.ts', 'test/plain.test.ts', 'test/wire.test.ts']);
  });
});

describe('projecting a journey file onto a change', () => {
  it('keeps every region of a changed module and expands only the ones the change lands on', async () => {
    const projected = await projectJourneyFile(FILE, new Map([['src/api.ts', lines(4)], ['src/solo.ts', []]]));
    expect(projected?.files).toEqual(['src/api.ts', 'src/card.ts', 'src/http.ts']);
    expect(projected?.index.modules.map((module) => module.file)).toEqual(['src/api.ts']);
    expect(projected?.index.modules[0]?.blocks.map((block) => block.crossings.map((crossing) => crossing.test)))
      .toEqual([[], [0, 1, 2], [4]]);
  });
});
