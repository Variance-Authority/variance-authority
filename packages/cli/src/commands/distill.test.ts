import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encodeExecutionIndex,
  testCoverageFile,
  withCaseSections,
  writeTestCoverage,
} from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { distillFiles, formatDistill } from './distill.js';

const CASE = 'test/cart.spec.ts > adds one item';
const cwd = process.cwd();
const made: string[] = [];

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-distill-cache-'));
  made.push(process.env['VARIANCE_AUTHORITY_CACHE']);
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function checkout(): string {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-distill-')));
  made.push(root);
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

/** What a click on the cart's button leaves in a journal, addressed to `file`. */
function clicked(file: string) {
  return {
    complete: true,
    attention: [{
      kind: 'document-event', event: 'click', trusted: true, sequence: 0,
      target: { nodeName: 'button', provenance: { status: 'resolved', provenance: {
        owners: [{ name: 'Cart', propsDigest: 'cart' }],
        source: { file, line: 3, column: 1 },
      } } },
    }],
  };
}

/** The checkout's own record: one case, its crossings, and, when given, its journals. */
async function recorded(root: string, journals?: readonly unknown[], watched = [CASE]): Promise<string> {
  const at = testCoverageFile(root);
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [{ file: 'test/cart.spec.ts', complete: true, preconditions: [] }],
    modules: [],
  });
  const block = { kind: 'function' as const, name: 'Cart', path: 'entry', startLine: 1, endLine: 9, source: true };
  writeFileSync(at, withCaseSections(readFileSync(at), {
    index: encodeExecutionIndex({
      tests: [{ id: CASE, file: 'test/cart.spec.ts', name: 'adds one item' }],
      modules: [
        { file: 'src/cart.tsx', blocks: [{ ...block, crossings: [{ test: 0, distance: 1 }] }] },
        { file: 'src/price.ts', blocks: [{ ...block, name: 'price', crossings: [{ test: 0, distance: 2 }] }] },
      ],
    }),
    ...(journals === undefined ? {} : {
      eyes: Buffer.from(`${JSON.stringify({ version: 1, watched, journals })}\n`),
    }),
  }));
  return at;
}

const plain = {
  tests: [{ id: 'plain', file: 'plain.test.ts', name: 'works' }],
  modules: [{ file: 'plain.ts', blocks: [{
    kind: 'function', name: 'work', path: 'entry', startLine: 1, endLine: 2,
    source: true, crossings: [{ test: 0, distance: 1 }],
  }] }],
};

/** A record at `at` holding `execution` as its case index, and no journals. */
async function indexed(at: string, execution: typeof plain): Promise<void> {
  await writeTestCoverage(at, {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [{ file: 'plain.test.ts', complete: true, preconditions: [] }],
    modules: [],
  });
  writeFileSync(at, withCaseSections(readFileSync(at), { index: encodeExecutionIndex(execution) }));
}

