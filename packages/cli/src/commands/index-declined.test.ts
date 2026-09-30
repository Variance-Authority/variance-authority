import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { main } from '../bin.js';
import { indexOutput } from './index-command.js';

/**
 * `variance index` over the files it does not parse.
 *
 * A file the scan declines by its bytes — past the megabyte it opens, or a
 * module that is not UTF-8 — is recorded with its reason and no edges, and the
 * record names the bytes by Git's object name, so an update over an unchanged
 * checkout keeps it. A file Git names no object for, and a read that failed,
 * name nothing, so every update opens them again. The count an update prints,
 * `N read again`, is what each case below is read from.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-index-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

/** 1,048,603 bytes: 27 past the megabyte the scan opens, which is where a built bundle sits. */
const bundle = (fill: string): string => `export const bundle = '${fill.repeat(1024 * 1024 + 1)}';\n`;

/** `é` in Latin-1: one byte no UTF-8 text holds on its own. */
const latin1 = (name: string): Buffer =>
  Buffer.concat([Buffer.from(`export const ${name} = '`), Buffer.from([0xe9]), Buffer.from("';\n")]);

function git(root: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

/** Two modules, committed, with `files` written beside them and committed when `commit` says so. */
function checkout(files: Readonly<Record<string, string | Buffer>>, commit = true): string {
  const root = mkdtempSync(join(tmpdir(), 'va-declined-'));
  git(root, ['init', '--quiet', '--initial-branch', 'main']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/widget.ts'), "import { unit } from './unit.js';\nexport const widget = unit;\n");
  writeFileSync(join(root, 'src/unit.ts'), 'export const unit = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'the checkout']);
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), contents);
  }
  if (commit) {
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'the files']);
  }
  process.chdir(root);
  return realpathSync(root);
}

/** The first line `variance index` prints: built on the first run, updated after. */
async function indexed(root: string): Promise<string> {
  let out = '';
  await main(['index'], { out: (text) => { out += text; }, err: () => {} });
  return out.split('\n')[0]!.replace(` at ${sourceIndexPath(root)}`, '');
}

async function updated(root: string): Promise<string> {
  return (await indexOutput({ cwd: root })).split('\n')[0]!.replace(` at ${sourceIndexPath(root)}`, '');
}

describe('variance index, over a file it declines', () => {
  it('keeps a tracked file it declined for its size, rather than opening it on every update', async () => {
    const root = checkout({ 'src/bundle.js': bundle('a') });

    expect(await indexed(root)).toBe('source index built: 3 files,');
    expect(await updated(root)).toBe('source index updated: 3 files, 0 read again,');
    expect(await updated(root)).toBe('source index updated: 3 files, 0 read again,');
  });

  it('reads a file it declined for its size again once the file changes', async () => {
    const root = checkout({ 'src/bundle.js': bundle('a') });
    await indexed(root);
    await updated(root);

    writeFileSync(join(root, 'src/bundle.js'), bundle('b'));
    expect(await updated(root)).toBe('source index updated: 3 files, 1 read again,');
    expect(await updated(root)).toBe('source index updated: 3 files, 0 read again,');
  });

  it('keeps an untracked file it declined for its size, which Git names by hashing it', async () => {
    const root = checkout({ 'src/bundle.js': bundle('a') }, false);

    expect(await indexed(root)).toBe('source index built: 3 files,');
    expect(await updated(root)).toBe('source index updated: 3 files, 0 read again,');
  });

  it('keeps a tracked module that is not UTF-8, and reads it again once it changes', async () => {
    const root = checkout({ 'src/latin1.js': latin1('cafe') });

    expect(await indexed(root)).toBe('source index built: 3 files,');
    expect(await updated(root)).toBe('source index updated: 3 files, 0 read again,');

    writeFileSync(join(root, 'src/latin1.js'), latin1('menu'));
    expect(await updated(root)).toBe('source index updated: 3 files, 1 read again,');
  });

  it('keeps a tracked stylesheet it declined for its size, which JavaScript records', async () => {
    const root = checkout({ 'src/theme.css': `.a { color: red; }\n${'/* padding */\n'.repeat(80_000)}` });

    expect(await indexed(root)).toBe('source index built: 3 files,');
    expect(await updated(root)).toBe('source index updated: 3 files, 0 read again,');
  });

  it('opens an ignored file it declined for its size on every update, because Git names no object for it', async () => {
    const root = checkout({
      '.gitignore': 'src/generated/\n',
      'src/app.ts': "import { bundle } from './generated/bundle.js';\nexport const app = bundle;\n",
    });
    mkdirSync(join(root, 'src/generated'));
    writeFileSync(join(root, 'src/generated/bundle.js'), bundle('a'));

    // `src/app.ts` reaches the ignored bundle, so it is indexed beside the
    // three tracked modules; `.gitignore` is not a module.
    expect(await indexed(root)).toBe('source index built: 4 files,');
    expect(await updated(root)).toBe('source index updated: 4 files, 1 read again,');
    expect(await updated(root)).toBe('source index updated: 4 files, 1 read again,');
  });

  it('opens every file on every update outside a Git checkout, the one it declined included, because nothing names the bytes', async () => {
    const root = checkout({ 'src/bundle.js': bundle('a') });
    rmSync(join(root, '.git'), { recursive: true });

    expect(await indexed(root)).toBe('source index built: 3 files,');
    expect(await updated(root)).toBe('source index updated: 3 files, 3 read again,');
  });

  // A read that fails is tried again on the next update, and a record of one
  // names no bytes: `acquire.rs`, `record_tests.rs` and `record.test.ts` hold
  // that. Through `variance index` a file whose bytes cannot be read never
  // reaches a read: Git cannot hash it either, and the listing leaves it out.
  it('leaves out a file it cannot read, which Git cannot hash to list', async () => {
    const root = checkout({ 'src/locked.js': 'export const locked = 1;\n' }, false);
    chmodSync(join(root, 'src/locked.js'), 0o000);
    onTestFinished(() => { chmodSync(join(root, 'src/locked.js'), 0o644); });

    expect(await indexed(root)).toBe('source index built: 2 files,');
    expect(await updated(root)).toBe('source index updated: 2 files, 0 read again,');
  });
});
