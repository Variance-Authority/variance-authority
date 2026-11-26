/// <depends path="../bin.ts" />
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { afterEach, expect, it } from 'vitest';
import { recorded } from './ask-symbol-line.fixture.js';

/**
 * `symbol --line` through both entries: the executable finds the recordings
 * in Rust and the Node entry in TypeScript, so each way a recording can stand
 * is asked of both, and both must say the same thing about it.
 */

const manifest = new URL('../../package.json', import.meta.url);
const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: { variance: string } };
const executable = fileURLToPath(new URL(bin.variance, manifest));
const nodeEntry = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));
const cwd = process.cwd();
const cache = process.env.VARIANCE_AUTHORITY_CACHE;

afterEach(() => {
  process.chdir(cwd);
  if (cache === undefined) delete process.env.VARIANCE_AUTHORITY_CACHE;
  else process.env.VARIANCE_AUTHORITY_CACHE = cache;
});

it.each([
  { stands: 'at the commit the sources are written at', made: {} },
  { stands: 'naming no commit', made: { commit: false } },
  { stands: 'at a commit git does not hold', made: { commit: 'f'.repeat(40) } },
  { stands: 'nowhere', made: { recording: false } },
  { stands: 'where it does not open', made: { unopened: true } },
])('orders the declarations of a line by a recording $stands the same way through both entries', async ({ made }) => {
  process.env.VARIANCE_AUTHORITY_CACHE = mkdtempSync(join(tmpdir(), 'va-symbol-line-cache-'));
  const { unopened, ...recording } = { unopened: false, ...made };
  const root = await recorded(recording);
  try {
    if (unopened) chmodSync(testCoverageFile(root), 0);
    // Git and nothing else: a question the executable hands to Node fails here rather than being answered there.
    const gitOnly = join(root, 'git-only');
    mkdirSync(gitOnly);
    symlinkSync(spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim() + '/git', join(gitOnly, 'git'));
    const args = ['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3'];
    const env = { ...process.env, npm_config_user_agent: '' };
    const [node, rust] = [
      spawnSync(process.execPath, [nodeEntry, ...args], { cwd: root, env, encoding: 'utf8' }),
      spawnSync(executable, args, { cwd: root, env: { ...env, PATH: gitOnly }, encoding: 'utf8' }),
    ].map((answer) => [answer.status, answer.stdout, answer.stderr]);
    expect(node?.[0]).toBe(0);
    expect(rust).toEqual(node);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
