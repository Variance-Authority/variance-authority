import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readTree } from '@variance-authority/mcp/tools';
import { asOneQuestion } from '@variance-authority/sense';
import { encodeExecutionIndex, recordOfCases, testCoverageFile } from '@variance-authority/sense/test-selection';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readWorkspace } from '../read.js';
import { searchIndexOf, workspaceGeneration } from '../snapshot.js';
import * as snapshots from '../snapshot.js';
import { outlived } from '../caught-up.js';
import { printedFiles, search } from './search.js';

// compass: variance-authority.report.agent-surface

const reads = vi.hoisted(() => ({ matching: 0, importing: 0, declaring: 0 }));
vi.mock('@variance-authority/sense', async (actual) => {
  const sense = await actual<typeof import('@variance-authority/sense')>();
  return {
    ...sense,
    declaredOf: (...args: Parameters<typeof sense.declaredOf>) => { reads.matching += 1; return sense.declaredOf(...args); },
    importersOf: (...args: Parameters<typeof sense.importersOf>) => { reads.importing += 1; return sense.importersOf(...args); },
    declarationExported: (...args: Parameters<typeof sense.declarationExported>) => { reads.declaring += 1; return sense.declarationExported(...args); },
  };
});

let root: string;
let cache: string;
let tree: Awaited<ReturnType<typeof readTree>>;
const before = process.env['VARIANCE_AUTHORITY_CACHE'];
const input = { query: 'cache entries', limit: 1 };

function write(at: string, text: string): void {
  mkdirSync(dirname(join(root, at)), { recursive: true });
  writeFileSync(join(root, at), text);
}

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'va-search-question-')));
  cache = mkdtempSync(join(tmpdir(), 'va-search-question-cache-'));
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  write('package.json', JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  write('packages/kit/package.json', JSON.stringify({ name: '@own/kit', exports: './index.ts' }));
  write('packages/app/package.json', JSON.stringify({ name: '@own/app', dependencies: { '@own/kit': '*' } }));
  write('packages/app/index.ts', "import { archiveSafely00 } from '@own/kit';\narchiveSafely00();\n");
  const exports: string[] = [];
  for (let n = 0; n < 12; n += 1) {
    const id = String(n).padStart(2, '0');
    write(`packages/kit/src/p${id}.ts`, `/** Sweeps cache entries and archives safely. */\nexport function archiveSafely${id}() {}\n`);
    write(`src/private/p${id}.ts`, `/** Sweeps cache entries. */\nconst retained${id} = 1;\nexport {};\n`);
    write(`src/loose/l${id}.ts`, `export function connectTunnel${id}() {}\n`);
    write(`src/grouped/g${id}.ts`, 'export function sharedGateway() {}\n');
    exports.push(`export { archiveSafely${id} } from './src/p${id}.js';`);
  }
  write('packages/kit/index.ts', exports.join('\n'));
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await readWorkspace(root);
  tree = await readTree({ root });
});

afterAll(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
  rmSync(root, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
});

it.each(['archiveSafely00', 'cache entries', 'conect tunel'].flatMap((query) =>
  ['files', 'run', 'files-run', 'run-files'].map((mode) => ({ query, mode })),
))('evaluates $query once for $mode, with enrichment only when text is requested', async ({ query, mode }) => {
  const asked = { query, limit: 1 };
  const invocation = { root, tree };
  const control = await readWorkspace(root);
  const answer = asOneQuestion(() => search.run(control, asked, invocation));
  const membership = asOneQuestion(() => search.files!(control, asked, invocation));
  const help = await readWorkspace(root);
  const names = vi.spyOn(searchIndexOf(help), 'namesContaining');
  reads.matching = reads.importing = reads.declaring = 0;

  asOneQuestion(() => {
    for (const operation of mode.split('-')) {
      if (operation === 'files') {
        expect(search.files!(help, asked, invocation)).toEqual(membership);
        if (mode.startsWith('files')) expect([reads.importing, reads.declaring]).toEqual([0, 0]);
      } else {
        expect(search.run(help, asked, invocation)).toBe(answer);
        const counted = { ...reads };
        expect(printedFiles(help, asked, invocation).size).toBeGreaterThan(0);
        expect(reads).toEqual(counted);
      }
    }
  });
  expect(names.mock.calls).toEqual([[query.toLowerCase()]]);
  expect(reads.matching).toBe(1);
  expect(reads.importing).toBe(mode.includes('run') ? 1 : 0);
  expect(reads.declaring).toBe(mode.includes('run') && query === 'conect tunel' ? 1 : 0);
  names.mockRestore();
});

it('reads changed recorded cases in the next question with the same Help and invocation', async () => {
  const help = await readWorkspace(root);
  const invocation = { root, tree };
  const asked = { query: 'checkout permission handshake' };
  const recording = testCoverageFile(root);
  mkdirSync(dirname(recording), { recursive: true });
  const record = (file: string): void => writeFileSync(recording, recordOfCases({ index: encodeExecutionIndex({
    tests: [{ id: '1', file, name: asked.query, stopped: false }], modules: [],
  }) }));
  record('src/old.test.ts');
  expect(asOneQuestion(() => search.run(help, asked, invocation))).toContain('src/old.test.ts');

  record('src/new.test.ts');
  asOneQuestion(() => {
    expect([...search.files!(help, asked, invocation).files]).toEqual([['src/new.test.ts', []]]);
    expect(search.run(help, asked, invocation)).toContain('src/new.test.ts');
  });
});

