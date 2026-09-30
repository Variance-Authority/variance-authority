import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCodeMap, sourceIndexPath, updateSourceIndex } from '@variance-authority/sense';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { indexOutput } from './index-command.js';
import { awaitFollowUps, followUpsLockPath, followUpsLogPath, heldBy, holdFollowUps, reserveFollowUps } from './index-follow-ups.js';

/**
 * `variance index`, the pipeline step every graph reader reads after.
 *
 * Its lines are what a pipeline log shows, so the assertions are on the lines:
 * built, then updated with nothing read again, then updated with one file read
 * again after an edit. These checkouts record nothing, so the code map and the
 * journeys lines say why neither is prepared.
 */

const cwd = process.cwd();
const BIN = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-index-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

/** The lines after the index's own: no manifest names a package, no dependency, and nothing is recorded. `unchanged` is a run that found the index where the last one left it. */
function unprepared(root: string, unchanged = false): string {
  return 'code map: none, because no manifest names a package\n' +
    `journeys: not prepared: nothing is recorded at ${testCoverageFile(root)}.cases.bin\n` +
    `dependency lexicon: ${unchanged ? 'unchanged, nothing read: ' : ''}0 workspace-dependency pairs, 0 public entrypoints, ${unchanged ? '' : '0 reused, '}0 unavailable, at ${join(dirname(sourceIndexPath(root)), 'dependency-lexicon.json')}\n` +
    `questions: published at ${sourceIndexPath(root)}.help.json\n`;
}

