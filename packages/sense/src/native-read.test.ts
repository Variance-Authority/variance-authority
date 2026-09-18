import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { native, nativeAvailable, type NativeReadBatch } from './native.js';
import { MODULE_EXTENSIONS, readModule } from './read.js';

/**
 * The native reader and the JavaScript one, over the same bytes.
 *
 * The corpus is this repository, which is the only corpus worth arguing with: a
 * fixture is a guess about what TypeScript looks like, and a few thousand real
 * files are not. Every tracked module is read both ways and the *specifiers and
 * their kinds* are compared — not the bindings, which the native side
 * deliberately does not build, and not the digests, which nothing here asks for.
 *
 * A disagreement is an edge the two implementations do not share, which is the
 * one failure mode that matters: an edge only one of them has is a file reported
 * that should not have been, or a file missed that should have been.
 */

const run = promisify(execFile);
const available = nativeAvailable();
const root = resolve(import.meta.dirname, '../../..');

describe('the native reader against the JavaScript one', () => {
  it.runIf(available)('agrees on every module in this repository', async () => {
    const files = await modules();
    expect(files.length).toBeGreaterThan(500);

    const batch = native()!.readBatch(root, files);
    const kinds = native()!.kinds();

    const disagreed: unknown[] = [];
    let at = 0;
    for (const [index, file] of files.entries()) {
      const answered = requestsOf(batch, kinds, index, at);
      at += batch.counts[index]!;

      const oracle = readModule(file, await readFile(join(root, file), 'utf8')).requests.map(
        (request) => `${request.kind} ${request.value}`,
      );

      if (String(answered) !== String(oracle)) disagreed.push({ file, oracle, answered });
    }

    expect(disagreed).toEqual([]);
  }, 120_000);

  it.runIf(available)('says why a file it declined is not an empty answer', () => {
    const batch = native()!.readBatch(root, ['packages/sense/package.json'], 8);

    expect(batch.counts[0]).toBe(0);
    expect(batch.unknown[0]).toContain('over the 8 this scan opens');
  });

  it.runIf(available)('reports an unreadable file rather than reporting no edges', () => {
    const batch = native()!.readBatch(root, ['packages/sense/does-not-exist.ts']);

    expect(batch.counts[0]).toBe(0);
    expect(batch.unknown[0]).toContain('could not be read');
  });

  it.runIf(available)('names its kinds the way the oracle names them', () => {
    expect(native()!.kinds()).toEqual(['imports', 'reexports', 'dynamic', 'type']);
  });
});

/** One file's requests, as `<kind> <specifier>` in the order they were found. */
function requestsOf(batch: NativeReadBatch, kinds: string[], index: number, at: number): string[] {
  const held: string[] = [];
  for (let step = 0; step < batch.counts[index]!; step += 1) {
    held.push(`${kinds[batch.kinds[at + step]!]} ${batch.values[at + step]}`);
  }

  return held;
}

/** Every tracked module in this checkout, as repository-relative paths. */
async function modules(): Promise<string[]> {
  const { stdout } = await run('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 28 });

  return stdout
    .split('\0')
    .filter((path) => path !== '' && MODULE_EXTENSIONS.some((end) => path.endsWith(end)));
}
