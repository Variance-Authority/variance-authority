import type { ExecutionIndex, FileReferences, TestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { distillFile, formatFileDistillation, type ImportCharge } from './index.js';
import { reachLine } from './charge.js';

const FILE = 'test/report.test.ts';
const OTHER = 'test/export.test.ts';
const THIRD = 'test/print.test.ts';
const UTILS = 'src/utils.ts';
const PDF = 'src/pdf.ts';

type Block = TestCoverage['modules'][number]['blocks'][number];

/**
 * A used utilities file that imports a module no case of the test file
 * entered: `format` (lines 2–4) is run by the test file's one case, and
 * `exportPdf` (lines 11–13) by the other test file's only.
 */
function read(
  references: FileReferences | undefined,
  edges: Readonly<Record<string, readonly string[]>> = {},
  setup: readonly number[] = [],
  own?: FileReferences,
  pdf: FileReferences = referencing([], { exports: ['create'] }),
) {
  const root = (file: string, by: readonly string[]): Block => ({
    ordinal: 0, kind: 'module', digest: `${file}#root`, name: '', path: '', source: true,
    testFiles: by, loadedBy: by, startLine: 1, endLine: 30,
  });
  const fn = (file: string, ordinal: number, name: string, startLine: number, endLine: number): Block => ({
    ordinal, kind: 'function', owner: 0, digest: `${file}#${name}`, name, path: name, source: true,
    testFiles: [FILE, OTHER], startLine, endLine,
  });
  const coverage: TestCoverage = {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [FILE, OTHER, THIRD].map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [
      { file: UTILS, sourceDigest: UTILS, instrumented: true, blocks: [root(UTILS, [FILE, OTHER, THIRD]), fn(UTILS, 1, 'format', 2, 4), fn(UTILS, 2, 'exportPdf', 11, 13)] },
      { file: PDF, sourceDigest: PDF, instrumented: true, blocks: [root(PDF, [FILE, OTHER]), fn(PDF, 1, 'create', 2, 2)] },
    ],
  };
  const region = (name: string, startLine: number, endLine: number, tests: readonly number[], loaded = false) => ({
    // The walker opens a declaration's own region under the structural path `entry`; the name is the function's.
    kind: 'function', name, path: 'entry', startLine, endLine, source: true,
    crossings: tests.map((test) => ({ test, distance: 0, ...(loaded ? { loaded: true } : {}) })),
  });
  const execution: ExecutionIndex = {
    tests: [
      { id: `${FILE} > renders`, file: FILE, name: 'renders', stopped: false },
      { id: `${OTHER} > exports`, file: OTHER, name: 'exports', stopped: false },
    ],
    modules: [
      { file: UTILS, blocks: [region('format', 2, 4, [0]), region('exportPdf', 11, 13, [1]), region('setup', 24, 26, setup, true)] },
      { file: PDF, blocks: [region('create', 2, 2, [1])] },
    ],
  };
  const imports = { [FILE]: [UTILS], [UTILS]: [PDF], ...edges };
  return distillFile({
    file: FILE,
    coverage,
    execution,
    imports: (file) => imports[file] ?? [],
    references: (file) => (file === UTILS ? references : file === FILE ? own : file === PDF ? pdf : undefined),
  });
}

function chargeOf(result: ReturnType<typeof distillFile>): ImportCharge | undefined {
  const cause = result.modules?.find(({ file }) => file === PDF)?.cause;
  return cause?.kind === 'import' ? cause.charge : undefined;
}

const referencing = (
  references: FileReferences['references'],
  more: Partial<FileReferences> = {},
): FileReferences => ({ references, passed: [], imported: [PDF], effects: [], untraced: false, ...more });

describe('an import a used file writes, charged to the code that reads it', () => {
  it('names the functions no case of the file ran that read it, and how many test files that load the importer run one', () => {
    const result = read(referencing([
      { file: PDF, name: 'PDFDocument', line: 12, load: false },
      // Another source's reference at load is that import's, not this one's.
      { file: 'src/other.ts', name: 'PDFDocument', line: 1, load: true },
    ]));

    expect(chargeOf(result)).toEqual({
      kind: 'functions',
      functions: [{ name: 'exportPdf', line: 11, ran: 1 }],
      ran: 1,
      loading: 3,
    });
    expect(formatFileDistillation(result)).toContain(
      `    ${UTILS} reads ${PDF} only in exportPdf (line 11), which no case of this file ran; ` +
        `1 of 3 test file(s) that load ${UTILS} run one: move them out of ${UTILS}, or import ${PDF} lazily inside them.`,
    );
  });

  it('names the line of a reference that runs when the importer loads, such as a map of components', () => {
    const result = read(referencing([
      { file: PDF, name: 'default', line: 6, load: true },
      { file: PDF, name: 'PDFDocument', line: 12, load: false },
    ]));

    expect(chargeOf(result)).toEqual({ kind: 'load', line: 6, name: 'default' });
    expect(formatFileDistillation(result)).toContain(
      `    ${UTILS} reads default from ${PDF} at line 6 when it loads: move that reference into the function that needs it.`,
    );
  });

  it('says the import was needed when a case ran the function that reads it, passed on as a prop, without calling into it', () => {
    const result = read(referencing([{ file: PDF, name: 'Modal', line: 3, load: false }]));

    expect(chargeOf(result)).toEqual({ kind: 'ran', functions: [{ name: 'format', line: 2 }] });
    expect(formatFileDistillation(result)).toContain(
      `    A case ran format (line 2), which reads ${PDF} and calls nothing in it: make that reference lazy.`,
    );
  });

  it('reads a function the file calls while it loads as a reference at load, not as one a case ran', () => {
    // `setup()` at the top of the file runs `register(PdfViewer)` on every load.
    const result = read(referencing([{ file: PDF, name: 'PdfViewer', line: 25, load: false }]), {}, [0, 1]);

    expect(chargeOf(result)).toEqual({ kind: 'load', line: 25, name: 'PdfViewer' });
    // Another test file's crossing made while loading is not a call either.
    expect(chargeOf(read(referencing([{ file: PDF, name: 'PdfViewer', line: 25, load: false }]), {}, [1]))).toEqual({
      kind: 'functions',
      functions: [{ name: 'setup', line: 24, ran: 0 }],
      ran: 0,
      loading: 3,
    });
    // A re-export does not hide it: the file still pays for the module when it loads.
    expect(chargeOf(read(referencing([{ file: PDF, name: 'PdfViewer', line: 25, load: false }], { passed: [PDF] }), {}, [0])))
      .toEqual({ kind: 'load', line: 25, name: 'PdfViewer' });
  });

  it('leaves an import written only to load the module where it is, and says where else it could go', () => {
    const result = read(referencing([], { effects: [PDF] }));

    expect(chargeOf(result)).toEqual({ kind: 'effect' });
    expect(formatFileDistillation(result)).toContain(
      `    ${UTILS} imports ${PDF} only to load it: if this file's cases need nothing it sets up, import it where that is needed.`,
    );
  });

  it('proposes deleting an import the file never reads, unless loading the module is the point', () => {
    const result = read(referencing([]));

    expect(chargeOf(result)).toEqual({ kind: 'never' });
    expect(formatFileDistillation(result)).toContain(
      `    ${UTILS} reads nothing it imports from ${PDF}: delete the import, unless loading ${PDF} is the point.`,
    );
  });

  it('hands a re-exported import to the importers, and reads no import as never read past an untraced `require`', () => {
    expect(chargeOf(read(referencing([], { passed: [PDF] })))).toEqual({ kind: 'handed' });
    expect(chargeOf(read(referencing([], { untraced: true })))).toEqual({ kind: 'unmeasured' });
    // A barrel's `export *` is its importers' use, whatever else the barrel loads untraced.
    expect(chargeOf(read(referencing([], { passed: [PDF], untraced: true })))).toEqual({ kind: 'handed' });
    // So is one the barrel also reads in a function of its own.
    const handed = read(referencing([{ file: PDF, name: 'Modal', line: 3, load: false }], { passed: [PDF] }));
    expect(chargeOf(handed)).toEqual({ kind: 'handed' });
    expect(formatFileDistillation(handed)).toContain(
      `    ${UTILS} re-exports what it imports from ${PDF}, so its importers use it: import past ${UTILS} where they do.`,
    );
    expect(formatFileDistillation(read(referencing([], { untraced: true })))).toContain(
      `    ${UTILS} has a \`require\` or \`import()\` no name traces, so where it reads ${PDF} is unmeasured.`,
    );
  });

  it('leaves an import unmeasured where a reference sits in no region the record keeps', () => {
    const result = read(referencing([{ file: PDF, name: 'PDFDocument', line: 20, load: false }]));
    expect(chargeOf(result)).toEqual({ kind: 'unmeasured', line: 20 });
    expect(formatFileDistillation(result)).toContain(
      `    ${UTILS} reads ${PDF} at line 20, where the record keeps no region: unmeasured.`,
    );
  });

  it('marks the test file\'s own import as its own, and charges nothing where the importer\'s text was not read', () => {
    const own = read(referencing([]), { [FILE]: [UTILS, PDF], [UTILS]: [] });
    expect(own.modules?.find(({ file }) => file === PDF)?.cause).toEqual({ kind: 'import', importer: FILE, imported: PDF, reach: 'test' });
    expect(chargeOf(read(undefined))).toBeUndefined();
  });
});

describe('what to do about an import, by how far from the test file its importer is', () => {
  it('reads the test file\'s own import as an error to fix', () => {
    const own = read(referencing([]), { [FILE]: [UTILS, PDF], [UTILS]: [] }, [], referencing([]));
    expect(formatFileDistillation(own)).toContain(
      `    error: ${FILE} imports ${PDF}, and none of its cases enters what that loads: delete the import.`,
    );
    // Unread, the test file's text is no evidence that it reads none of the import.
    const unread = formatFileDistillation(read(referencing([]), { [FILE]: [UTILS, PDF], [UTILS]: [] }));
    expect(unread).toContain(`    error: ${FILE} imports ${PDF}, and none of its cases enters what that loads.`);
    expect(unread).not.toContain('delete the import');
    // Read at the test file's top level, as a title, the import is not deleted: the line under it says where.
    const atLoad = read(referencing([]), { [FILE]: [UTILS, PDF], [UTILS]: [] }, [], referencing([{ file: PDF, name: 'TITLE', line: 3, load: true }]));
    expect(formatFileDistillation(atLoad)).toContain([
      `    error: ${FILE} imports ${PDF}, and none of its cases enters what that loads.`,
      `    ${FILE} reads TITLE from ${PDF} at line 3 when it loads: move that reference into the function that needs it.`,
    ].join('\n'));
  });

  it('proposes mocking an import the file\'s subject never reads, with a factory that stands in for every value it exports', () => {
    // The mock replaces the module for every file the test loads, not only for the subject.
    const result = read(referencing([]));
    expect(result.modules?.find(({ file }) => file === PDF)?.cause).toMatchObject({ reach: 'subject', exports: ['create'] });
    expect(formatFileDistillation(result)).toContain(
      `    Or mock it in this file, so ${UTILS} does not load it: jest.mock('../src/pdf', () => ({ create: jest.fn() }));`,
    );
  });

  it('stands a function in for each export, so any file the test loads can call, construct or extend any of them', () => {
    // The mock replaces the module for every file the test loads, which may read a name the subject does not.
    const idle = read(referencing([{ file: PDF, name: 'default', line: 12, load: false }]), {}, [], undefined,
      referencing([], { exports: ['default', 'render', 'create'] }));
    expect(formatFileDistillation(idle)).toContain(
      `    Or mock it in this file, so ${UTILS} does not load it: ` +
        "jest.mock('../src/pdf', () => ({ __esModule: true, default: jest.fn(), render: jest.fn(), create: jest.fn() }));",
    );
    const charge = { kind: 'functions', functions: [{ name: 'exportPdf', line: 11, ran: 1 }], ran: 1, loading: 3 } as const;
    expect(reachLine(FILE, { importer: UTILS, imported: PDF, reach: 'subject', charge, exports: ['render'] }))
      .toBe(`Or mock it in this file, so ${UTILS} does not load it: jest.mock('../src/pdf', () => ({ render: jest.fn() }));`);
  });

  it('proposes no mock where what the imported module exports is not known', () => {
    // An `export *` leaves the set to another file, and a factory short of a name hands its reader undefined.
    expect(reachLine(FILE, { importer: UTILS, imported: PDF, reach: 'subject', charge: { kind: 'never' } })).toBeUndefined();
    expect(formatFileDistillation(read(referencing([]), {}, [], undefined, referencing([])))).not.toContain('jest.mock(');
  });

  it('proposes no mock where the subject reads the import when it loads', () => {
    // A stand-in read at load is used at load, or kept: `const viewer = new Viewer()` hands a case running `show()`
    // a mock instance, and `PREFIX + '!'` hands it what the factory made. The importer's line is the fix.
    const result = read(referencing([{ file: PDF, name: 'default', line: 6, load: true }]));
    expect(chargeOf(result)).toEqual({ kind: 'load', line: 6, name: 'default' });
    expect(formatFileDistillation(result)).toContain(`    ${UTILS} reads default from ${PDF} at line 6 when it loads`);
    expect(formatFileDistillation(result)).not.toContain('jest.mock(');
    // So does a function the file calls while it loads.
    expect(formatFileDistillation(read(referencing([{ file: PDF, name: 'PdfViewer', line: 25, load: false }]), {}, [0])))
      .not.toContain('jest.mock(');
    expect(reachLine(FILE, { importer: UTILS, imported: PDF, reach: 'subject', charge: { kind: 'load', line: 6, name: 'default' }, exports: ['default'] }))
      .toBeUndefined();
  });

  it('proposes no mock where what the subject reads is not known, or the load is the point', () => {
    for (const charge of [undefined, { kind: 'unmeasured' }, { kind: 'effect' }] as const) {
      expect(reachLine(FILE, { importer: UTILS, imported: PDF, reach: 'subject', ...(charge === undefined ? {} : { charge }) })).toBeUndefined();
    }
  });

  it('proposes no mock where a case runs, or the subject hands on, what reads the import', () => {
    const ran = { kind: 'ran', functions: [{ name: 'render', line: 6 }] } as const;
    expect(reachLine(FILE, { importer: UTILS, imported: PDF, reach: 'subject', charge: ran })).toBeUndefined();
    expect(reachLine(FILE, { importer: UTILS, imported: PDF, reach: 'subject', charge: { kind: 'handed' } })).toBeUndefined();
  });

  it('warns that mocking an import further away ties the test to what it does not import', () => {
    const result = read(referencing([{ file: PDF, name: 'default', line: 6, load: true }]), {
      [FILE]: ['src/index.ts'],
      'src/index.ts': [UTILS],
    });
    expect(result.modules?.find(({ file }) => file === PDF)?.cause).toMatchObject({ reach: 'beyond' });
    const text = formatFileDistillation(result);
    expect(text).toContain(
      `    warning: this file does not import ${UTILS}; mocking ${PDF} here would tie it to code it does not know: fix it in ${UTILS}.`,
    );
    expect(text).not.toContain('jest.mock(');
  });
});
