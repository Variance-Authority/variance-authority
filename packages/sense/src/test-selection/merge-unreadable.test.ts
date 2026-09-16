// What a merge does with a carried module whose file would not open.
//
// `merge.test.ts` holds the carry's answers about text — moved, deleted,
// unparseable, unchanged — and every one of them is an answer. This is the case
// where the read itself failed, which is ordinary at the scale the merge is
// for: descriptors run out, a build rewrites a file under the read, a
// permission slips. A path nothing is at is a different sentence and keeps its
// old one.

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { coverageBlock } from './instrumented-modules.js';
import { mergeCoverage, readSources, UNREADABLE } from './merge.js';
import type { TestCoverage } from './index.js';

const BASELINE = '1111111111111111111111111111111111111111';
const LOCAL = '2222222222222222222222222222222222222222';
const ALPHA = 'test/alpha.test.ts';
const BETA = 'test/beta.test.ts';
const BLIND = 'src/decide.ts';
const SEEN = 'src/label.ts';

const asRoot = process.getuid?.() === 0;

const DECIDE = `export function decide(n) {
  return n > 0;
}
`;

/** The same function, moved down the file: the rows are re-cut, nothing is lost. */
const MOVED = `const scale = 2;\n\n${DECIDE}`;

function cut(file: string, source: string, crossed: readonly string[]) {
  const fresh = instrument(source, file, file)!;
  return {
    file,
    sourceDigest: fresh.sourceDigest,
    instrumented: true,
    blocks: fresh.blocks.map((block) => ({
      ...coverageBlock(source, block),
      testFiles: [...crossed],
    })),
  };
}

/** A full run that saw alpha cross both modules, recorded over the older text. */
const recorded: TestCoverage = {
  version: 3,
  instrumentation: INSTRUMENTATION_ID,
  commit: BASELINE,
  tests: [{ file: ALPHA, complete: true, preconditions: [{ name: ALPHA, digest: 'source:test' }] }],
  modules: [cut(BLIND, DECIDE, [ALPHA]), cut(SEEN, DECIDE, [ALPHA])],
};

/** The run that just happened: one test of its own, no module loaded. */
const loadedNothing: TestCoverage = {
  version: 3,
  instrumentation: INSTRUMENTATION_ID,
  commit: LOCAL,
  tests: [{ file: BETA, complete: true, preconditions: [{ name: BETA, digest: 'source:test' }] }],
  modules: [],
};

const carried = recorded.modules.map((module) => ({
  file: module.file,
  sourceDigest: module.sourceDigest,
}));

/**
 * The tree as it stands now — both modules moved down their files — with the
 * one at `BLIND` opened to nobody, and what `readSources` made of it.
 */
async function sourcesWith(blind: boolean): Promise<ReadonlyMap<string, string>> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-unreadable-'));
  try {
    await mkdir(resolve(root, 'src'), { recursive: true });
    for (const module of carried) await writeFile(resolve(root, module.file), MOVED, 'utf8');
    if (blind) await chmod(resolve(root, BLIND), 0o000);
    return await readSources(root, carried);
  } finally {
    await chmod(resolve(root, BLIND), 0o644).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

describe('readSources over a file that would not open', () => {
  it.skipIf(asRoot)('names it rather than passing over it', async () => {
    // Passing over it is the same map a file that is simply not there produces,
    // and the merge reads that as *carry this module as it was*: rows left as
    // ranges in text that may have moved, with nothing lost and so nobody
    // demoted to answer for them.
    const sources = await sourcesWith(true);

    expect(sources.get(BLIND)).toBe(UNREADABLE);
    expect(sources.get(SEEN)).toBe(MOVED);
  });

  it('does not name a file that is not on disk at all', async () => {
    // A path nothing is at has no text for its rows to be wrong about.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-unreadable-'));
    try {
      expect(await readSources(root, carried)).toEqual(new Map());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('mergeCoverage over a module that would not open', () => {
  it.skipIf(asRoot)('demotes the tests that entered it', async () => {
    // Nothing here knows whether the text moved, so the rows cannot be placed
    // and alpha's crossing on this module is worth nothing. It runs at the next
    // selection whatever the diff says, which is the one run the blip costs.
    const merged = mergeCoverage(recorded, loadedNothing, await sourcesWith(true));
    const blind = merged.modules.find((module) => module.file === BLIND);

    expect(merged.tests.find((test) => test.file === ALPHA)?.complete).toBe(false);
    expect(blind?.sourceDigest).toBe(recorded.modules[0]!.sourceDigest);
  });

  it('keeps them whole when the same file opens', async () => {
    // The control: the identical tree, read. Both modules moved the same way,
    // so both are re-cut onto the lines the next diff will be taken in and
    // alpha loses nothing.
    const merged = mergeCoverage(recorded, loadedNothing, await sourcesWith(false));
    const decide = merged.modules
      .find((module) => module.file === BLIND)
      ?.blocks.find((block) => block.name === 'decide');

    expect(merged.tests.every((test) => test.complete)).toBe(true);
    expect(decide?.startLine).toBe(3);
    expect(decide?.testFiles).toEqual([ALPHA]);
  });

  it('carries a module that is not on disk as it was', async () => {
    // The rule the failed read is told apart from: no file, no question about
    // the text, and the carry is the one it has always been.
    const merged = mergeCoverage(recorded, loadedNothing, new Map());

    expect(merged.tests.every((test) => test.complete)).toBe(true);
    expect(merged.modules.map((module) => module.file)).toEqual([BLIND, SEEN]);
  });
});
