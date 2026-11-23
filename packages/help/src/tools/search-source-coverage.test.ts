import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTree } from '@variance-authority/mcp/tools';
import { sourceIndexPath } from '@variance-authority/sense';
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

async function fixture(extra: Readonly<Record<string, string>> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-search-coverage-')));
  const cache = mkdtempSync(join(tmpdir(), 'va-search-coverage-cache-'));
  temporary.push(root, cache);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', cache);
  execFileSync('git', ['init', '--quiet', root]);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'search-coverage', private: true, exports: './src/index.ts' }));
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
