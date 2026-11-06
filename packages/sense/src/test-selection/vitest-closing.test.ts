import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTestSelection } from './vitest.js';

/**
 * The server closing on a run no reporter folded: a command-line `--reporter`
 * replaced the seam's, so the run is folded from what the workers wrote, here.
 */

type Plugin = { name: string; closeBundle?: () => Promise<void> };

let root: string;

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'variance-closing-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

type Reporter = { onFinished?: (files: readonly unknown[]) => Promise<void> };

/** The seam on a project whose runner is its own, the directory its workers write journals into, and its reporter. */
async function ownRunner(): Promise<{ close: () => Promise<void>; journals: string; reporter: Reporter }> {
  const coverageFile = resolve(root, 'coverage.bin');
  const configured = withTestSelection({ test: { runner: './own-runner.ts' } }, { root, coverageFile, include: () => true });
  const plugin = (configured.plugins as unknown as Plugin[]).find(({ name }) => name === 'variance-authority:test-selection')!;
  const setup = await readFile((configured.test!.setupFiles as string[])[0]!, 'utf8');
  const journals = /[^"'`]*\.run-[\w-]+(?=["'`])/.exec(setup)![0];
  const reporter = (configured.test!.reporters as unknown[]).at(-1) as Reporter;
  return { close: () => plugin.closeBundle!.call(plugin), journals, reporter };
}

describe('a run whose runner is the project\'s own, closed with no reporter of the seam\'s', () => {
  it('writes no record and says why, once, where its workers left journals and no file that passed', async () => {
    const { close, journals } = await ownRunner();
    await mkdir(journals, { recursive: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await Promise.all([close(), close()]);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/^variance-authority: this run recorded nothing\./);
    expect(warn.mock.calls[0]![0]).toMatch(/so no worker reported which files passed\. The record is as it was before this run\.$/);
    expect(existsSync(resolve(root, 'coverage.bin'))).toBe(false);
    expect((await readdir(root)).filter((name) => name.startsWith('.run-'))).toEqual([]);
  });

  it('says nothing where no worker ran', async () => {
    const { close } = await ownRunner();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await close();

    expect(warn).not.toHaveBeenCalled();
    expect(existsSync(resolve(root, 'coverage.bin'))).toBe(false);
  });

  it('folds the files its workers said they finished, where no reporter of the seam\'s ran', async () => {
    const { close, journals } = await ownRunner();
    const finished = `${journals.replace(/-(?:cases|files)$/, '')}-files`;
    await mkdir(finished, { recursive: true });
    const test = resolve(root, 'cart.test.ts');
    await writeFile(test, "it('totals', () => {});\n", 'utf8');
    await writeFile(resolve(finished, 'worker-1.json'), JSON.stringify([{ filepath: test, result: { state: 'pass' }, tasks: [] }]), 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await close();

    expect(warn.mock.calls.some(([message]) => /this run recorded nothing/.test(String(message)))).toBe(false);
    // The fold read the tree into a record and took it.
    expect(existsSync(resolve(root, 'coverage.bin'))).toBe(true);
    expect(existsSync(finished)).toBe(false);
  });

});

describe('a run the seam\'s reporter folded', () => {
  it('is not read again when the server closes, though a worker\'s directory is back', async () => {
    const { close, journals, reporter } = await ownRunner();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await reporter.onFinished!([]);
    // A worker still writing when the run ended recreates its directory.
    await mkdir(journals, { recursive: true });

    await close();

    expect(warn.mock.calls.some(([message]) => /this run recorded nothing/.test(String(message)))).toBe(false);
    expect(existsSync(journals)).toBe(true);
  });
});
