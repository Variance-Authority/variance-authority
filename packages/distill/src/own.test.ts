import type { ExecutionIndex, TestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { distillFile, formatFileDistillation, type LoadCause } from './index.js';

const FILE = 'test/dialog.test.ts';
const OTHER = 'test/other.test.ts';

type Block = TestCoverage['modules'][number]['blocks'][number];

/**
 * One module of a fixture: which test files evaluated it, whether it declares
 * a function, and which of the file's two cases entered it.
 */
interface Module {
  readonly by?: readonly string[];
  readonly barrel?: boolean;
  readonly entered?: readonly number[];
}

/** A record of one test file with two finished cases, from its modules and the static imports between them. */
function read(
  modules: Readonly<Record<string, Module>>,
  edges?: Readonly<Record<string, readonly string[]>>,
  republishing: readonly string[] = [],
  lazy?: Readonly<Record<string, readonly string[]>>,
) {
  const coverage: TestCoverage = {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [{ file: FILE, complete: true, preconditions: [] }, { file: OTHER, complete: true, preconditions: [] }],
    modules: Object.entries(modules).map(([file, module]) => {
      const by = module.by ?? [FILE];
      const root: Block = {
        ordinal: 0, kind: 'module', digest: `${file}#root`, name: '', path: '', source: true,
        testFiles: by, loadedBy: by, startLine: 1, endLine: 10,
      };
      const run: Block = {
        ordinal: 1, kind: 'function', owner: 0, digest: `${file}#run`, name: 'run', path: 'run',
        source: true, testFiles: by, startLine: 2, endLine: 2,
      };
      return { file, sourceDigest: file, instrumented: true, blocks: module.barrel === true ? [root] : [root, run] };
    }),
  };
  const execution: ExecutionIndex = {
    tests: [
      { id: `${FILE} > one`, file: FILE, name: 'one', stopped: false },
      { id: `${FILE} > two`, file: FILE, name: 'two', stopped: false },
    ],
    modules: Object.entries(modules).map(([file, module]) => ({
      file,
      blocks: [{
        kind: 'function', name: 'run', path: 'run', startLine: 2, endLine: 2, source: true,
        crossings: (module.entered ?? []).map((test) => ({ test, distance: 0 })),
      }],
    })),
  };
  return distillFile({
    file: FILE,
    coverage,
    execution,
    ...(edges === undefined ? {} : {
      imports: (file: string) => edges[file] ?? [],
      republishes: (file: string) => republishing.includes(file),
    }),
    ...(lazy === undefined ? {} : { lazy: (file: string) => lazy[file] ?? [] }),
  });
}

function causes(result: ReturnType<typeof distillFile>): Record<string, LoadCause | undefined> {
  return Object.fromEntries((result.modules ?? []).filter(({ entered }) => entered === 0).map(({ file, cause }) => [file, cause]));
}

const USED = { entered: [0, 1] };
const NEVER = {};

describe('distillFile with the imports given', () => {
  it('names the import a module the test file does not write brought everything behind it in by', () => {
    const result = read(
      { 'src/dialog.ts': USED, 'src/editor.ts': NEVER, 'src/markdown.ts': NEVER },
      { [FILE]: ['src/dialog.ts'], 'src/dialog.ts': ['src/editor.ts'], 'src/editor.ts': ['src/markdown.ts'] },
    );

    const editor = { kind: 'import', importer: 'src/dialog.ts', imported: 'src/editor.ts', reach: 'subject' };
    expect(causes(result)).toEqual({ 'src/editor.ts': editor, 'src/markdown.ts': editor });
  });

  it('puts what spills out of a barrel at the barrel\'s own re-export, not at the import of the barrel', () => {
    const result = read(
      { 'src/index.ts': { barrel: true }, 'src/button.ts': USED, 'src/chart.ts': NEVER },
      { [FILE]: ['src/index.ts'], 'src/index.ts': ['src/button.ts', 'src/chart.ts'] },
    );

    expect(causes(result)).toEqual({ 'src/chart.ts': { kind: 'import', importer: 'src/index.ts', imported: 'src/chart.ts', reach: 'subject' } });
  });

  it('gives what a barrel no case uses brings in to the import of the barrel', () => {
    const result = read(
      { 'src/dialog.ts': USED, 'src/index.ts': { barrel: true }, 'src/chart.ts': NEVER, 'src/table.ts': NEVER },
      { [FILE]: ['src/dialog.ts', 'src/index.ts'], 'src/index.ts': ['src/chart.ts', 'src/table.ts'] },
      ['src/index.ts'],
    );

    const barrel = { kind: 'import', importer: FILE, imported: 'src/index.ts', reach: 'test' };
    expect(causes(result)).toEqual({ 'src/chart.ts': barrel, 'src/table.ts': barrel });
  });

  it('keeps a file of constants, which a case may read unrecorded, from owning what it imports', () => {
    const result = read(
      { 'src/config.ts': { barrel: true }, 'src/heavy.ts': NEVER },
      { [FILE]: ['src/config.ts'], 'src/config.ts': ['src/heavy.ts'] },
    );

    expect(causes(result)).toEqual({ 'src/heavy.ts': { kind: 'import', importer: 'src/config.ts', imported: 'src/heavy.ts', reach: 'subject' } });
  });

  it('counts a module two used imports reach to neither, and names where their paths part', () => {
    const result = read(
      { 'src/a.ts': USED, 'src/b.ts': USED, 'src/shared.ts': NEVER },
      { [FILE]: ['src/a.ts', 'src/b.ts'], 'src/a.ts': ['src/shared.ts'], 'src/b.ts': ['src/shared.ts'] },
    );

    expect(causes(result)).toEqual({ 'src/shared.ts': { kind: 'shared', parts: FILE } });
  });

  it('gives a diamond below an unused import to that import', () => {
    const result = read(
      { 'src/dialog.ts': USED, 'src/heavy.ts': NEVER, 'src/x.ts': NEVER, 'src/y.ts': NEVER, 'src/z.ts': NEVER },
      {
        [FILE]: ['src/dialog.ts'],
        'src/dialog.ts': ['src/heavy.ts'],
        'src/heavy.ts': ['src/x.ts', 'src/y.ts'],
        'src/x.ts': ['src/z.ts'],
        'src/y.ts': ['src/z.ts'],
      },
    );

    expect(new Set(Object.values(causes(result)).map((cause) => JSON.stringify(cause)))).toEqual(
      new Set([JSON.stringify({ kind: 'import', importer: 'src/dialog.ts', imported: 'src/heavy.ts', reach: 'subject' })]),
    );
  });

  it('follows a cycle without counting its way back as a second way in', () => {
    const result = read(
      { 'src/dialog.ts': USED, 'src/editor.ts': NEVER, 'src/helpers.ts': NEVER },
      { [FILE]: ['src/dialog.ts'], 'src/dialog.ts': ['src/editor.ts'], 'src/editor.ts': ['src/helpers.ts'], 'src/helpers.ts': ['src/editor.ts'] },
    );

    const editor = { kind: 'import', importer: 'src/dialog.ts', imported: 'src/editor.ts', reach: 'subject' };
    expect(causes(result)).toEqual({ 'src/editor.ts': editor, 'src/helpers.ts': editor });
  });

  it('counts a file that imports and re-exports the same module as one way in', () => {
    const result = read(
      { 'src/dialog.ts': USED, 'src/editor.ts': NEVER },
      { [FILE]: ['src/dialog.ts'], 'src/dialog.ts': ['src/editor.ts', 'src/editor.ts'] },
    );

    expect(causes(result)).toEqual({ 'src/editor.ts': { kind: 'import', importer: 'src/dialog.ts', imported: 'src/editor.ts', reach: 'subject' } });
  });

  it('calls a module no import the graph reads reaches unseen, as a dynamic import whose specifier is not a literal', () => {
    const result = read({ 'src/dialog.ts': USED, 'src/lazy.ts': NEVER }, { [FILE]: ['src/dialog.ts'] });

    expect(causes(result)).toEqual({ 'src/lazy.ts': { kind: 'unseen' } });
  });

  it('gives what only a dynamic import reaches to that import, marked lazy', () => {
    const result = read(
      { 'src/dialog.ts': USED, 'src/modal.ts': NEVER, 'src/editor.ts': NEVER },
      { [FILE]: ['src/dialog.ts'], 'src/modal.ts': ['src/editor.ts'] },
      [],
      { 'src/dialog.ts': ['src/modal.ts'] },
    );

    const modal = { kind: 'import', importer: 'src/dialog.ts', imported: 'src/modal.ts', lazy: true };
    expect(causes(result)).toEqual({ 'src/modal.ts': modal, 'src/editor.ts': modal });
  });

  it('counts a module a static and a dynamic import both reach to neither', () => {
    const result = read(
      { 'src/dialog.ts': USED, 'src/form.ts': USED, 'src/date.ts': NEVER },
      { [FILE]: ['src/dialog.ts', 'src/form.ts'], 'src/form.ts': ['src/date.ts'] },
      [],
      { 'src/dialog.ts': ['src/date.ts'] },
    );

    expect(causes(result)).toEqual({ 'src/date.ts': { kind: 'shared', parts: FILE } });
  });

  it('reads an importer that imports a module both statically and lazily as importing it, which evaluates it on load', () => {
    const result = read(
      { 'src/dialog.ts': USED, 'src/modal.ts': NEVER },
      { [FILE]: ['src/dialog.ts'], 'src/dialog.ts': ['src/modal.ts'] },
      [],
      { 'src/dialog.ts': ['src/modal.ts'] },
    );

    expect(causes(result)).toEqual({ 'src/modal.ts': { kind: 'import', importer: 'src/dialog.ts', imported: 'src/modal.ts', reach: 'subject' } });
  });

  it('gives a dynamic import under an unused static import to the static one, whose removal frees both', () => {
    const result = read(
      { 'src/dialog.ts': NEVER, 'src/modal.ts': NEVER },
      { [FILE]: ['src/dialog.ts'] },
      [],
      { 'src/dialog.ts': ['src/modal.ts'] },
    );

    const dialog = { kind: 'import', importer: FILE, imported: 'src/dialog.ts', reach: 'test' };
    expect(causes(result)).toEqual({ 'src/dialog.ts': dialog, 'src/modal.ts': dialog });
  });

  it('cuts the edge into a module the file mocked with a factory, which it never evaluated', () => {
    const result = read(
      { 'src/dialog.ts': USED, 'src/mocked.ts': { by: [OTHER] }, 'src/editor.ts': NEVER },
      { [FILE]: ['src/dialog.ts', 'src/mocked.ts'], 'src/dialog.ts': ['src/editor.ts'], 'src/mocked.ts': ['src/editor.ts'] },
    );

    expect(causes(result)).toEqual({ 'src/editor.ts': { kind: 'import', importer: 'src/dialog.ts', imported: 'src/editor.ts', reach: 'subject' } });
  });

  it('keeps the edge into an automocked module, which the file still evaluated', () => {
    const result = read(
      { 'src/dialog.ts': USED, 'src/mocked.ts': USED, 'src/editor.ts': NEVER },
      { [FILE]: ['src/dialog.ts', 'src/mocked.ts'], 'src/dialog.ts': ['src/editor.ts'], 'src/mocked.ts': ['src/editor.ts'] },
    );

    expect(causes(result)).toEqual({ 'src/editor.ts': { kind: 'shared', parts: FILE } });
  });

  it('keeps the edge into a file the record does not hold, since it cannot say the file was not loaded', () => {
    const result = read(
      { 'src/dialog.ts': USED, 'src/editor.ts': NEVER },
      { [FILE]: ['src/dialog.ts', 'src/data.json'], 'src/dialog.ts': ['src/editor.ts'], 'src/data.json': ['src/editor.ts'] },
    );

    expect(causes(result)).toEqual({ 'src/editor.ts': { kind: 'shared', parts: FILE } });
  });

  it('gives no import to an unused module whose import also brings in code a case entered', () => {
    const result = read(
      { 'src/plugin.ts': NEVER, 'src/registry.ts': USED },
      { [FILE]: ['src/plugin.ts'], 'src/plugin.ts': ['src/registry.ts'] },
    );

    expect(causes(result)).toEqual({ 'src/plugin.ts': { kind: 'shared', parts: FILE } });
  });

  it('names no cause without the imports, nor for a module some case entered', () => {
    const modules = { 'src/dialog.ts': { entered: [0] }, 'src/editor.ts': NEVER };
    const edges = { [FILE]: ['src/dialog.ts'], 'src/dialog.ts': ['src/editor.ts'] };

    expect(read(modules).modules?.every(({ cause }) => cause === undefined)).toBe(true);
    expect(read(modules, edges).modules?.find(({ file }) => file === 'src/dialog.ts')?.cause).toBeUndefined();
  });
});

describe('formatFileDistillation with causes', () => {
  it('groups what no case entered under the import that brought it in, heaviest first', () => {
    const result = read(
      { 'src/dialog.ts': USED, 'src/editor.ts': NEVER, 'src/markdown.ts': NEVER, 'src/a.ts': USED, 'src/b.ts': USED, 'src/shared.ts': NEVER, 'src/lazy.ts': NEVER },
      {
        [FILE]: ['src/dialog.ts', 'src/a.ts', 'src/b.ts'],
        'src/dialog.ts': ['src/editor.ts'],
        'src/editor.ts': ['src/markdown.ts'],
        'src/a.ts': ['src/shared.ts'],
        'src/b.ts': ['src/shared.ts'],
      },
    );

    expect(formatFileDistillation(result)).toContain([
      'Loaded, and entered by no case: 4 module(s), 40 line(s).',
      '  src/dialog.ts imports src/editor.ts: 2 module(s), 20 line(s)',
      "    Or mock it in this file, so src/dialog.ts does not load it: jest.mock('../src/editor', () => ({}));",
      '    src/editor.ts — 10 line(s)',
      '    src/markdown.ts — 10 line(s)',
      '  No one import brings these in alone: 1 module(s), 10 line(s)',
      `    src/shared.ts — 10 line(s), every path to it runs through ${FILE}`,
      '  No import the graph reads reaches these from the test file: 1 module(s), 10 line(s)',
      '    src/lazy.ts — 10 line(s)',
    ].join('\n'));
  });

  it('names the ten heaviest imports and three modules under each, and sums the rest; the result keeps every one', () => {
    const modules: Record<string, Module> = { 'src/dialog.ts': USED };
    const edges: Record<string, string[]> = { [FILE]: ['src/dialog.ts'], 'src/dialog.ts': [] };
    for (let at = 0; at < 12; at += 1) {
      const name = `src/m${String(at).padStart(2, '0')}.ts`;
      modules[name] = NEVER;
      edges['src/dialog.ts']!.push(name);
    }
    edges['src/m00.ts'] = ['src/deep1.ts', 'src/deep2.ts', 'src/deep3.ts', 'src/deep4.ts'];
    for (const deep of edges['src/m00.ts']) modules[deep] = NEVER;

    const result = read(modules, edges);
    const text = formatFileDistillation(result);

    expect(text).toContain([
      '  src/dialog.ts imports src/m00.ts: 5 module(s), 50 line(s)',
      "    Or mock it in this file, so src/dialog.ts does not load it: jest.mock('../src/m00', () => ({}));",
      '    src/deep1.ts — 10 line(s)',
      '    src/deep2.ts — 10 line(s)',
      '    src/deep3.ts — 10 line(s)',
      '    and 2 more: 2 module(s), 20 line(s)',
      '  src/dialog.ts imports src/m01.ts: 1 module(s), 10 line(s)',
      "    Or mock it in this file, so src/dialog.ts does not load it: jest.mock('../src/m01', () => ({}));",
    ].join('\n'));
    expect(text).toContain('  src/dialog.ts imports src/m09.ts: 1 module(s), 10 line(s)\n' +
      "    Or mock it in this file, so src/dialog.ts does not load it: jest.mock('../src/m09', () => ({}));" + '\n    src/m09.ts — 10 line(s)\n  and 2 more import(s): 2 module(s), 20 line(s)\n\n');
    expect(text).not.toContain('src/m10.ts');
    expect(Object.keys(causes(result))).toHaveLength(16);
  });
});
