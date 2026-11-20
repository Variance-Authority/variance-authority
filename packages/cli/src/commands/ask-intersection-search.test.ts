import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, recordOfCases, testCoverageFile } from '@variance-authority/sense/test-selection';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';
import { askSource } from './ask.js';

/** A search operand keeps the whole search's candidates, before any section's display cap. */

const cwd = process.cwd();
let root: string;

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ask-search-membership-'));
  write('package.json', JSON.stringify({
    name: 'search-membership-fixture', private: true, workspaces: ['packages/*'], dependencies: { 'installed-fixture': '1.0.0' },
  }));
  write('.gitignore', 'node_modules/\n');
  write('src/base.ts', 'export const original = 1;\n');
  for (let n = 0; n < 32; n++) {
    const id = String(n).padStart(2, '0');
    write(`src/private/p${id}.ts`, 'const privateNeedle = 1;\nexport {};\n');
    write(`src/private-docs/p${id}.ts`, `/** Sweeps a bucket and its contents. */\nconst maintenance${id} = 1;\nexport {};\n`);
    write(`src/file-docs/f${id}.ts`, "/** Escalation ownership. */\n\nimport { original } from '../base';\nvoid original;\n");
    write(`src/held/h${id}.ts`, 'interface Hidden { heldNeedle(): void }\nfunction outer() { function nestedNeedle() {} }\nexport {};\n');
    write(`src/aliases/a${id}.ts`, "import { original as renamedNeedle } from '../base';\nvoid renamedNeedle;\n");
    write(`src/described/d${id}.ts`, `/** Sweeps a cache and its entries. */\nexport function retained${id}() {}\n`);
    write(`src/loose/l${id}.ts`, `export function connectTunnel${id}() {}\n`);
    write(`src/loose-private/l${id}.ts`, `function connectSocket${id}() {}\nexport {};\n`);
    write(`src/exported/e${id}.ts`, `export const exportNeedle${id} = 1;\n`);
    write(`src/tests/t${id}.test.ts`, 'export {};\n');
  }
  write('src/described/z-copy.ts', '/** Sweeps a cache and its entries. */\nexport function retained31() {}\n');
  write('src/exported/z-copy.ts', 'export const exportNeedle31 = 2;\n');
  const published = Array.from({ length: 42 }, (_, n) => {
    const id = String(n).padStart(2, '0');
    write(`packages/published/src/p${id}.ts`, `export const publicNeedle${id} = 1;\n`);
    return `export { publicNeedle${id} } from './src/p${id}';`;
  });
  write('packages/published/package.json', JSON.stringify({ name: 'published-fixture', exports: './index.ts' }));
  write('packages/published/index.ts', published.join('\n'));
  write('node_modules/installed-fixture/package.json', JSON.stringify({ name: 'installed-fixture', version: '1.0.0', types: 'index.d.ts' }));
  write('node_modules/installed-fixture/index.d.ts', 'export declare function remoteCandidate(): void;\n');
  write('src/consumer.ts', "import { remoteCandidate } from 'installed-fixture';\nremoteCandidate();\n");
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'fixture']);
  process.chdir(root);
  let errors = '';
  let output = '';
  const code = await main(['index'], { out: (text) => { output += text; }, err: (text) => { errors += text; } });
  expect(code, output + errors).toBe(EXIT_CLEAN);

  // Search reads test names directly; this cases-only record needs no journey preparation.
  const recording = testCoverageFile(root);
  mkdirSync(dirname(recording), { recursive: true });
  writeFileSync(recording, recordOfCases({ index: encodeExecutionIndex({
    tests: Array.from({ length: 32 }, (_, n) => ({
      id: String(n), file: `src/tests/t${String(n).padStart(2, '0')}.test.ts`, name: 'checkout permission handshake', stopped: false,
    })),
    modules: [],
  }) }));
});

afterAll(() => {
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
});

const search = (query: string) => askSource({ question: 'search', query });
const cross = (query: string, path: string) => askSource({ question: 'intersection', reports: [query, `discover --path '^${path}$'`] });

describe('the same search alone and as an intersection operand', () => {
  it.each([
    ['privateNeedle', 'src/private/p31.ts', 'line 1'],
    ['heldNeedle', 'src/held/h31.ts', 'line 1'],
    ['nestedNeedle', 'src/held/h31.ts', 'line 2'],
    ['renamedNeedle', 'src/aliases/a31.ts', 'line 1'],
    ['checkout permission handshake', 'src/tests/t31.test.ts', 'the file'],
    ['cache entries', 'src/described/d30.ts', 'line 2'],
    ['bucket contents', 'src/private-docs/p31.ts', 'line 2'],
    ['escalation ownership', 'src/file-docs/f31.ts', 'the file'],
    ['conect tunel', 'src/loose/l31.ts', 'line 1'],
    ['conect soket', 'src/loose-private/l31.ts', 'line 1'],
    ['exportNeedle', 'src/exported/e30.ts', 'line 1'],
    ['publicNeedle', 'packages/published/src/p41.ts', 'the file'],
  ])('keeps %s candidates beyond the displayed section', async (query, path, lines) => {
    const alone = await search(query);
    expect(alone).toContain('more');
    expect(alone).not.toContain(path);
    if (query === 'publicNeedle') expect(alone).toContain('42 published matches');
    const together = await cross(`search --query '${query}'`, path);
    expect(together).toContain('1 file in all of them.');
    expect(together).toContain(`${path} — 1: ${lines} · 2: the file`);
  });

  it.each([
    ['cache entries', 'src/described/z-copy.ts', 'line 2'],
    ['exportNeedle31', 'src/exported/z-copy.ts', 'line 1'],
  ])('keeps another matching file of a grouped name for %s', async (query, path, lines) => {
    const together = await cross(`search --query '${query}'`, path);
    expect(together).toContain(`${path} — 1: ${lines} · 2: the file`);
  });

  it('keeps all matching lines once, in ascending order', async () => {
    const together = await cross('search --query Needle --from src/held/h00.ts', 'src/held/h00.ts');
    expect(together).toContain('src/held/h00.ts — 1: lines 1, 2 · 2: the file');
  });

  it('excludes a matching declaration outside the query area', async () => {
    const together = await cross('search --query heldNeedle --from src/held/h00.ts', 'src/held/h31.ts');
    expect(together).toContain('1. `search --query heldNeedle --from src/held/h00.ts`: 1 file');
    expect(together).toContain('No file is in all of them.');
  });

  it('refuses a start point that resolves to no file', async () => {
    await expect(cross('search --query heldNeedle --from src/missing.ts', 'src/held/h00.ts')).rejects.toThrow(/searched nothing/);
  });

  it('keeps installed candidates out of the workspace file set', async () => {
    expect(await search('remoteCandidate')).toContain('installed-fixture');
    const together = await cross('search --query remoteCandidate', 'src/consumer.ts');
    expect(together).toContain('1. `search --query remoteCandidate`: 0 files');
    expect(together).toContain('No file is in all of them.');
  });
});
