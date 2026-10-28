import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readWorkspace } from './read.js';
import { publishWorkspaceFromIndex } from './refresh-native.js';

/**
 * What reading a workspace says while it reads.
 *
 * On a large checkout the reading is tens of seconds of manifests, a git
 * listing, a native read and a publish, and none of them prints anything. Each
 * one is named as it starts and closed as it ends, in the order it runs, so the
 * person waiting sees which of them is slow.
 */

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');

let at: string;

beforeAll(async () => {
  at = join(await mkdtemp(join(tmpdir(), 'help-progress-')), 'source-index.bin');
});

afterAll(async () => {
  await rm(dirname(at), { recursive: true, force: true });
});

describe('a workspace read with progress', () => {
  it('names each step as it starts and closes it as it ends, in the order they run', async () => {
    const told: string[] = [];
    await readWorkspace(WORKSPACE, {
      index: at,
      progress: (step) => {
        told.push(`start ${step}`);
        return () => told.push(`end ${step}`);
      },
    });

    const steps = told.filter((line) => line.startsWith('start ')).map((line) => line.slice('start '.length));
    expect(steps).toEqual([
      expect.stringMatching(/^reading the package manifests of /),
      expect.stringMatching(/^reading what each file imports and exports, under /),
      'reading the signatures and comments of the exported names',
      'publishing the questions',
    ]);
    // Each step ends before the next starts: they run one after another.
    expect(told).toEqual(steps.flatMap((step) => [`start ${step}`, `end ${step}`]));
  });

  it('names the steps of a publish from the index, the manifests once', async () => {
    await readWorkspace(WORKSPACE, { index: at });
    const told: string[] = [];
    await publishWorkspaceFromIndex(WORKSPACE, {
      index: at,
      progress: (step) => {
        told.push(`start ${step}`);
        return () => told.push(`end ${step}`);
      },
    });

    expect(told.slice(0, 3)).toEqual([
      'start reading the questions published last',
      'end reading the questions published last',
      expect.stringMatching(/^start reading the package manifests of /),
    ]);
    expect(told.filter((line) => line.startsWith('start reading the package manifests of '))).toHaveLength(1);
    expect(told.every((line, at) => line.startsWith(at % 2 === 0 ? 'start ' : 'end '))).toBe(true);
  });
});