function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'va-index-'));
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/widget.ts'), "import { unit } from './unit.js';\nexport const widget = unit;\n");
  writeFileSync(join(root, 'src/unit.ts'), 'export const unit = 1;\n');
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the checkout']);
  process.chdir(root);
  // The path the process sees, which is the one a recording is keyed by: the temporary directory is a symlink on macOS.
  return realpathSync(root);
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance index', () => {
  it('builds, then updates in place, naming how many files it read again', async () => {
    const root = checkout();
    const at = sourceIndexPath(root);

    expect(await run(['index'])).toEqual({
      code: EXIT_CLEAN,
      out: `source index built: 2 files, at ${at}\n${unprepared(root)}`,
      err: '',
    });
    expect(await indexOutput({ cwd: root }))
      .toBe(`source index updated: 2 files, 0 read again, at ${at}\n${unprepared(root, true)}`);

    writeFileSync(join(root, 'src/unit.ts'), 'export const unit = 2;\n');
    expect(await indexOutput({ cwd: root }))
      .toBe(`source index updated: 2 files, 1 read again, at ${at}\n${unprepared(root)}`);
  });

  it("carries the scan's listing to the code map, and a map prepared with no scan says git listed the checkout again", async () => {
    const root = checkout();
    const update = await updateSourceIndex(root);
    expect(update.listing).toBeDefined();
    expect((await prepareCodeMap(root, update.path, update)).prepared).toMatchObject({ relisted: false, walked: false });
    expect((await prepareCodeMap(root, update.path)).prepared).toMatchObject({ relisted: true, walked: false });
  });

  it('reads from the working tree under `--no-git`, into the same index', async () => {
    const root = checkout();
    const at = sourceIndexPath(root);

    expect((await run(['index', '--no-git'])).out).toBe(`source index built: 2 files, at ${at}\n${unprepared(root)}`);
    expect((await run(['index'])).out).toBe(`source index updated: 2 files, 0 read again, at ${at}\n${unprepared(root, true)}`);
  });

  it('keeps the index it published when the code map cannot be written, and says why there is no map', async () => {
    const root = checkout();
    const at = sourceIndexPath(root);
    mkdirSync(`${at}.map`, { recursive: true });

    const indexed = await run(['index']);

    expect(indexed.code).toBe(EXIT_CLEAN);
    expect(indexed.out.split('\n')[0]).toBe(`source index built: 2 files, at ${at}`);
    expect(indexed.out.split('\n')[1]).toMatch(new RegExp(`^code map: not prepared: the code map at ${at}\\.map did not read: `, 'u'));
  });

  it("names the primary checkout's index a worktree's first update built on", async () => {
    const root = checkout();
    await indexOutput({ cwd: root });
    const worktree = join(realpathSync(mkdtempSync(join(tmpdir(), 'va-index-worktree-'))), 'worktree');
    execFileSync('git', ['worktree', 'add', '--quiet', '--detach', worktree], { cwd: root, stdio: 'pipe' });
    writeFileSync(join(worktree, 'src/unit.ts'), 'export const unit = 2;\n');

    expect(await indexOutput({ cwd: worktree })).toBe(
      `source index built on ${sourceIndexPath(root)}: 2 files, 1 read again, at ${sourceIndexPath(worktree)}\n${unprepared(worktree)}`,
    );
  });

  // Spawned, because CI is the runner's answer and `ci-info` reads it once, when
  // the process loads it: an environment stubbed inside this one is never asked.
  it('is the step a reader in CI names when nothing is published, and the refusal is the operator\'s', () => {
    const root = checkout();
    const env = { ...process.env, CI: 'true' };
    writeFileSync(join(root, 'src/unit.ts'), 'export const unit = 2;\n');

    const refused = spawnSync(process.execPath, [BIN, 'reach', '--since', 'HEAD'], { cwd: root, env, encoding: 'utf8' });
    expect(refused.status).toBe(EXIT_OPERATOR);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toContain('run `variance index` before this command');
    expect(refused.stderr).not.toContain('defect in the tool');
    expect(existsSync(sourceIndexPath(root))).toBe(false);

    const indexed = spawnSync(process.execPath, [BIN, 'index'], { cwd: root, env, encoding: 'utf8' });
    expect(indexed.status).toBe(EXIT_CLEAN);
    // Nothing is left running when the step ends: the follow-ups are its own lines.
    expect(indexed.stdout).not.toContain('follow-ups:');
    expect(indexed.stdout).toContain('questions: published at');
    const read = spawnSync(process.execPath, [BIN, 'reach', '--since', 'HEAD'], { cwd: root, env, encoding: 'utf8' });
    expect(read.status).toBe(EXIT_CLEAN);
    expect(read.stdout).toBe('src/unit.ts\nsrc/widget.ts\n');
  });

  it('leaves a fresh checkout answering `ask search`, which never scans', async () => {
    const root = checkout();
    // A workstation, whatever runs this suite: `CI=false` is the one answer every vendor's variable yields to.
    const env = { ...process.env, CI: 'false' };
    const indexed = spawnSync(process.execPath, [BIN, 'index'], { cwd: root, env, encoding: 'utf8' });
    expect(indexed.status).toBe(EXIT_CLEAN);
    expect(indexed.stdout).toMatch(/^follow-ups: .+ are being made by process \d+, and the next variance command waits for it/mu);

    const searched = spawnSync(process.execPath, [BIN, 'ask', 'search', '--query', 'widget'], { cwd: root, env, encoding: 'utf8' });
    // The detached process may be done before the question is asked, and then nothing is waited on.
    expect(searched.stderr).toMatch(/^(waiting for process \d+ to finish .+\n)?$/u);
    expect(searched.status).toBe(EXIT_CLEAN);
    expect(searched.stdout).toContain('widget');
    expect(existsSync(followUpsLockPath(sourceIndexPath(root)))).toBe(false);
  });

  it('makes the follow-ups itself, and says so, when the process `index` left them to is gone', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const index = sourceIndexPath(root);
    const gone = spawnSync(process.execPath, ['-e', '']).pid!;
    holdFollowUps(index, { pid: gone, log: followUpsLogPath(index) });

    const searched = await run(['ask', 'search', '--query', 'widget']);

    expect(searched.code).toBe(EXIT_CLEAN);
    expect(searched.err).toContain(`process ${gone} ended before it finished what \`variance index\` left to it, so it is made now`);
    expect(searched.err).toContain('questions: published at');
    expect(existsSync(followUpsLockPath(index))).toBe(false);
  });

  it('waits on a live process holding the follow-ups, saying so once', async () => {
    const index = join(mkdtempSync(join(tmpdir(), 'va-follow-ups-')), 'source-index.bin');
    const lock = followUpsLockPath(index);
    writeFileSync(lock, '');
    const holder = spawn(process.execPath, ['-e', `setTimeout(() => require('node:fs').rmSync(${JSON.stringify(lock)}), 200)`]);
    holdFollowUps(index, { pid: holder.pid!, log: followUpsLogPath(index) });
    const told: number[] = [];

    const waited = await awaitFollowUps(index, ({ pid }) => told.push(pid));

    expect(waited).toEqual({ held: true, lock: { pid: holder.pid, log: followUpsLogPath(index) }, finished: true });
    expect(told).toEqual([holder.pid]);
    expect(await awaitFollowUps(index, () => told.push(0))).toEqual({ held: false });
  });

  it('takes the follow-ups only once a live holder lets them go, so a second `index` never writes over the first one\'s process', async () => {
    const index = join(mkdtempSync(join(tmpdir(), 'va-follow-ups-')), 'source-index.bin');
    const lock = followUpsLockPath(index);
    const holder = spawn(process.execPath, ['-e', `setTimeout(() => require('node:fs').rmSync(${JSON.stringify(lock)}), 200)`]);
    holdFollowUps(index, { pid: holder.pid!, log: followUpsLogPath(index) });
    const told: number[] = [];

    await reserveFollowUps(index, followUpsLogPath(index), ({ pid }) => told.push(pid));

    expect(told).toEqual([holder.pid]);
    expect(heldBy(index)).toEqual({ pid: process.pid, log: followUpsLogPath(index) });
  });

  it('refuses `--wait` beside `--follow-ups`', async () => {
    checkout();

    const both = await run(['index', '--wait', '--follow-ups']);
    expect(both.code).toBe(EXIT_OPERATOR);
    expect(both.err).toContain('--wait and --follow-ups are two ways of making the follow-ups');
  });

  // A file where the cache directory should be, rather than a mode: a mode is
  // no refusal to root, and this has to refuse on every runner.
  it('refuses, naming what the file system refused, when the index cannot be written', async () => {
    const root = checkout();
    const cache = join(mkdtempSync(join(tmpdir(), 'va-index-unwritable-')), 'cache');
    writeFileSync(cache, 'not a directory\n');
    process.env['VARIANCE_AUTHORITY_CACHE'] = cache;

    const refused = await run(['index']);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.out).toBe('');
    expect(refused.err).toMatch(new RegExp(`^source index not written: .+, at ${escaped(sourceIndexPath(root))}\\n`, 'u'));
    expect(refused.err).not.toContain('defect in the tool');
  });

  it('takes no argument', async () => {
    checkout();

    const positional = await run(['index', 'src']);
    expect(positional.code).toBe(EXIT_OPERATOR);
    expect(positional.out).toBe('');
    const api = await run(['index', '--api', 'src/widget.ts']);
    expect(api.code).toBe(EXIT_OPERATOR);
    expect(api.err).toContain('`--api` is not a `variance index` flag');
  });
});

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
