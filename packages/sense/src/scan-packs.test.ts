import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { nativeAvailable } from './addon.js';
import { updateSourceIndex } from './test-support/published.js';
import { scanRelations } from './test-support/scan.js';

/**
 * `packs: false` changes where bytes are read from, and nothing else.
 *
 * Ten thousand files exercise the cold graph the addon holds, beyond the
 * crossover where its reader opens Git's object store. Below that crossover
 * every read is a disk read either way.
 */

/** Enough files to open Git's object store beyond `STORE_CROSSOVER` in `git_store.rs`. */
const CROSSOVER = 10_000;

describe.runIf(nativeAvailable())('reading from the working tree instead of the object store', () => {
  let root: string;
  let cache: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'sense-packs-'));
    cache = mkdtempSync(join(tmpdir(), 'sense-packs-index-'));
    for (let index = 0; index < CROSSOVER; index += 1) {
      const next = index === CROSSOVER - 1 ? '' : `import { value${index + 1} } from './${index + 1}.js';\n`;
      writeFileSync(join(root, `${index}.ts`), `${next}export const value${index} = ${index};\n`);
    }
    git('init', '--quiet');
    // Three thousand loose objects start a detached `git maintenance` that outlives the test.
    git('config', 'maintenance.auto', 'false');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'source');
  }, 30_000);

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  });

  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  }

  /** Every Git command the scan started, as argv, read from Git's own trace. */
  async function traced<T>(name: string, run: () => Promise<T>): Promise<{ result: T; commands: string[][] }> {
    const trace = join(cache, `${name}.trace.json`);
    vi.stubEnv('GIT_TRACE2_EVENT', trace);
    try {
      const result = await run();
      const lines = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n') : [];
      const commands = lines
        .map((line) => JSON.parse(line) as { event: string; argv?: string[] })
        .filter((event) => event.event === 'start')
        .map((event) => event.argv ?? []);
      return { result, commands };
    } finally {
      vi.unstubAllEnvs();
    }
  }

  const opensObjects = (commands: string[][]): boolean =>
    commands.some((argv) => argv.includes('--show-object-format'));

  it('reads the same records without opening the object store, and still asks Git what the files are', async () => {
    const packed = await traced('packed', () => scanRelations({ root, dirs: ['.'] }));
    const disk = await traced('disk', () => scanRelations({ root, dirs: ['.'], packs: false }));

    expect(opensObjects(packed.commands)).toBe(true);
    expect(opensObjects(disk.commands)).toBe(false);
    expect(disk.commands.length).toBeGreaterThan(0);
    expect(disk.result).toEqual(packed.result);
  });

  it('publishes an index that the next update builds on', async () => {
    const index = join(cache, 'disk', 'source-index.bin');
    expect(await updateSourceIndex(root, { index, packs: false }))
      .toMatchObject({ was: 'missing', files: CROSSOVER, reread: CROSSOVER });
    const native = await traced('native-disk-publication', () => updateSourceIndex(root, {
      index: join(cache, 'native-disk', 'source-index.bin'), packs: false,
    }));
    expect(opensObjects(native.commands)).toBe(false);
    expect(await updateSourceIndex(root, { index, packs: false }))
      .toMatchObject({ was: 'published', files: CROSSOVER, reread: CROSSOVER, parsed: 0 });
  });

  it('lists once when the native update starts a cold index', async () => {
    const index = join(cache, 'listed-once', 'source-index.bin');
    const cold = await traced('cold-listing', () => updateSourceIndex(root, { index }));

    expect(cold.result).toMatchObject({ was: 'missing', files: CROSSOVER, reread: CROSSOVER });
    expect(cold.commands.filter((argv) => argv.includes('ls-files') && argv.includes('--stage'))).toHaveLength(1);
    expect(cold.commands.some((argv) => argv.includes('HEAD^{tree}') || argv.includes('ls-tree'))).toBe(false);
  });
});
