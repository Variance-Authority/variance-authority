import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtFromBatch } from './native-built.js';
import type { NativeScanBatch } from './native.js';

describe('an index without the addon', () => {
  // Cut at the addon and the parse store: what is under test is the refusal, and the loader's own reasons are `native.test.ts`'s.
  afterEach(() => {
    vi.doUnmock('./addon.js');
    vi.doUnmock('./parse-store.js');
    vi.resetModules();
  });

  it('refuses, naming why the addon did not load, and the parse stores asked for beside it reject unheard', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-without-addon-'));
    const unheard: unknown[] = [];
    const hear = (reason: unknown) => unheard.push(reason);
    process.on('unhandledRejection', hear);
    try {
      await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
      for (const args of [['init', '--quiet'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture']]) {
        execFileSync('git', args, { cwd: root });
      }
      vi.resetModules();
      vi.doMock('./addon.js', async (original) => ({
        ...await original<typeof import('./addon.js')>(),
        native: () => undefined,
        nativeRefusal: () => '@variance-authority/sense-linux-x64-gnu is not installed',
      }));
      vi.doMock('./parse-store.js', async (original) => ({
        ...await original<typeof import('./parse-store.js')>(),
        parseStoresFor: () => Promise.reject(new Error('the parse stores could not be asked')),
      }));
      const { updateSourceIndex } = await import('./published.js');

      await expect(updateSourceIndex(root)).rejects.toThrow('the native scanner did not load (@variance-authority/sense-linux-x64-gnu is not installed)');
      await new Promise((settled) => setImmediate(settled));
      expect(unheard).toEqual([]);
    } finally {
      process.off('unhandledRejection', hear);
      await rm(root, { recursive: true, force: true });
    }
  });
  it('refuses to read a published index, naming why the addon did not load, rather than call it damaged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-without-addon-'));
    try {
      await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
      for (const args of [['init', '--quiet'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture']]) {
        execFileSync('git', args, { cwd: root });
      }
      const index = join(root, 'source-index.bin');
      await (await import('./published.js')).updateSourceIndex(root, { index });
      vi.resetModules();
      vi.doMock('./addon.js', async (original) => ({
        ...await original<typeof import('./addon.js')>(),
        native: () => undefined,
        nativeRefusal: () => '@variance-authority/sense-linux-x64-gnu is not installed',
      }));
      const { readPublishedSources } = await import('./published.js');

      await expect(readPublishedSources(index)).rejects.toThrow('the source index is read by the native addon, which did not load: @variance-authority/sense-linux-x64-gnu is not installed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('a native batch', () => {
  it('asked for records and holding none is refused, not read as no files', () => {
    const batch = { parsed: [1], parses: [''], kept: [0] } as unknown as NativeScanBatch;
    expect(() => builtFromBatch(batch)).toThrow('sense: the native batch was asked for records and built none');
  });
});
