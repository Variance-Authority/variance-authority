import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readTree } from '@variance-authority/mcp/tools';
import { sourceIndexPath } from '@variance-authority/sense';
import { encodeExecutionIndex, encodeTestCoverage, recordOfCases, testCoverageFile } from '@variance-authority/sense/test-selection';
import { afterEach, expect, it, vi } from 'vitest';
import { readHelp } from '../walk.js';
import { discover } from './discover.js';
import { intersectionOf } from './intersection.js';
import { search } from './search.js';

// compass: variance-authority.report.agent-surface

const temporary: string[] = [];
const opaque = `const Quenfralob = 1; export {};\n${'// filler line\n'.repeat(80_000)}`;

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function fixture(extra: Readonly<Record<string, string>> = {}, config?: unknown) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-search-coverage-')));
  const cache = mkdtempSync(join(tmpdir(), 'va-search-coverage-cache-'));
  temporary.push(root, cache);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', cache);
  execFileSync('git', ['init', '--quiet', root]);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'search-coverage', private: true, exports: './src/index.ts' }));
  if (config !== undefined) writeFileSync(join(root, 'variance.config.json'), JSON.stringify(config));
  for (const [file, text] of Object.entries({ 'index.ts': 'export const Anchor = 1;\n', ...extra })) {
    writeFileSync(join(root, 'src', file), text);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  const tree = await readTree({ root });
  return { help: readHelp(root), invocation: { root, tree } };
}

it('keeps unread declarations on zero known matches and on the intersection that depends on them', async () => {
  const { help, invocation } = await fixture({ 'opaque.ts': opaque });
  const input = { query: 'Quenfralob', from: ['src/'] };
  const note = 'The declarations of 1 file were not read into the source index, so a name declared there is not known: src/opaque.ts.';
  expect(search.run(help, input, invocation)).toContain(note);
  const membership = search.files!(help, input, invocation);
  expect([...membership.files]).toEqual([]);
  expect(membership.unread).toContain(note);
  const intersection = intersectionOf([search, discover]);
  const questions = [{ question: 'search', input }, { question: 'discover', input: { path: '^src/opaque[.]ts$' } }];
  const common = intersection.files!(help, { questions }, invocation);
  expect([...common.files]).toEqual([]);
  expect(common.unread?.join('\n')).toContain(note);
  expect(intersection.run(help, { questions }, invocation)).toContain(note);
});

it('keeps every positive coordinate and its qualifications beside unread declarations, regardless of the display cap', async () => {
  const { help, invocation } = await fixture({
    'opaque.ts': opaque,
    'a.ts': 'const Quenfralob = 1; export {};\n',
    'b.ts': 'const Quenfralob = 2; export {};\n',
  });
  const membership = search.files!(help, { query: 'Quenfralob', limit: 1 }, invocation);
  expect([...membership.files]).toEqual([['src/a.ts', [1]], ['src/b.ts', [1]]]);
  expect(membership.qualifications).toBeUndefined();
  expect(membership.unread?.join('\n')).toContain('src/opaque.ts');
});

it('keeps the existing unsupported-member-language qualification', async () => {
  const { help, invocation } = await fixture({ 'widget.rs': 'pub struct Widget { pub completed: bool }\n' });
  const input = { query: 'completed' };
  expect(search.run(help, input, invocation)).toContain('Rust files were not read');
  expect(search.files!(help, input, invocation).unread?.join('\n')).toContain('Rust files were not read');
});

it.each([
  ['one-word export', 'completed', 'export const completed = true;\n'],
  ['multiword export', 'completed widgets', 'export const completedWidgets = true;\n'],
  ['private declaration', 'completed', 'const completed = true; export {};\n'],
  ['held function', 'completed', 'export function outer() { function completed() {} return completed; }\n'],
  ['member', 'completed', 'export interface Widget { completed: boolean; }\n'],
])('keeps unread member coverage beside a positive %s and its disjoint intersection', async (_kind, query, text) => {
  const { help, invocation } = await fixture({
    'index.ts': text,
    'widget.rs': 'pub struct Widget { pub completed: bool }\n',
    'separate.ts': 'export const Separate = true;\n',
  });
  const input = { query };
  const membership = search.files!(help, input, invocation);
  expect([...membership.files]).toEqual([['src/index.ts', [1]]]);
  expect(membership.unread?.join('\n')).toContain('Rust files were not read');
  expect(search.run(help, input, invocation)).toContain('Rust files were not read');
  const intersection = intersectionOf([search, discover]);
  const questions = [{ question: 'search', input }, { question: 'discover', input: { path: '^src/separate[.]ts$' } }];
  const common = intersection.files!(help, { questions }, invocation);
  expect([...common.files]).toEqual([]);
  expect(common.unread?.join('\n')).toContain('Rust files were not read');
  expect(intersection.run(help, { questions }, invocation)).toContain('Rust files were not read');
});

