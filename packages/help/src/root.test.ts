import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orient } from './tools/orient.js';
import { slowestTests } from './tools/slowest-tests.js';

/**
 * The checkout a question reads is the one the host was started on, never the
 * directory the process happens to stand in.
 *
 * `slowest-tests` and `orient` open what a checkout published, and a tool
 * cannot know a checkout by itself. So the host names it on every call, and a
 * call that names none is refused: reading the working directory instead
 * answers about whichever repository the client launched the server from, in
 * text indistinguishable from the right answer.
 */

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

let cache: string;
let elsewhere: string;
const made: string[] = [];

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'va-root-cache-'));
  elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'va-root-elsewhere-')));
  made.push(cache, elsewhere);
});

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A checkout with one recorded, timed test file, keyed in `cache` by its own path. */
async function recorded(): Promise<string> {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-root-')));
  made.push(root);
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  writeFileSync(join(root, 'package.json'), '{"name":"root-fixture","private":true}\n');
  const previous = process.env['XDG_CACHE_HOME'];
  process.env['XDG_CACHE_HOME'] = cache;
  try {
    await writeTestCoverage(testCoverageFile(root), {
      version: 3,
      instrumentation: 'fixture-instrumentation',
      tests: [{ file: 'test/slow.test.ts', complete: true, preconditions: [], duration: 2400 }],
      modules: [],
    });
  } finally {
    if (previous === undefined) delete process.env['XDG_CACHE_HOME'];
    else process.env['XDG_CACHE_HOME'] = previous;
  }
  return root;
}

const env = (): NodeJS.ProcessEnv => ({ ...process.env, XDG_CACHE_HOME: cache });

describe('a tool that reads a checkout', () => {
  it('refuses a call whose host named no checkout, rather than reading the working directory', () => {
    expect(() => slowestTests.run(undefined, {})).toThrow(/named no checkout/);
    expect(() => orient.run(undefined, { files: ['a.ts'] })).toThrow(/named no checkout/);
  });
});

describe('variance-authority-help --root', () => {
  it('answers about the root it was given, from any working directory', async () => {
    const root = await recorded();

    const answer = execFileSync('node', [BIN, 'slowest-tests', '--root', root], { cwd: elsewhere, env: env(), encoding: 'utf8' });

    expect(answer).toContain('2.4 s  test/slow.test.ts');
  });

  it('serves the root it was started on over MCP, from any working directory', async () => {
    const root = await recorded();
    const server = spawn('node', [BIN, root], { cwd: elsewhere, env: env(), stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      const answered = new Promise<string>((resolve, reject) => {
        let out = '';
        server.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString();
          const line = out.split('\n').find((candidate) => candidate.includes('"id":1'));
          if (line !== undefined) resolve((JSON.parse(line) as { result: { content: { text: string }[] } }).result.content[0]!.text);
        });
        server.on('exit', (code) => reject(new Error(`the server exited with ${String(code)} before answering`)));
      });
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'docs_slowest_tests' } })}\n`);

      expect(await answered).toContain('2.4 s  test/slow.test.ts');
    } finally {
      server.kill();
    }
  });
});
