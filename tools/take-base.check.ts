import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readMissedMainline } from '@variance-authority/cli';
import { mainlineReadRoot, readFetchedMainline } from '@variance-authority/sense/test-selection';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * A CI job takes the mainline's record `base` read as its own.
 *
 * The shards of a slice each read the mainline's line on their own, and the
 * line moves when a push to `main` publishes: two shards read two records,
 * place the slice by two sets of durations, and the fold refuses a file both
 * ran. `check.yml` reads the line once and hands the read root on; this is the
 * step that takes it. The pointer keeps the merge base the line was asked at,
 * which is the job's own, so the job asks the line no more. A miss is an answer
 * too, handed and stamped as given now, because it names no commit and stands
 * for a while; and a job told an artifact was uploaded that cannot find it
 * stops, rather than ask the line itself.
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

function take(handed: string, cache: string, uploaded: 'true' | 'false' = 'true'): string {
  return execFileSync('node', ['tools/take-base.mjs', handed, uploaded], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, VARIANCE_AUTHORITY_CACHE: cache },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('take-base', () => {
  it('lays the handed record under the read root as the base job read it, with the merge base it was asked at', async () => {
    const handed = await temporary('va-handed-');
    const cache = await temporary('va-cache-');
    const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    await mkdir(join(handed, 'unit', OLD), { recursive: true });
    await writeFile(join(handed, 'unit', OLD, 'coverage.bin'), 'record');
    const read = { mainline: 'main', commit: OLD, fetched: anHourAgo, base: OLD };
    await writeFile(join(handed, 'unit', 'fetched.json'), `${JSON.stringify(read)}\n`);

    take(handed, cache);

    const readRoot = mainlineReadRoot(cache, 'unit');
    expect(readFetchedMainline(readRoot)).toEqual(read);
    expect(existsSync(join(readRoot, OLD, 'coverage.bin'))).toBe(true);
  });

  it('lays the line\'s answer that it gave no record, and stamps it as given now', async () => {
    const handed = await temporary('va-handed-');
    const cache = await temporary('va-cache-');
    const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const miss = { kind: 'absent' };
    await mkdir(join(handed, 'unit'), { recursive: true });
    await writeFile(join(handed, 'unit', 'missed.json'), `${JSON.stringify({ mainline: 'main', at: anHourAgo, miss, holds: ['suite-index-v1'] })}\n`);
    const before = Date.now();

    take(handed, cache);

    const note = readMissedMainline(mainlineReadRoot(cache, 'unit'));
    expect(note).toMatchObject({ mainline: 'main', miss, holds: ['suite-index-v1'] });
    expect(Date.parse(note!.at)).toBeGreaterThanOrEqual(before - 1000);
  });

  it('leaves a suite the base job read nothing for alone, and a run that uploaded nothing to ask the line itself', async () => {
    const handed = await temporary('va-handed-');
    const cache = await temporary('va-cache-');
    await mkdir(join(handed, 'chromium'), { recursive: true });

    take(handed, cache);
    expect(take(join(handed, 'absent'), cache, 'false')).toBe('');

    expect(existsSync(mainlineReadRoot(cache, 'chromium'))).toBe(false);
  });

  it('stops when the base job uploaded its read and the job cannot find it', async () => {
    const handed = await temporary('va-handed-');
    const cache = await temporary('va-cache-');

    const ran = spawnSync('node', ['tools/take-base.mjs', join(handed, 'absent'), 'true'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, VARIANCE_AUTHORITY_CACHE: cache },
    });

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain(`take-base: the base job uploaded its read, and ${join(handed, 'absent')} holds none of it`);
  });
});
