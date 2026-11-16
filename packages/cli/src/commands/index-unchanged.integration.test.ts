/// <depends path="../bin.ts" />
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';

/**
 * `variance index` over a checkout nothing changed in writes none of what it
 * publishes: the chain, its map, the lexicon and the questions stay the files
 * the last run left, by inode and by mtime to the nanosecond.
 *
 * Two files are written on every run by design and are left out: the checkout
 * marker `markCheckout` stamps, whose mtime is when the layer was last used,
 * and the index turn's lock under `.work`.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-index-unchanged-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'va-index-unchanged-'));
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{ "name": "fixture", "exports": "./src/widget.ts" }\n');
  writeFileSync(join(root, 'src/widget.ts'), "import { unit } from './unit.js';\n/** A widget. */\nexport const widget = unit;\n");
  writeFileSync(join(root, 'src/unit.ts'), 'export const unit = 1;\n');
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the checkout']);
  process.chdir(root);
  return realpathSync(root);
}

async function index(): Promise<number> {
  return main(['index'], { out: () => {}, err: () => {} });
}

/** Every file under `directory` but the two each run writes, with its inode and its mtime in nanoseconds. */
function written(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = relative(directory, join(entry.parentPath, entry.name));
    if (path === 'checkout.json' || path.split(sep)[0] === '.work') continue;
    const { ino, mtimeNs } = statSync(join(directory, path), { bigint: true });
    files[path] = `${ino} ${mtimeNs}`;
  }
  return files;
}

it('writes no file it publishes when nothing in the checkout changed', async () => {
  const root = checkout();
  const layer = dirname(sourceIndexPath(root));

  expect(await index()).toBe(EXIT_CLEAN);
  const first = written(layer);
  expect(Object.keys(first)).toContain(relative(layer, sourceIndexPath(root)));

  expect(await index()).toBe(EXIT_CLEAN);
  expect(written(layer)).toEqual(first);
});

it('rewrites nothing a question published when it read the checkout first', async () => {
  const root = checkout();
  const layer = dirname(sourceIndexPath(root));

  expect(await main(['ask', 'symbol', '--name', 'widget'], { out: () => {}, err: () => {} })).toBe(EXIT_CLEAN);
  const asked = written(layer);
  expect(Object.keys(asked)).toContain(relative(layer, `${sourceIndexPath(root)}.help.bin`));

  // The index adds what a question never writes, such as the lexicon, and keeps every file the question left.
  expect(await index()).toBe(EXIT_CLEAN);
  const after = written(layer);
  expect(Object.fromEntries(Object.keys(asked).map((path) => [path, after[path]]))).toEqual(asked);
});