describe('the CLI distillation boundary', () => {
  it('reads the checkout\'s own record, every attempt of the case named', async () => {
    const root = checkout();
    await recorded(root, [
      { case: CASE, attempt: 1, journal: clicked('src/cart.tsx') },
      { case: CASE, attempt: 2, journal: clicked('src/cart.tsx') },
    ]);

    const result = await distillFiles({ test: CASE, root });

    expect(result.attempts?.map((attempt) => attempt.attempt)).toEqual([1, 2]);
    // The record's paths are relative to the checkout on both sides, and join.
    expect(result.execution.opportunities).toEqual([{ file: 'src/price.ts', distance: 2 }]);
    const text = formatDistill(result, 'text');
    expect(text).toContain('Eyes journal, attempt 1: complete.');
    expect(text).toContain('Eyes journal, attempt 2: complete.');
  });

  it('reads a record that kept no journals as one without Eyes', async () => {
    const root = checkout();
    await recorded(root);
    const result = await distillFiles({ test: CASE, root });
    expect(result.attempts).toBeUndefined();
    expect(formatDistill(result, 'text')).toContain('the record keeps no Eyes journals');
  });

  it('tells a case its run did not watch from a watched case that handed no journal', async () => {
    const root = checkout();
    await recorded(root, [], []);
    const unwatched = formatDistill(await distillFiles({ test: CASE, root }), 'text');
    expect(unwatched).toContain('this case\'s run did not opt into Eyes.');
    // One reason, said once: an unwatched case is not a watched one missing its journal.
    expect(unwatched).not.toContain('keeps no Eyes journal for this case');
    await recorded(root, []);
    expect(formatDistill(await distillFiles({ test: CASE, root }), 'text'))
      .toContain('the record keeps no Eyes journal for this case.');
  });

  it('names the case by its file and a part of its title, and reads its journals by id', async () => {
    const root = checkout();
    await recorded(root, [{ case: CASE, attempt: 1, journal: clicked('src/cart.tsx') }]);

    const answer = await run(['distill', '--file', 'cart.spec', '--test', 'one item', '--format', 'json']);

    expect(answer.code).toBe(EXIT_CLEAN);
    expect(JSON.parse(answer.out).test.id).toBe(CASE);
    expect(JSON.parse(answer.out).attempts).toHaveLength(1);
  });

  it('refuses a name no recorded case has', async () => {
    const root = checkout();
    await recorded(root);
    await expect(distillFiles({ test: 'removes one item', root }))
      .rejects.toThrow('The record holds no case matching `removes one item`.');
  });

  it('refuses as `unrecorded` when nothing is recorded', async () => {
    const root = checkout();

    const answer = await run(['distill', '--test', 'plain']);

    expect(answer.code).toBe(EXIT_OPERATOR);
    expect(answer.err).toContain(`nothing is recorded in \`${root}\``);
  });

  it('reads the record of the suite `--suite` names', async () => {
    const root = checkout();
    writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' }, e2e: { kind: 'e2e' } } }));
    const unit = { ...plain, modules: [{ ...plain.modules[0]!, file: 'unit.ts' }] };
    const e2e = { ...plain, modules: [{ ...plain.modules[0]!, file: 'e2e.ts' }] };
    await indexed(testCoverageFile(root, { suite: 'unit' }), unit);
    await indexed(testCoverageFile(root, { suite: 'e2e' }), e2e);

    const answer = await run(['distill', '--test', 'plain', '--suite', 'unit', '--format', 'json']);

    expect(answer.code).toBe(EXIT_CLEAN);
    expect(JSON.parse(answer.out).execution.entered).toEqual([{ file: 'unit.ts', distance: 1 }]);
  });

  it('asks for `--suite`, naming the declared suites, when several are declared and none is named', async () => {
    const root = checkout();
    writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' }, e2e: { kind: 'e2e' } } }));

    const answer = await run(['distill', '--test', 'plain']);

    expect(answer.code).toBe(EXIT_OPERATOR);
    expect(answer.err).toContain('declares the suites "e2e", "unit", and each records on its own; pass `--suite <name>`');
  });

  it('reads the only declared suite when none is named', async () => {
    const root = checkout();
    writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
    await indexed(testCoverageFile(root, { suite: 'unit' }), { ...plain, modules: [{ ...plain.modules[0]!, file: 'unit.ts' }] });

    const answer = await run(['distill', '--test', 'plain', '--format', 'json']);

    expect(answer.code).toBe(EXIT_CLEAN);
    expect(JSON.parse(answer.out).execution.entered).toEqual([{ file: 'unit.ts', distance: 1 }]);
  });

  it('reads a case index named with --execution, which carries no journals', async () => {
    const root = checkout();
    const execution = join(root, 'execution.json');
    writeFileSync(execution, JSON.stringify(plain));

    const result = await distillFiles({ test: 'plain', execution, root });

    expect(result.execution.entered).toEqual([{ file: 'plain.ts', distance: 1 }]);
    expect(result.execution.opportunities).toBeUndefined();
    expect(formatDistill(result, 'json')).toContain('"entered"');
  });

  it('reads a test file alone: what it loaded, how many of its cases entered each module, and the import, static or lazy, behind each load', async () => {
    const root = checkout();
    const at = testCoverageFile(root);
    const root0 = (file: string, endLine: number) => ({
      ordinal: 0, kind: 'module' as const, digest: `${file}#0`, name: '', path: '', source: true,
      testFiles: ['test/cart.spec.ts'], loadedBy: ['test/cart.spec.ts'], startLine: 1, endLine,
    });
    // The function lies below every source line, so no top-level reference reads as run by a case.
    const fn = (file: string, name: string) => ({
      ordinal: 1, kind: 'function' as const, owner: 0, digest: `${file}#1`, name, path: name, source: true,
      testFiles: ['test/cart.spec.ts'], startLine: 4, endLine: 9,
    });
    await writeTestCoverage(at, {
      version: 3,
      instrumentation: 'fixture-instrumentation',
      tests: [{ file: 'test/cart.spec.ts', complete: true, preconditions: [] }],
      modules: ['src/cart.tsx', 'src/checkout-dialog.tsx', 'src/heavy-chart.tsx', 'src/rich-editor.tsx', 'src/locale-en.tsx'].map((file, at) => ({
        file, sourceDigest: file, instrumented: true, blocks: [root0(file, 10 * (at + 1)), fn(file, 'main')],
      })),
    });
    const block = { kind: 'function', name: 'main', path: 'main', startLine: 4, endLine: 9, source: true };
    writeFileSync(at, withCaseSections(readFileSync(at), {
      index: encodeExecutionIndex({
        tests: [
          { id: CASE, file: 'test/cart.spec.ts', name: 'adds one item', stopped: false },
          { id: 'test/cart.spec.ts > checks out', file: 'test/cart.spec.ts', name: 'checks out', stopped: false },
        ],
        modules: [
          { file: 'src/cart.tsx', blocks: [{ ...block, crossings: [{ test: 0, distance: 0 }, { test: 1, distance: 0 }] }] },
          { file: 'src/checkout-dialog.tsx', blocks: [{ ...block, crossings: [{ test: 1, distance: 0 }] }] },
        ],
      }),
    }));

    // The source the file graph is read from: the cart brought the chart in, the dialog brought the editor in
    // when a case opened it, and no case drew either. A template literal leaves no edge, even with no substitution.
    const sources = {
      'test/cart.spec.ts': "import { Cart } from '../src/cart';\n",
      'src/cart.tsx': "import { Dialog } from './checkout-dialog';\nimport { Chart } from './heavy-chart';\nexport const Cart = [Dialog, Chart];\n",
      'src/checkout-dialog.tsx': "import { lazy } from 'react';\nexport const Dialog = lazy(() => import('./rich-editor'));\nexport const locale = () => import(`./locale-en`);\n",
      'src/locale-en.tsx': 'export const words = {};\n',
      'src/rich-editor.tsx': 'export const Editor = 1;\n',
      'src/heavy-chart.tsx': 'export const Chart = 1;\n',
    };
    mkdirSync(join(root, 'test'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules/pad'), { recursive: true });
    for (const [file, text] of Object.entries(sources)) writeFileSync(join(root, file), text);
    execFileSync('git', ['add', 'test', 'src'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'source'], { cwd: root, stdio: 'pipe' });
    // Published as a pipeline publishes it: under CI a reader refuses to build the index itself.
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const answer = await run(['distill', '--file', 'cart.spec']);

    expect(answer.code).toBe(EXIT_CLEAN);
    expect(answer.out).toContain('test/cart.spec.ts: 2 case(s); 5 loaded module(s) declare functions.');
    expect(answer.out).toContain([
      'Loaded, and entered by no case: 3 module(s), 120 line(s).',
      '  src/checkout-dialog.tsx lazily imports src/rich-editor.tsx: 1 module(s), 40 line(s)',
      '    src/rich-editor.tsx — 40 line(s)',
      '  src/cart.tsx imports src/heavy-chart.tsx: 1 module(s), 30 line(s)',
      '    src/cart.tsx reads Chart from src/heavy-chart.tsx at line 3 when it loads: move that reference into the function that needs it.',
      '    src/heavy-chart.tsx — 30 line(s)',
      '  No import the graph reads reaches these from the test file: 1 module(s), 50 line(s)',
      '    src/locale-en.tsx — 50 line(s)',
    ].join('\n'));
    expect(answer.out).toContain('  src/checkout-dialog.tsx — 20 line(s), entered by 1 of 2 case(s)');
    expect(answer.out).not.toContain('src/cart.tsx —');
    const json = JSON.parse((await run(['distill', '--file', 'cart.spec', '--format', 'json'])).out);
    expect(json.modules).toEqual([
      { file: 'src/locale-en.tsx', lines: 50, entered: 0, cause: { kind: 'unseen' } },
      {
        file: 'src/rich-editor.tsx', lines: 40, entered: 0,
        cause: { kind: 'import', importer: 'src/checkout-dialog.tsx', imported: 'src/rich-editor.tsx', lazy: true },
      },
      {
        file: 'src/heavy-chart.tsx', lines: 30, entered: 0,
        // The cart writes `[Dialog, Chart]` when it loads, so every test file that loads the cart loads the chart.
        cause: { kind: 'import', importer: 'src/cart.tsx', imported: 'src/heavy-chart.tsx', charge: { kind: 'load', line: 3, name: 'Chart' }, reach: 'subject', exports: ['Chart'] },
      },
      { file: 'src/checkout-dialog.tsx', lines: 20, entered: 1 },
    ]);
  });

  it('reads a test file\'s mocks against the file graph though every load was used: one of nothing it loads, one past its subject\'s imports', async () => {
    const root = checkout();
    const at = testCoverageFile(root);
    await writeTestCoverage(at, {
      version: 3,
      instrumentation: 'fixture-instrumentation',
      tests: [{ file: 'test/cart.spec.ts', complete: true, preconditions: [] }],
      modules: [{
        file: 'src/cart.tsx', sourceDigest: 'src/cart.tsx', instrumented: true, blocks: [
          { ordinal: 0, kind: 'module', digest: 'cart#0', name: '', path: '', source: true, testFiles: ['test/cart.spec.ts'], loadedBy: ['test/cart.spec.ts'], startLine: 1, endLine: 4 },
          { ordinal: 1, kind: 'function', owner: 0, digest: 'cart#1', name: 'main', path: 'main', source: true, testFiles: ['test/cart.spec.ts'], startLine: 3, endLine: 3 },
        ],
      }],
    });
    writeFileSync(at, withCaseSections(readFileSync(at), {
      index: encodeExecutionIndex({
        tests: [{ id: CASE, file: 'test/cart.spec.ts', name: 'adds one item', stopped: false }],
        modules: [{ file: 'src/cart.tsx', blocks: [{ kind: 'function', name: 'main', path: 'main', startLine: 3, endLine: 3, source: true, crossings: [{ test: 0, distance: 0 }] }] }],
      }),
    }));
    // The cart imports the api, which imports the client: the client is an internal of the api.
    const sources = {
      'test/cart.spec.ts': "import { Cart } from '../src/cart';\njest.mock('../src/legacy', () => ({}));\njest.mock('../src/client', () => ({}));\njest.mock('pad');\n",
      'node_modules/pad/package.json': '{"name":"pad","main":"index.js"}',
      'node_modules/pad/index.js': 'module.exports = 1;\n',
      'src/cart.tsx': "import { api } from './api';\nexport const Cart = api;\nexport function main() {}\n",
      'src/api.ts': "import { client } from './client';\nimport pad from 'pad';\nexport const api = client + pad;\n",
      'src/client.ts': 'export const client = 1;\n',
      'src/legacy.ts': 'export const old = 1;\n',
    };
    mkdirSync(join(root, 'test'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules/pad'), { recursive: true });
    for (const [file, text] of Object.entries(sources)) writeFileSync(join(root, file), text);
    execFileSync('git', ['add', 'test', 'src'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'source'], { cwd: root, stdio: 'pipe' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const answer = await run(['distill', '--file', 'cart.spec']);

    expect(answer.code).toBe(EXIT_CLEAN);
    expect(answer.out).toContain([
      'error: test/cart.spec.ts mocks src/legacy.ts, which it does not load, directly or through anything it imports: ' +
        'the mock replaces nothing. Delete it.',
      'warning: test/cart.spec.ts mocks src/client.ts, 3 imports away; src/api.ts imports it, and test/cart.spec.ts does not ' +
        'import src/api.ts. Mock the import of the subject that loads it, or fix src/api.ts.',
    ].join('\n'));
    // A package is not a file of the graph: its mock is not judged, rather than read as one the file does not load.
    expect(answer.out).not.toContain('pad');
  });

  it('refuses a file reading of a case index named with --execution, which keeps no loads', async () => {
    const root = checkout();
    const execution = join(root, 'execution.json');
    writeFileSync(execution, JSON.stringify(plain));

    const answer = await run(['distill', '--file', 'plain', '--execution', execution]);

    expect(answer.code).toBe(EXIT_OPERATOR);
    expect(answer.err).toContain('holds no coverage rows, which say what a test file loaded; name a case with --test');
  });

  it('reports a record whose coverage rows are damaged as damaged, not as keeping none', async () => {
    const root = checkout();
    const at = join(root, 'damaged.bin');
    await indexed(at, plain);
    // The header names each section; one coverage section renamed in place is
    // one the decoder must find and cannot, while the case index still reads.
    const bytes = readFileSync(at);
    const header = bytes.readUInt32LE(0);
    const head = bytes.toString('utf8', 4, 4 + header).replace('"tests.complete"', '"tests.completE"');
    writeFileSync(at, Buffer.concat([bytes.subarray(0, 4), Buffer.from(head, 'utf8'), bytes.subarray(4 + header)]));

    const answer = await run(['distill', '--file', 'plain', '--execution', at]);

    expect(answer.code).toBe(EXIT_OPERATOR);
    expect(answer.err).not.toContain('holds no coverage rows');
  });

  it('takes the recorded index or a named one, never both', async () => {
    checkout();

    const answer = await run(['distill', '--test', 'plain', '--suite', 'unit', '--execution', 'x.json']);

    expect(answer.code).toBe(EXIT_OPERATOR);
    expect(answer.err).toContain('--execution');
  });
});
