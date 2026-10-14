/**
 * Every seam reads a module's file from disk once: the half that runs first
 * hands its text to the half that places the probes, and the placement reads
 * the file it cuts regions from no second time.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => new Map<string, number>());

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
    const path = String(args[0]);
    reads.set(path, (reads.get(path) ?? 0) + 1);
    return fs.readFileSync(...args);
  }) as typeof fs.readFileSync;
  return { ...fs, default: { ...fs, readFileSync }, readFileSync };
});

const { withTestSelection: withVitest } = await import('./vitest.js');
const { withTestSelection: withRstest } = await import('./rstest.js');
const { testSelectionProbes } = await import('./probes.js');
const { default: probesLoader } = await import('./probes-loader.js');
const { default: rstestLoader } = await import('./rstest-loader.js');
const { default: rstestAfterLoader } = await import('./rstest-after-loader.js');

const SOURCE = 'export const rate = 0.2;\nexport function total(items) {\n  return items.length * rate;\n}\n';
/** What a compiler wrote from {@link SOURCE}: a line above it, every other line where it was. */
const COMPILED = `/* compiled */\n${SOURCE}`;
const MAP = { version: 3, sources: ['cart.js'], names: [], mappings: ';AAAA;AACA;AACA;AACA' };

let root: string;
let file: string;

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'variance-read-once-'));
  file = resolve(root, 'cart.js');
  await writeFile(file, SOURCE, 'utf8');
  reads.clear();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

type Handler = (this: unknown, code: string, id: string) => unknown;
type Seam = { name: string; transform: { handler: Handler } | Handler };

/** The handler of a plugin's transform, whichever shape it is declared in. */
function handlerOf(plugin: Seam): Handler {
  return typeof plugin.transform === 'function' ? plugin.transform : plugin.transform.handler;
}

describe('a module is read from disk once', () => {
  it('under Vitest, from the cut ahead of the compilers to the probes after them', () => {
    const plugins = withVitest({}, { root, coverageFile: resolve(root, 'coverage.bin') }).plugins as unknown as Seam[];
    const [cut, probes] = plugins.filter(({ name }) => name.startsWith('variance-authority:test-selection'));
    handlerOf(cut!).call({}, SOURCE, file);
    const placed = handlerOf(probes!).call({ getCombinedSourcemap: () => MAP }, COMPILED, file) as { code: string } | null;

    expect(placed?.code).toContain('__va');
    expect(reads.get(file)).toBe(1);
  });

  it('under a Vite dev server, from the load that looks for a build to the probes', () => {
    const plugin = testSelectionProbes({ root });
    plugin.configResolved({ command: 'serve', plugins: [] } as never);
    expect(plugin.load(file)).toBeNull();
    const placed = plugin.transform.handler.call({ getCombinedSourcemap: () => MAP }, COMPILED, file);

    expect(placed?.code).toContain('__va');
    expect(reads.get(file)).toBe(1);
  });

  it('under a Vite build, by the probes alone', () => {
    const plugin = testSelectionProbes({ root });
    plugin.configResolved({ command: 'build', plugins: [] } as never);
    const placed = plugin.transform.handler.call({ getCombinedSourcemap: () => MAP }, COMPILED, file);

    expect(placed?.code).toContain('__va');
    expect(reads.get(file)).toBe(1);
  });

  it('under Rstest, from the first loader to the probes loader', () => {
    const coverageFile = resolve(root, 'coverage.bin');
    withRstest({ root }, { coverageFile });
    const context = (done: (code?: string) => void) => ({
      resourcePath: file,
      getOptions: () => ({ coverageFile }),
      callback: (error: Error | null, code?: string) => {
        if (error !== null) throw error;
        done(code);
      },
    });
    let placed: string | undefined;
    rstestLoader.call(context(() => undefined), SOURCE);
    rstestAfterLoader.call(context((code) => (placed = code)), COMPILED, MAP);

    expect(placed).toContain('__va');
    expect(reads.get(file)).toBe(1);
  });

  it('under the Rspack and webpack probes loader', () => {
    let placed: string | undefined;
    probesLoader.call({
      resourcePath: file,
      getOptions: () => ({ root }),
      callback: (error, code) => {
        if (error !== null) throw error;
        placed = code;
      },
    }, COMPILED, MAP);

    expect(placed).toContain('__va');
    expect(reads.get(file)).toBe(1);
  });
});