it('keeps the existing unresolved-import scope qualification beside a positive match', async () => {
  const { help, invocation } = await fixture({ 'index.ts': "import './missing';\nexport const Anchor = 1;\n" });
  const input = { query: 'Anchor', from: ['src/'] };
  expect(search.run(help, input, invocation)).toContain('what lies behind those is not enumerated');
  const membership = search.files!(help, input, invocation);
  expect([...membership.files.keys()]).toContain('src/index.ts');
  expect(membership.unread?.join('\n')).toContain('what lies behind those is not enumerated');
});

it('keeps a TypeScript-only search scope complete when unrelated Rust files exist', async () => {
  const { help, invocation } = await fixture({ 'widget.rs': 'pub struct Widget { pub completed: bool }\n' });
  for (const query of ['Anchor', 'completed']) {
    const input = { query, from: ['src/index.ts'] };
    const membership = search.files!(help, input, invocation);
    expect([...membership.files]).toEqual(query === 'Anchor' ? [['src/index.ts', [1]]] : []);
    expect(membership.unread).toBeUndefined();
    expect(search.run(help, input, invocation)).not.toContain('Rust files were not read');
  }
  const included = { query: 'Anchor', from: ['src/'] };
  expect(search.files!(help, included, invocation).unread?.join('\n')).toContain('Rust files were not read');
});

it('qualifies the whole declaration domain when no source index was read, keeping known exports', async () => {
  const { help, invocation } = await fixture();
  rmSync(sourceIndexPath(invocation.root));
  const membership = search.files!(help, { query: 'Anchor' }, invocation);
  expect([...membership.files.keys()]).toContain('src/index.ts');
  expect(membership.unread?.join('\n')).toContain('no source index was read');
});

it('leaves fully read source membership complete despite absent recording and dependency evidence', async () => {
  const { help, invocation } = await fixture();
  for (const input of [{ query: 'Anchor', from: ['src/'] }, { query: 'Quenfralob' }]) {
    expect(search.files!(help, input, invocation).unread).toBeUndefined();
  }
});

it('keeps the recorded cases it could not read on the file set, as its text does', async () => {
  const { help, invocation } = await fixture({}, { suites: 'nope' });
  const input = { query: 'Quenfralob' };
  const note = search.run(help, input, invocation).split('\n').find((line) => line.startsWith('No recorded case was read'));
  expect(note).toContain('variance.config.json');
  expect(search.files!(help, input, invocation).unread ?? []).toContain(note);
});

/** Lays `bytes` where the last run of `suite` leaves its record. */
function recorded(root: string, bytes: Uint8Array, suite?: string): void {
  const at = testCoverageFile(root, { suite });
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, bytes);
}

it('keeps a suite whose case index does not decode on the file set beside zero and positive matches, and on a disjoint intersection', async () => {
  const { help, invocation } = await fixture({ 'separate.ts': 'export const Separate = true;\n' }, { suites: { unit: { kind: 'unit' } } });
  recorded(invocation.root, recordOfCases({ index: Buffer.from('not an index') }), 'unit');
  const note = search.run(help, { query: 'Quenfralob' }, invocation).split('\n').find((line) => line.startsWith('No recorded case of `unit` was read'));
  expect(note).toBeDefined();
  for (const query of ['Quenfralob', 'Anchor']) expect(search.files!(help, { query }, invocation).unread ?? []).toContain(note);
  const intersection = intersectionOf([search, discover]);
  const questions = [{ question: 'search', input: { query: 'Anchor' } }, { question: 'discover', input: { path: '^src/separate[.]ts$' } }];
  const common = intersection.files!(help, { questions }, invocation);
  expect([...common.files]).toEqual([]);
  expect(common.unread?.join('\n')).toContain(note);
  expect(intersection.run(help, { questions }, invocation)).toContain(note);
});

it('names a record whose header does not read as unread, in its text and on its file set', async () => {
  const { help, invocation } = await fixture();
  recorded(invocation.root, Buffer.from('not a record'));
  const input = { query: 'Quenfralob' };
  const text = search.run(help, input, invocation);
  expect(text).not.toContain('no run kept its cases there');
  const note = text.split('\n').find((line) => line.startsWith('No recorded case was read'));
  expect(note).toBeDefined();
  expect(search.files!(help, input, invocation).unread ?? []).toContain(note);
});

it('leaves the file set complete beside a declared suite with no record and one that kept no cases', async () => {
  const { help, invocation } = await fixture({}, { suites: { unit: { kind: 'unit' }, e2e: { kind: 'e2e' }, site: { kind: 'e2e' } } });
  const tests = [{ id: '1', file: 'src/index.test.ts', name: 'reads the anchor', stopped: false }];
  recorded(invocation.root, recordOfCases({ index: encodeExecutionIndex({ tests, modules: [] }) }), 'unit');
  recorded(invocation.root, encodeTestCoverage({ version: 3, instrumentation: 'fixture', tests: [], modules: [] }), 'e2e');
  for (const query of ['Anchor', 'Quenfralob']) expect(search.files!(help, { query }, invocation).unread).toBeUndefined();
});
