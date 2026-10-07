import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import filter from './jest-filter.cjs';
import { SELECTION_FILTER, selectingFilter } from './jest-selection.js';
import type { SuiteSelection } from './suite-selection.js';
import { withTestSelection } from './jest.js';

const root = resolve('/checkout');
/** A directory that resolves the Jest this repository tests against. */
const rootDir = fileURLToPath(new URL('.', import.meta.url));
const at = (file: string) => resolve(root, file);
const selection = (skip: readonly string[], more: Partial<SuiteSelection> = {}): SuiteSelection => ({
  whole: new Set(skip),
  skip: new Set(skip),
  notes: [],
  ...more,
});
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the Jest filter that drops what a selection may skip', () => {
  it('drops the skipped files from what Jest found, and counts the rest against it', async () => {
    const lines: string[] = [];
    const configured = selectingFilter({}, {
      root,
      rootDir,
      selection: async () => selection(['a.test.ts', 'c.test.ts'], { notes: ['read from the record at 0123abcd'] }),
      argv: [],
      say: (line) => lines.push(line),
    });

    expect(configured).toEqual({ filter: SELECTION_FILTER });
    await expect(filter([at('a.test.ts'), at('b.test.ts'), at('c.test.ts'), at('new.test.ts')]))
      .resolves.toEqual({ filtered: [at('b.test.ts'), at('new.test.ts')] });
    expect(lines).toEqual(['variance-authority: selected 2 of 4', '  read from the record at 0123abcd']);
  });

  it('reads the selection once for every project Jest asks about, and prints its notes once', async () => {
    const lines: string[] = [];
    let reads = 0;
    selectingFilter({}, {
      root,
      rootDir,
      selection: async () => {
        reads += 1;
        return selection(['unit/a.test.ts'], { notes: ['one note'] });
      },
      argv: [],
      say: (line) => lines.push(line),
    });

    await expect(filter([at('unit/a.test.ts'), at('unit/b.test.ts')])).resolves.toEqual({ filtered: [at('unit/b.test.ts')] });
    await expect(filter([at('dom/c.test.ts')])).resolves.toEqual({ filtered: [at('dom/c.test.ts')] });
    expect(reads).toBe(1);
    expect(lines).toEqual(['variance-authority: selected 1 of 2', '  one note', 'variance-authority: selected 1 of 1']);
  });

  it('runs the project\'s own filter first, in either shape Jest has asked a filter to return', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-filter-'));
    temporary.push(directory);
    await writeFile(resolve(directory, 'own.cjs'), `
let ready = false;
module.exports = async (paths) => {
  if (!ready) throw new Error('setup did not run');
  return { filtered: paths.filter((path) => !path.endsWith('b.test.ts')).map((test) => ({ test })) };
};
module.exports.setup = async () => { ready = true; };
`);
    await installed(directory, '30.0.0');
    const lines: string[] = [];
    selectingFilter({ filter: '<rootDir>/own.cjs' }, {
      root: directory,
      rootDir: directory,
      selection: async () => selection(['a.test.ts']),
      argv: [],
      say: (line) => lines.push(line),
    });

    const found = ['a.test.ts', 'b.test.ts', 'c.test.ts'].map((file) => resolve(directory, file));
    await expect(filter(found)).resolves.toEqual({ filtered: [resolve(directory, 'c.test.ts')] });
    expect(lines).toEqual(['variance-authority: selected 1 of 2']);
  });

  it('runs every file and says which reading declined', async () => {
    const lines: string[] = [];
    selectingFilter({}, {
      root,
      rootDir,
      selection: async () => selection([], { declined: 'no execution journal at /checkout/.cache/coverage.bin' }),
      argv: [],
      say: (line) => lines.push(line),
    });

    await expect(filter([at('a.test.ts')])).resolves.toEqual({ filtered: [at('a.test.ts')] });
    expect(lines).toEqual(['variance-authority: declined: no execution journal at /checkout/.cache/coverage.bin']);
  });

  it('fails the run with the refusal the reading made', async () => {
    selectingFilter({}, {
      root,
      rootDir,
      selection: async () => {
        throw new Error('the record names no commit, and nothing was handed as --since');
      },
      argv: [],
      say: () => {},
    });

    await expect(filter([at('a.test.ts')])).rejects.toThrow('the record names no commit');
  });

  it('refuses a Jest older than 30, which reads the paths it answers as no files', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-filter-'));
    temporary.push(directory);
    await installed(directory, '29.7.0');

    expect(() => selectingFilter({}, {
      root: directory,
      rootDir: directory,
      selection: async () => selection([]),
      argv: [],
      say: () => {},
    })).toThrow(`selection needs Jest 30 or newer, and ${directory} resolves Jest 29.7.0`);
  });

  it('does not select in watch mode, and says so', () => {
    const lines: string[] = [];
    const options = { root, rootDir, selection: async () => selection(['a.test.ts']), say: (line: string) => lines.push(line) };

    expect(selectingFilter({ watch: true }, { ...options, argv: [] })).toEqual({});
    expect(selectingFilter({}, { ...options, argv: ['node', 'jest', '--watchAll'] })).toEqual({});
    expect(lines).toEqual(['variance-authority: watch mode does not select', 'variance-authority: watch mode does not select']);
  });

  it('says that a filter named on the command line turns the selection off', () => {
    const lines: string[] = [];
    const options = { root, rootDir, selection: async () => selection(['a.test.ts']), say: (line: string) => lines.push(line) };

    expect(selectingFilter({}, { ...options, argv: ['node', 'jest', '--filter=./mine.cjs'] })).toEqual({});
    expect(selectingFilter({}, { ...options, argv: ['node', 'jest', '--skipFilter'] })).toEqual({});
    expect(lines).toEqual([
      'variance-authority: --filter on the command line replaces the selection filter, so nothing is selected',
      'variance-authority: --skipFilter turns the selection filter off, so nothing is selected',
    ]);
  });

  it('is set by the seam when a selection is handed in, once however many times it wraps', () => {
    const handed = { coverageFile: 'coverage.bin', selection: async () => selection([]) };
    const once = withTestSelection({ rootDir }, handed);
    const twice = withTestSelection(once, handed);

    expect(once.filter).toBe(SELECTION_FILTER);
    expect(twice.filter).toBe(SELECTION_FILTER);
    expect(withTestSelection({ rootDir }, { coverageFile: 'coverage.bin' }).filter).toBeUndefined();
  });
});

/** A `jest` package of one version, installed where `directory` resolves it. */
async function installed(directory: string, version: string): Promise<void> {
  await mkdir(resolve(directory, 'node_modules/jest'), { recursive: true });
  await writeFile(resolve(directory, 'node_modules/jest/package.json'), JSON.stringify({ name: 'jest', version }));
}
