/// <depends path="../bin.ts" />
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { sourceIndexPath } from '@variance-authority/sense';
import { encodeAsSetExecutionIndex, recordOfCases, testCoverageFile } from '@variance-authority/sense/test-selection';
import { FLAG_KITS, nativeFiles } from './ask-native.fixture.js';
import { checkout, run } from './ask-packages.fixture.js';

const manifest = new URL('../../package.json', import.meta.url);
const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: { variance: string } };
const executable = fileURLToPath(new URL(bin.variance, manifest));
const nodeEntry = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));

it.each([
  { question: ['packages'], contains: 'packages that declare no entry are imported by path' },
  { question: ['packages', '--limit', '1'], contains: '1 more not shown; `--offset` 1 shows the next 1.' },
  { question: ['packages', '--limit=1', '--offset=1'], contains: 'Rows 2–2 of 2.' },
  { question: ['entrypoint', '--package', '@acme/lib'], contains: '@acme/lib — 2 names' },
  { question: ['entrypoint', '--package', '@acme/lib/src/internal/math'], contains: 'By name, most imported first:' },
  { question: ['entrypoint', '--package', '@acme/tools-only'], contains: 'opens no main entry' },
  { question: ['entrypoint', '--package=@acme/tools-only', '--subpath=./tools'], contains: '@acme/tools-only/tools — 2 names' },
  { question: ['entrypoint', '--package', '@acme/kit'], contains: 'declares no entry' },
  { question: ['entrypoint', '--package', '@acme/kit/src/money/tax'], contains: 'from @acme/kit/src/money/tax by path' },
  { question: ['entrypoint', '--package', '@acme/unfollowed'], contains: 'declares an entry this reading could not follow' },
  { question: ['entrypoint', '--package', '@acme/lib/missing'], contains: 'does not open `./missing`' },
  { question: ['search', '--query', 'greet'], contains: 'greet' },
  { question: ['search', '--query', 'taxOf'], contains: 'taxOf' },
  { question: ['search', '--query', 'levy'], contains: 'The levy on an amount.' },
  { question: ['search', '--query', 'read checkout'], contains: '1 exported match for `read checkout`' },
  { question: ['search', '--query', 'levy on an amount'], contains: 'The levy on an amount.' },
  { question: ['search', '--query', 'greot'], contains: '1 more name matches loosely' },
  { question: ['search', '--query', 'unknownExactName'], contains: 'No export, top-level declaration' },
  { question: ['search', '--query', 'quartz attestation'], contains: '1 recorded test case holds every word' },
  { question: ['search', '--query', 'ledgerCode'], contains: '(+1 more file)' },
  { question: ['search', '--query', 'shared', '--limit', '1'], contains: '1 more not shown' },
  { question: ['search', '--query', 'externalOnly'], contains: 'offered by some manifest in this workspace' },
  { question: ['search', '--query', 'kitExternal'], contains: 'third-party name matches `kitexternal`: search-kit · kitExternal.' },
  { question: ['search', '--query', 'greet', '--from', 'apps/app/src/hello.ts'], contains: 'files by distance: 0: 1' },
  { question: ['search', '--query', 'taxOf', '--to', 'packages/kit/src/money/tax.ts'], contains: 'reaching `packages/kit/src/money/tax.ts`' },
  { question: ['search', '--query', 'greet', '--from', 'missing.ts'], contains: 'No search was run' },
  { question: ['search', '--query=-only'], contains: "`variance ask search --query=-only --limit 20` lists all matching names." },
  { question: ['grep', '--query', 'greet', '--from', 'apps/app/src/hello.ts'], contains: 'greet' },
  { question: ['grep', '--query', 'greet', '--to', 'packages/lib/src/greet.ts'], contains: 'greet' },
  { question: ['grep', '--query', 'greet', '--from', 'packages/lib/src/greet.ts', '--to', 'packages/lib/src/greet.ts', '--limit', '1', '--offset', '1'], contains: 'Rows 2' },
  { question: ['grep', '--query', 'crowdedLine', '--from', 'apps/app/src/crowded/'], contains: "`variance ask discover --from apps/app/src/crowded/ --path '^apps/app/src/crowded/one\\.ts$' --text crowdedLine`: the 1 matching file" },
  { question: ['grep', '--query', 'absentText', '--from', 'apps/app/src/hello.ts'], contains: 'Nothing in those files matches' },
  { question: ['grep', '--query', '[', '--from', 'apps/app/src/hello.ts'], contains: 'ripgrep refused the pattern' },
  { question: ['grep', '--query', 'greet', '--from', 'missing.ts'], contains: 'is not found' },
  { question: ['grep', '--query', 'greet', '--from', 'packages/lib/src/missing.ts'], contains: 'is not found. 3 matching lines in 3 files reachable from `packages/lib/src/`', status: 2 },
  { question: ['grep', '--query', 'crowdedLine', '--from', 'apps/app/src/hello.ts'], contains: 'reachable from `apps/app/src/hello.ts`. ', status: 0 },
  { question: ['discover', '--from', 'apps/app/src/hello.ts', '--declares', '^greet$'], contains: 'declares greet' },
  { question: ['discover', '--from', 'apps/app/src/hello.ts', '--declares', '^greet$', '--offset', '1'], contains: '`--offset` 1 is past the last of 1 row.' },
  { question: ['discover', '--to', 'packages/lib/src/greet.ts', '--limit', '1', '--offset', '1'], contains: 'Rows 2–2' },
  { question: ['discover', '--to', 'packages/lib/src/greet.ts#greet'], contains: 'imports greet from @acme/lib' },
  { question: ['discover', '--to', 'packages/lib/src/greet.ts,packages/lib/src/index.ts'], contains: 'chains reaching `packages/lib/src/greet.ts` end:' },
  { question: ['discover', '--imports', 'packages/lib/src/greet.ts#greet'], contains: 'imports greet from @acme/lib' },
  { question: ['discover', '--imports', '@acme/lib#greet', '--except-path', '^packages/'], contains: 'importing `greet` from `@acme/lib`' },
  { question: ['discover', '--path', '^packages/lib/src/', '--text', 'export function greet'], contains: 'matches a line in 1 of the' },
  { question: ['discover', '--path', '^packages/lib/src/(?!greet\\.ts$).*'], contains: 'also.ts' },
  { question: ['discover', '--from', 'apps/app/src/hello.ts,packages/lib/src/also.ts', '--except-declares', '^greet$'], contains: 'taken out' },
  { question: ['discover', '--from', 'missing.ts'], contains: 'ran nothing' },
] as readonly { question: readonly string[]; contains: string; status?: number }[])('answers $question through the package bin with Node absent from PATH', async ({ question, contains, status }) => {
  const previous = process.cwd();
  const root = checkout(nativeFiles(question));
  try {
    expect((await run(['index', '--wait'])).code).toBe(0);
    if (question[2] === 'quartz attestation') {
      const recording = testCoverageFile(root);
      const file = 'packages/lib/src/private.test.ts';
      const name = 'records a quartz attestation';
      mkdirSync(dirname(recording), { recursive: true });
      writeFileSync(recording, recordOfCases({ index: encodeAsSetExecutionIndex({ tests: [{ id: name, file, name }], modules: [] }) }));
    }
    const empty = join(root, 'empty-path');
    mkdirSync(empty);
    const env = { ...process.env, npm_config_user_agent: '' };
    const args = ['ask', ...question];
    const expected = spawnSync(process.execPath, [nodeEntry, ...args], { cwd: root, env, encoding: 'utf8' });
    expect(expected.error).toBeUndefined();
    expect(expected.stdout + expected.stderr).toContain(contains);
    if (status !== undefined) expect(expected.status).toBe(status);
    const actual = spawnSync(executable, args, { cwd: root, env: { ...env, PATH: empty }, encoding: 'utf8' });
    expect(actual.error).toBeUndefined();
    expect([actual.status, actual.stdout, actual.stderr]).toEqual([expected.status, expected.stdout, expected.stderr]);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

it('asks a search from several start points again with one flag for each', async () => {
  const previous = process.cwd();
  const root = checkout({
    'apps/app/package.json': JSON.stringify({ name: '@acme/app', dependencies: Object.fromEntries(FLAG_KITS.map((name) => [name, '1.0.0'])) }),
    ...Object.fromEntries(FLAG_KITS.flatMap((name) => [
      [`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', types: 'index.d.ts' })],
      [`node_modules/${name}/index.d.ts`, 'export declare const onlyFlags: true;\n'],
    ])),
    'apps/app/src/flags.ts': 'export const onlyFlags = true;\n',
  });
  try {
    expect((await run(['index', '--wait'])).code).toBe(0);
    const ask = (words: readonly string[]): string => spawnSync(executable, words, { cwd: root, env: { ...process.env, npm_config_user_agent: '' }, encoding: 'utf8' }).stdout;
    const points = ['--from', 'apps/app/src/flags.ts', '--from', 'apps/app/src/hello.ts'];
    const again = /`variance (ask search [^`]*)` lists all matching names/u.exec(ask(['ask', 'search', '--query', 'onlyFlags', ...points]))?.[1];
    expect(again).toBe(`ask search --query onlyFlags ${points.join(' ')} --limit 20`);
    expect(ask(again?.split(' ') ?? [])).toContain('flag-kit-9');
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

it('waits for a live index publisher with Node absent from PATH', async () => {
  const previous = process.cwd();
  const root = checkout();
  try {
    expect((await run(['index', '--wait'])).code).toBe(0);
    const index = sourceIndexPath(root);
    const lock = `${index}.follow-ups`;
    const log = `${index}.follow-ups.log`;
    writeFileSync(lock, JSON.stringify({ pid: process.pid, log }));
    const empty = join(root, 'empty-path');
    mkdirSync(empty);
    const child = spawn(executable, ['ask', 'symbol', '--name', 'greet'], {
      cwd: root, env: { ...process.env, PATH: empty, npm_config_user_agent: '' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const waiting = `waiting for process ${process.pid} to finish the code map`;
    child.stdout.setEncoding('utf8').on('data', (part: string) => { stdout += part; });
    child.stderr.setEncoding('utf8').on('data', (part: string) => {
      stderr += part;
      if (stderr.includes(waiting)) rmSync(lock, { force: true });
    });
    const status = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    expect(status, stderr).toBe(0);
    expect(stderr).toContain(waiting);
    expect(stdout).toContain('greet [function]');
    expect(stdout).toMatch(/\nSnapshot \S+ may miss later changes: run `variance index`\.\n$/u);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === 'win32')('forwards a Node command when started through a package bin link', () => {
  const root = mkdtempSync(join(tmpdir(), 'variance-cli-bin-'));
  try {
    const linked = join(root, 'variance');
    symlinkSync(executable, linked);
    const env = { ...process.env, npm_config_user_agent: '' };
    const args = ['--version'];
    const expected = spawnSync(process.execPath, [nodeEntry, ...args], { env, encoding: 'utf8' });
    const actual = spawnSync(linked, args, { env, encoding: 'utf8' });
    expect(expected.status).toBe(0);
    expect(actual.error).toBeUndefined();
    expect([actual.status, actual.stdout, actual.stderr]).toEqual([expected.status, expected.stdout, expected.stderr]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
