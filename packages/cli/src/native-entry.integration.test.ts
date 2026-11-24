/// <depends path="./bin.ts" />
/// <depends path="../native/src/main.rs" />
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCI } from 'ci-info';
import { expect, it } from 'vitest';
import { cargoPath } from '../../../tools/cargo-path.mjs';

const nativeName = process.platform === 'win32' ? 'variance.exe' : 'variance';
const native = fileURLToPath(new URL(`../dist/${nativeName}`, import.meta.url));
const node = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const direct = { ...process.env, npm_config_user_agent: '' };
const skipNative = !isCI && !existsSync(native) && cargoPath() === undefined;
const nativeTest = it.skipIf(skipNative);

nativeTest.each([['--help'], ['ask', '--help'], ['--version']].map((args) => ({ args })))(
  'answers $args with Node absent from PATH', ({ args }) => {
    const expected = spawnSync(process.execPath, [node, ...args], { env: direct });
    expect(expected.status).toBe(0);
    const answer = spawnSync(native, args, { env: { ...direct, PATH: dirname(native) } });
    expect(answer.error).toBeUndefined();
    expect([answer.status, answer.stdout, answer.stderr]).toEqual([expected.status, expected.stdout, expected.stderr]);
  },
);

nativeTest('forwards a refused command to the existing Node entry', () => {
  const args = ['ask', '--unknown'];
  const env = { ...direct, PATH: `${dirname(process.execPath)}${delimiter}${direct.PATH ?? ''}` };
  const expected = spawnSync(process.execPath, [node, ...args], { env });
  const answer = spawnSync(native, args, { env });
  expect(answer.error).toBeUndefined();
  expect(expected.status).not.toBe(0);
  expect([answer.status, answer.stdout, answer.stderr]).toEqual([expected.status, expected.stdout, expected.stderr]);
});

nativeTest('forwards arguments, cwd, environment and exit status through the companion process', () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'variance-native-entry-')));
  try {
    const cwd = join(fixture, 'working directory');
    mkdirSync(cwd);
    const executable = join(fixture, nativeName);
    copyFileSync(native, executable);
    writeFileSync(join(fixture, 'bin.js'), 'console.log(JSON.stringify([process.argv.slice(2), process.cwd(), process.pid, process.env.VARIANCE_NATIVE_TEST_VALUE])); process.exitCode = 23;');
    const args = ['fallback', '--label', 'two words', '日本語'];
    const env = { ...direct, PATH: `${dirname(process.execPath)}${delimiter}${direct.PATH ?? ''}`, VARIANCE_NATIVE_TEST_VALUE: 'inherited' };
    const answer = spawnSync(executable, args, { cwd, env, encoding: 'utf8' });
    expect(answer.error).toBeUndefined();
    expect(answer.status).toBe(23);
    const [forwarded, where, pid, value] = JSON.parse(answer.stdout);
    expect([forwarded, where, value]).toEqual([args, cwd, 'inherited']);
    if (process.platform !== 'win32') expect(pid).toBe(answer.pid);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function withClosedReader(executable: string, args: readonly string[]) {
  const child = spawn('/bin/sh', ['-c', 'read -r ready; exec "$@"', 'sh', executable, ...args], { env: direct });
  const closed = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (part: string) => { stderr += part; });
    child.on('error', reject).on('close', (code) => resolve({ code, stderr }));
  });
  child.stdout.destroy();
  child.stdin.end('ready\n');
  return closed;
}

it.skipIf(skipNative || process.platform === 'win32')('exits cleanly when the help reader already closed stdout', async () => {
  const expected = await withClosedReader(process.execPath, [node, '--help']);
  expect(expected).toEqual({ code: 0, stderr: '' });
  expect(await withClosedReader(native, ['--help'])).toEqual(expected);
});
