/**
 * `placement: 'before-transforms'` places a module's probes in its text as
 * read, ahead of every transform: one parse, of that text, and no map asked
 * for. The default places them after the transforms, through the map back to
 * the file, which parses the file and what the transforms wrote.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const parses = vi.hoisted(() => ({ file: 0, transformed: 0 }));

vi.mock('../instrument/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../instrument/index.js')>();
  return {
    ...original,
    instrument: (...args: Parameters<typeof original.instrument>) => {
      parses.file += 1;
      return original.instrument(...args);
    },
  };
});

vi.mock('../instrument/transformed.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../instrument/transformed.js')>();
  return {
    ...original,
    instrumentTransformed: (...args: Parameters<typeof original.instrumentTransformed>) => {
      parses.transformed += 1;
      return original.instrumentTransformed(...args);
    },
  };
});

const { withTestSelection: withVitest } = await import('./vitest.js');
const { withTestSelection: withRstest } = await import('./rstest.js');
const { testSelectionProbes } = await import('./probes.js');
const { default: probesLoader } = await import('./probes-loader.js');
const { default: rstestLoader } = await import('./rstest-loader.js');
const { default: rstestAfterLoader } = await import('./rstest-after-loader.js');
const { testSelectionRule } = await import('./probes-rule.js');

type Placement = 'after-transforms' | 'before-transforms';

const SOURCE = 'export const rate = 0.2;\nexport function total(items) {\n  return items.length * rate;\n}\n';
/** What a compiler wrote from {@link SOURCE}: a line above it, every other line where it was. */
const COMPILED = `/* compiled */\n${SOURCE}`;
const MAP = { version: 3, sources: ['cart.js'], names: [], mappings: ';AAAA;AACA;AACA;AACA' };

let root: string;
let file: string;
let composed: number;
/** The plugin context the probes are handed: it counts the maps they ask Vite to compose. */
const context = { getCombinedSourcemap: () => ((composed += 1), MAP) };

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'variance-placement-'));
  file = resolve(root, 'cart.js');
  await writeFile(file, SOURCE, 'utf8');
  parses.file = 0;
  parses.transformed = 0;
  composed = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

type Handler = (this: unknown, code: string, id: string) => unknown;
type Seam = { name: string; transform: { handler: Handler } | Handler };

function handlerOf(plugin: Seam): Handler {
  return typeof plugin.transform === 'function' ? plugin.transform : plugin.transform.handler;
}

/** The probed text each seam ends with, the transforms between its two halves having written {@link COMPILED}. */
const seams: Readonly<Record<string, (placement: Placement) => string | undefined>> = {
  vitest: (placement) => {
    const plugins = withVitest({}, { root, coverageFile: resolve(root, 'coverage.bin'), placement }).plugins as unknown as Seam[];
    const [cut, probes] = plugins.filter(({ name }) => name.startsWith('variance-authority:test-selection'));
    const first = handlerOf(cut!).call(context, SOURCE, file) as { code: string } | null;
    const last = handlerOf(probes!).call(context, COMPILED, file) as { code: string } | null;
    return last?.code ?? first?.code;
  },
  vite: (placement) => {
    const plugin = testSelectionProbes({ root, placement });
    plugin.configResolved({ command: 'build', plugins: [] } as never);
    // One plugin: it runs ahead of the transforms or after them.
    return plugin.transform.handler.call(context, placement === 'before-transforms' ? SOURCE : COMPILED, file)?.code;
  },
  rstest: (placement) => {
    const coverageFile = resolve(root, 'coverage.bin');
    withRstest({ root }, { coverageFile, placement });
    let placed: string | undefined;
    const loader = (done: (code?: string) => void) => ({
      resourcePath: file,
      getOptions: () => ({ coverageFile }),
      callback: (error: Error | null, code?: string) => {
        if (error !== null) throw error;
        done(code);
      },
    });
    rstestLoader.call(loader((code) => (placed = code)), SOURCE);
    rstestAfterLoader.call(loader((code) => (placed = code?.includes('__va') ? code : placed)), COMPILED, MAP);
    return placed;
  },
  rspack: (placement) => {
    let placed: string | undefined;
    probesLoader.call({
      resourcePath: file,
      getOptions: () => ({ root, placement }),
      callback: (error, code) => {
        if (error !== null) throw error;
        placed = code;
      },
    }, placement === 'before-transforms' ? SOURCE : COMPILED, MAP);
    return placed;
  },
};

describe.each(Object.entries(seams))('the probes under %s', (_, seam) => {
  it('are placed after the transforms by default, through the composed map', () => {
    expect(seam('after-transforms')).toContain('__va');
    expect(parses).toEqual({ file: 0, transformed: 1 });
  });

  it('are placed in the text as read with `before-transforms`: one parse, and no map composed', () => {
    const placed = seam('before-transforms');
    expect(placed).toContain('__va');
    expect(placed).not.toContain('/* compiled */');
    expect(parses).toEqual({ file: 1, transformed: 0 });
    expect(composed).toBe(0);
  });
});

describe('the seat of the one-step seams', () => {
  it('is ahead of the transforms with `before-transforms`, after them by default', () => {
    expect([testSelectionProbes({ root }).enforce, testSelectionRule({ root }).enforce]).toEqual(['post', 'post']);
    const placement = 'before-transforms';
    expect([testSelectionProbes({ root, placement }).enforce, testSelectionRule({ root, placement }).enforce]).toEqual(['pre', 'pre']);
  });
});
