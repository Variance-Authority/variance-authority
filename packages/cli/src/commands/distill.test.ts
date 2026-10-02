import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { encodeExecutionIndex, testCoverageFile } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { distillFiles, formatDistill } from './distill.js';

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-distill-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

function checkout(): string {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-distill-')));
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

const plain = {
  tests: [{ id: 'plain', file: 'plain.test.ts', name: 'works' }],
  modules: [{ file: 'plain.ts', blocks: [{
    kind: 'function', name: 'work', path: 'entry', startLine: 1, endLine: 2,
    source: true, crossings: [{ test: 0, distance: 1 }],
  }] }],
};

describe('the CLI distillation boundary', () => {
  it('reads execution JSON without a project config and preserves missing attention', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'variance-distill-'));
    const execution = join(dir, 'execution.json');
    await writeFile(execution, JSON.stringify(plain));

    const result = await distillFiles({ test: 'plain', execution });

    expect(result.execution?.entered).toEqual([{ file: 'plain.ts', distance: 1 }]);
    expect(result.execution?.opportunities).toBeUndefined();
    expect(formatDistill(result, 'json')).toContain('"entered"');
  });

  it('reads the index a recorded run left when no `--execution` is named', async () => {
    const at = testCoverageFile(checkout());
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(`${at}.cases.bin`, encodeExecutionIndex(plain));

    const answer = await run(['distill', '--test', 'plain', '--format', 'json']);

    expect(answer.code).toBe(EXIT_CLEAN);
    expect(JSON.parse(answer.out).execution.entered).toEqual([{ file: 'plain.ts', distance: 1 }]);
  });

  it('refuses as `unrecorded` when nothing is recorded and no Eyes archive is named', async () => {
    const root = checkout();

    const answer = await run(['distill', '--test', 'plain']);

    expect(answer.code).toBe(EXIT_OPERATOR);
    expect(answer.err).toContain(`nothing is recorded in \`${root}\``);
  });

  it('takes the recorded index or a named one, never both', async () => {
    checkout();

    const answer = await run(['distill', '--test', 'plain', '--suite', 'unit', '--execution', 'x.json']);

    expect(answer.code).toBe(EXIT_OPERATOR);
    expect(answer.err).toContain('--execution');
  });
});
