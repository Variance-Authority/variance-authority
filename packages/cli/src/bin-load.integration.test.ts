import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceIndexPath } from '@variance-authority/sense';
import { describe, expect, it } from 'vitest';
import { awaitFollowUps } from './commands/index-follow-ups.js';

/**
 * What the program loads before it answers.
 *
 * Every command pays for the modules the program loads, whether it calls them or
 * not, and an agent runs `variance select` and `variance index` on every edit.
 * So a command loads what it calls: neither the version, `index` nor `select` loads
 * the pixel, Storybook, MCP, history or help packages none of them calls; the
 * help is loaded by the follow-ups `index` leaves to another process.
 * Counted by package, from a load hook in the spawned program, so the count is
 * the same on a machine of any speed. The program runs as on a workstation, where
 * `index` hands its follow-ups to a process of their own: that process inherits the
 * hook, so each load is written with the process that made it, and only the
 * program's own are counted.
 */

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

/** The packages a run of the built program loaded, by name, each once. */
async function packagesLoaded(args: readonly string[]): Promise<string[]> {
  const at = realpathSync(mkdtempSync(join(tmpdir(), 'va-bin-load-')));
  const hook = join(at, 'hook.mjs');
  const loaded = join(at, 'loaded.txt');
  writeFileSync(
    hook,
    "import { registerHooks } from 'node:module';\n" +
      "import { appendFileSync } from 'node:fs';\n" +
      'registerHooks({ load(url, context, next) {\n' +
      `  appendFileSync(${JSON.stringify(loaded)}, process.pid + ' ' + url + '\\n');\n` +
      '  return next(url, context);\n' +
      '} });\n',
  );
  // `CI=false` is how a workstation is told apart from a CI job, which makes the follow-ups itself.
  let urls: string[];
  try {
    const run = spawnSync(process.execPath, ['--import', hook, BIN, ...args], { cwd: at, encoding: 'utf8', env: { ...process.env, CI: 'false' } });
    if (run.error !== undefined || run.status !== 0) throw new Error(`\`variance ${args.join(' ')}\` exited ${String(run.status)}: ${run.error?.message ?? run.stderr}`);
    const own = `${String(run.pid)} `;
    urls = readFileSync(loaded, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith(own))
      .map((line) => line.slice(own.length));
    // The follow-ups were started by this test, so it waits for them before it deletes where they write.
    await awaitFollowUps(sourceIndexPath(at), () => undefined);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
  const names = urls
    .map((url) => /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(url)?.[1] ?? /\/packages\/([^/]+)\/dist\//.exec(url)?.[1])
    .filter((name) => name !== undefined);
  return [...new Set(names)].sort();
}

/** Packages that hold pixels, Storybook, MCP, history or the help, none of which these commands call. */
const UNCALLED = ['help', 'history', 'mcp', 'observe', 'png', 'pngjs', 'raster', 'remote', 'renderer', 'storybook'];

describe('what the program loads before it answers', () => {
  it.each([['--version'], ['--help'], ['index', '--no-git'], ['select', '--format', 'vitest']])('loads no pixel, Storybook, MCP, history or help package for `%s`', async (...args) => {
    const loaded = await packagesLoaded(args);
    expect(loaded).toContain('cli');
    expect(loaded.filter((name) => UNCALLED.includes(name))).toEqual([]);
  });

  // FIXME: parsing `--at-distance` loads `@variance-authority/sense/test-selection` whole, about 30 ms, for `distanceRange`.
  it.todo('loads no package outside the CLI to print its version — needs `distanceRange` reachable without the selection barrel');
});