it('does not retain a prepared match outside a question or after a question throws', async () => {
  const help = await readWorkspace(root);
  const invocation = { root, tree };
  const names = vi.spyOn(searchIndexOf(help), 'namesContaining');
  expect(() => asOneQuestion(() => {
    search.run(help, input, invocation);
    throw new Error('question stopped');
  })).toThrow('question stopped');
  search.run(help, input, invocation);
  search.run(help, input, invocation);
  asOneQuestion(() => {
    search.files!(help, input, invocation);
    asOneQuestion(() => search.run(help, input, invocation));
  });
  expect(names).toHaveBeenCalledTimes(4);
  names.mockRestore();
});

it('visits uncapped grouped coordinates only when membership is requested', async () => {
  const help = await readWorkspace(root);
  const index = searchIndexOf(help);
  const coordinates = vi.spyOn(index, 'exportedAt');
  const asked = { query: 'sharedGateway', limit: 1 };
  asOneQuestion(() => {
    expect(search.run(help, asked, { root, tree })).toContain('sharedGateway');
    expect(coordinates).not.toHaveBeenCalled();
    const files = search.files!(help, asked, { root, tree });
    expect(files.files.size).toBe(12);
    expect(coordinates).toHaveBeenCalledTimes(12);
    expect(search.files!(help, asked, { root, tree })).toEqual(files);
    expect(coordinates).toHaveBeenCalledTimes(12);
  });
  coordinates.mockRestore();
});

it('keeps the question, cap, area, root and Tree separate inside one question', async () => {
  const help = await readWorkspace(root);
  const otherTree = { ...tree };
  const variants = [
    { asked: input, invocation: { root, tree } },
    { asked: { ...input, query: 'CACHE entries' }, invocation: { root, tree } },
    { asked: { ...input, limit: 2 }, invocation: { root, tree } },
    { asked: { ...input, from: 'packages/kit/src/p00.ts' }, invocation: { root, tree } },
    { asked: { ...input, to: 'packages/kit/src/p00.ts' }, invocation: { root, tree } },
    { asked: input, invocation: { tree } },
    { asked: input, invocation: { root, tree: otherTree } },
  ];
  const controls = variants.map(({ asked, invocation }) => search.run(help, asked, invocation));
  const names = vi.spyOn(searchIndexOf(help), 'namesContaining');
  asOneQuestion(() => {
    for (let repeat = 0; repeat < 2; repeat += 1) {
      variants.forEach(({ asked, invocation }, at) => expect(search.run(help, asked, invocation)).toBe(controls[at]));
    }
  });
  expect(names).toHaveBeenCalledTimes(variants.length);
  names.mockRestore();
});

it('keeps Help, SearchIndex and effective source-index scope separate', async () => {
  const help = await readWorkspace(root);
  const other = await readWorkspace(root);
  const first = searchIndexOf(help);
  const second = searchIndexOf(other);
  const firstNames = vi.spyOn(first, 'namesContaining');
  const secondNames = vi.spyOn(second, 'namesContaining');
  const original = snapshots.searchIndexOf;
  let selected = first;
  const index = vi.spyOn(snapshots, 'searchIndexOf').mockImplementation((value) => value === help ? selected : original(value));
  const source = vi.spyOn(snapshots, 'publishedSourceIndex');
  asOneQuestion(() => {
    search.files!(help, input, { root, tree });
    search.files!(other, input, { root, tree });
    selected = second;
    search.files!(help, input, { root, tree });
    source.mockReturnValue({ index: 'another-index', within: '' });
    search.files!(help, input, { root, tree });
    source.mockReturnValue({ index: 'another-index', within: 'nested' });
    search.files!(help, input, { root, tree });
    search.files!(help, input, { root, tree });
  });
  expect(firstNames).toHaveBeenCalledTimes(1);
  expect(secondNames).toHaveBeenCalledTimes(4);
  source.mockRestore();
  index.mockRestore();
  firstNames.mockRestore();
  secondNames.mockRestore();
});

it('checks the rendered footprint after an await and rematches the next answer', async () => {
  const help = await readWorkspace(root);
  const invocation = { root, tree };
  const names = vi.spyOn(searchIndexOf(help), 'namesContaining');
  asOneQuestion(() => search.run(help, input, invocation));
  expect(await outlived(search.name, help, input, invocation, Date.parse(workspaceGeneration(help)!) + 1)).toBe(false);
  expect(names).toHaveBeenCalledTimes(1);
  asOneQuestion(() => search.run(help, input, invocation));
  expect(names).toHaveBeenCalledTimes(2);
  names.mockRestore();
});
