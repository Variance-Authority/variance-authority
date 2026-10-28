import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * How many modules a caller pays for to import the built root entry.
 *
 * The named watches in `root-entry.test.ts` catch the readers known today. This
 * count catches the next one: a static import that drags a reader into the root
 * adds hundreds of modules, and the root needs about fifteen. Counted from a
 * load hook in a spawned Node, so the count is the same on a machine of any
 * speed.
 */

const ROOT = fileURLToPath(new URL('../dist/index.js', import.meta.url));

/** The ceiling: the root evaluates 15 modules, and a reader behind it brings hundreds. */
const AT_MOST = 30;

function modulesLoaded(entry: string): string[] {
  const at = realpathSync(mkdtempSync(join(tmpdir(), 'va-mcp-root-')));
  const hook = join(at, 'hook.mjs');
  const loaded = join(at, 'loaded.txt');
  writeFileSync(
    hook,
    "import { registerHooks } from 'node:module';\n" +
      "import { appendFileSync } from 'node:fs';\n" +
      'registerHooks({ load(url, context, next) {\n' +
      `  if (url.startsWith('file:')) appendFileSync(${JSON.stringify(loaded)}, url + '\\n');\n` +
      '  return next(url, context);\n' +
      '} });\n',
  );
  writeFileSync(loaded, '');
  try {
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, '--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(entry).href)});`], { cwd: at, encoding: 'utf8' });
    if (run.error !== undefined || run.status !== 0) throw new Error(`importing ${entry} exited ${String(run.status)}: ${run.error?.message ?? run.stderr}`);
    return readFileSync(loaded, 'utf8').split('\n').filter((line) => line !== '');
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
}

describe('the built root entry', () => {
  it(`evaluates at most ${String(AT_MOST)} modules`, () => {
    const loaded = modulesLoaded(ROOT);

    expect(loaded).toContain(pathToFileURL(ROOT).href);
    expect(loaded.length).toBeLessThanOrEqual(AT_MOST);
  });
});
