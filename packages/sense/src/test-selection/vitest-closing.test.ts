import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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

/** The seam on a project whose runner is its own, and the directory its workers write journals into. */
async function ownRunner(): Promise<{ close: () => Promise<void>; journals: string }> {
  const coverageFile = resolve(root, 'coverage.bin');
  const configured = withTestSelection({ test: { runner: './own-runner.ts' } }, { root, coverageFile, include: () => true });
  const plugin = (configured.plugins as unknown as Plugin[]).find(({ name }) => name === 'variance-authority:test-selection')!;
  const setup = await readFile((configured.test!.setupFiles as string[])[0]!, 'utf8');
  const journals = /[^"'`]*\.run-[\w-]+(?=["'`])/.exec(setup)![0];
  return { close: () => plugin.closeBundle!.call(plugin), journals };
}

describe('a run whose runner is the project\'s own, closed with no reporter of the seam\'s', () => {
  it('writes no record and says why, once, where its workers left journals and no file that passed', async () => {
    const { close, journals } = await ownRunner();
    await mkdir(journals, { recursive: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await Promise.all([close(), close()]);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/^variance-authority: this run recorded nothing\./);
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
});
