import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cacheRootFor } from './cache-layers.js';

/**
 * `@variance-authority/sense/cache-root` answers where a checkout keeps its
 * cache for a package that reads nothing else of Sense — the Vitest plugin,
 * at config load — so importing it may not load the parser, the resolver or
 * the glob matcher the selection barrel carries.
 */

const PACKAGE = fileURLToPath(new URL('../..', import.meta.url));

/** The packages an import of the entry loaded, by name, each once. */
function packagesLoaded(): { readonly names: readonly string[]; readonly answer: string } {
  const at = realpathSync(mkdtempSync(join(tmpdir(), 'va-cache-root-load-')));
  const hook = join(at, 'hook.mjs');
  const loaded = join(at, 'loaded.txt');
  writeFileSync(
    hook,
    "import { registerHooks } from 'node:module';\n" +
      "import { appendFileSync } from 'node:fs';\n" +
      `registerHooks({ load(url, context, next) { appendFileSync(${JSON.stringify(loaded)}, url + '\\n'); return next(url, context); } });\n`,
  );
  try {
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        hook,
        '--input-type=module',
        '-e',
        "const { cacheRootFor } = await import('@variance-authority/sense/cache-root'); process.stdout.write(cacheRootFor(process.cwd()));",
      ],
      { cwd: PACKAGE, encoding: 'utf8' },
    );
    if (run.error !== undefined || run.status !== 0) throw new Error(`the import exited ${String(run.status)}: ${run.error?.message ?? run.stderr}`);
    const names = readFileSync(loaded, 'utf8')
      .split('\n')
      .map((url) => /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(url)?.[1])
      .filter((name) => name !== undefined);
    return { names: [...new Set(names)].sort(), answer: run.stdout };
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
}

describe('the `cache-root` entry', () => {
  it('answers what `cacheRootFor` answers, loading no parser, resolver or glob matcher', () => {
    const { names, answer } = packagesLoaded();

    expect(answer).toBe(cacheRootFor(PACKAGE));
    expect(names.filter((name) => /oxc|picomatch/.test(name))).toEqual([]);
  });
});
