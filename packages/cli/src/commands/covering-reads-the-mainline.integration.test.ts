import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneOf, DISCOUNTS, git, publishTo, published, PUSH, recordIn } from './mainline-fixture.js';

/**
 * The carry journey of `covering` reading the mainline's record, through the
 * built CLI in a process of its own: a checkout that never ran the suite, whose
 * one earlier read left a record main has since moved past. The in-process
 * cases are in `covering-reads-the-mainline.test.ts`.
 */

const BIN = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));
const run = promisify(execFile);
let home: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-covering-mainline-cli-')));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const asCi = () => vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));

/** `variance` asked in `clone`, on this machine's cache of it, outside CI. */
const variance = (clone: string, ...argv: string[]) => run(process.execPath, [BIN, ...argv], {
  cwd: clone,
  env: { ...process.env, CI: 'false', VARIANCE_AUTHORITY_CACHE: join(home, 'clone-cache') },
  maxBuffer: 64 * 1024 * 1024,
});

/** A clone holding the mainline's first record, with main moved a commit past it and that commit published. */
async function behindTheMainline() {
  asCi();
  const ci = await published(home);
  const clone = await cloneOf(home, ci.origin);
  await variance(clone, 'share', '--suite', 'unit');

  await writeFile(join(ci.dir, 'src/moved.ts'), 'export const moved = 1;\n');
  await git(ci.dir, 'add', '-A');
  await git(ci.dir, 'commit', '--quiet', '-m', 'main moves on');
  const second = await git(ci.dir, 'rev-parse', 'HEAD');
  await git(ci.dir, 'push', '--quiet', 'origin', 'main');
  await recordIn(ci.dir, second, ['test/total.test.ts'], [DISCOUNTS]);
  await publishTo(home, ci.dir, second, PUSH, 'mainline main');
  await git(clone, 'pull', '--quiet', 'origin', 'main');
  return { ...ci, clone, second };
}

describe('`covering` through the CLI, in a checkout that never ran the suite', () => {
  it("answers `--since` from the mainline's newest record with no step before it, listing only the change", async () => {
    const { clone, second } = await behindTheMainline();
    await writeFile(join(clone, 'src/total.ts'), 'export function applyDiscount(price: number): number {\n  return price * 0.8;\n}\n');

    const { stdout } = await variance(clone, 'covering', '--since', 'origin/main', '--suite', 'unit', '--format', 'json');
    const answer = JSON.parse(stdout) as {
      readonly at: string;
      readonly changed: readonly { readonly file: string }[];
      readonly source: { readonly from: string };
    };

    expect(answer.at).toBe(second);
    expect(answer.changed.map((change) => change.file)).toEqual(['src/total.ts']);
    expect(answer.source.from).toBe('mainline');
  }, 60_000);
});
