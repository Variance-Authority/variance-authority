import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mainlineReadRoot, readFetchedMainline } from '@variance-authority/sense/test-selection';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * A CI job takes the mainline's record `base` read as its own.
 *
 * The shards of a slice each read the mainline's line on their own, and the
 * line moves when a push to `main` publishes: two shards read two records,
 * place the slice by two sets of durations, and the fold refuses a file both
 * ran. `check.yml` reads the line once and hands the read root on; this is the
 * step that takes it, and a handed pointer older than the reuse window would
 * send the job back to the line, so it is stamped as read now.
 */

const ROOT = resolve(import.meta.dirname, '..');
const OLD = '05acbd8f49492488ca0ef12e3c2c95877f2300f1';
const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function temporary(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

function take(handed: string, cache: string): string {
  return execFileSync('node', ['tools/take-base.mjs', handed], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, VARIANCE_AUTHORITY_CACHE: cache },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('take-base', () => {
  it('lays the handed record under the read root and stamps it as read now', async () => {
    const handed = await temporary('va-handed-');
    const cache = await temporary('va-cache-');
    const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    await mkdir(join(handed, 'unit', OLD), { recursive: true });
    await writeFile(join(handed, 'unit', OLD, 'coverage.bin'), 'record');
    await writeFile(join(handed, 'unit', 'fetched.json'), `${JSON.stringify({ mainline: 'main', commit: OLD, fetched: anHourAgo })}\n`);
    const before = Date.now();

    take(handed, cache);

    const readRoot = mainlineReadRoot(cache, 'unit');
    const pointer = readFetchedMainline(readRoot);
    expect(pointer).toMatchObject({ mainline: 'main', commit: OLD });
    expect(Date.parse(pointer!.fetched)).toBeGreaterThanOrEqual(before - 1000);
    expect(existsSync(join(readRoot, OLD, 'coverage.bin'))).toBe(true);
  });

  it('leaves a suite the base job read nothing for to ask the line itself', async () => {
    const handed = await temporary('va-handed-');
    const cache = await temporary('va-cache-');
    await mkdir(join(handed, 'chromium'), { recursive: true });

    take(handed, cache);
    take(join(handed, 'absent'), cache);

    expect(existsSync(mainlineReadRoot(cache, 'chromium'))).toBe(false);
  });
});
