import { execFileSync, spawnSync } from 'node:child_process';
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

/** The lines after the index's own: no manifest names a package, no dependency, and nothing is recorded. */
function unprepared(root: string): string {
  return 'code map: none, because no manifest names a package\n' +
    `journeys: not prepared: nothing is recorded at ${testCoverageFile(root)}.cases.bin\n` +
    `dependency lexicon: 0 workspace-dependency pairs, 0 public entrypoints, 0 reused, 0 unavailable, at ${join(dirname(sourceIndexPath(root)), 'dependency-lexicon.json')}\n` +
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
      .toBe(`source index updated: 2 files, 0 read again, at ${at}\n${unprepared(root)}`);

    writeFileSync(join(root, 'src/unit.ts'), 'export const unit = 2;\n');
    expect(await indexOutput({ cwd: root }))
      .toBe(`source index updated: 2 files, 1 read again, at ${at}\n${unprepared(root)}`);
  });

  it("carries the scan's listing to the code map, and a map prepared with no scan says git listed the checkout again", async () => {
    const root = checkout();
    const update = await updateSourceIndex(root);
    expect(update.listing).toBeDefined();
    expect(prepareCodeMap(root, update.path, update).prepared).toMatchObject({ relisted: false, walked: false });
    expect(prepareCodeMap(root, update.path).prepared).toMatchObject({ relisted: true, walked: false });
  });

  it('reads from the working tree under `--no-git`, into the same index', async () => {
    const root = checkout();
    const at = sourceIndexPath(root);

    expect((await run(['index', '--no-git'])).out).toBe(`source index built: 2 files, at ${at}\n${unprepared(root)}`);
    expect((await run(['index'])).out).toBe(`source index updated: 2 files, 0 read again, at ${at}\n${unprepared(root)}`);
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

    expect(spawnSync(process.execPath, [BIN, 'index'], { cwd: root, env, encoding: 'utf8' }).status).toBe(EXIT_CLEAN);
    const read = spawnSync(process.execPath, [BIN, 'reach', '--since', 'HEAD'], { cwd: root, env, encoding: 'utf8' });
    expect(read.status).toBe(EXIT_CLEAN);
    expect(read.stdout).toBe('src/unit.ts\nsrc/widget.ts\n');
  });

  it('leaves a fresh checkout answering `ask search`, which never scans', async () => {
    const root = checkout();
    expect(spawnSync(process.execPath, [BIN, 'index'], { cwd: root, encoding: 'utf8' }).status).toBe(EXIT_CLEAN);

    const searched = spawnSync(process.execPath, [BIN, 'ask', 'search', '--query', 'widget'], { cwd: root, encoding: 'utf8' });
    expect(searched.stderr).toBe('');
    expect(searched.status).toBe(EXIT_CLEAN);
    expect(searched.stdout).toContain('widget');
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
