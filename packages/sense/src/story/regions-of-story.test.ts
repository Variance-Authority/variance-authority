import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestOfSha256 } from '@variance-authority/core/format';
import { describe, expect, it } from 'vitest';
import { encodeTestCoverage } from '../test-selection/format.js';
import type { CoverageModule } from '../test-selection/index.js';

/** Read from `dist/`: the story format `require`s its neighbours by the names the build gives them. */
const { regionsOfStory } = (await import('../../dist/story/read.js')) as typeof import('./read.js');

const HEX = 'ab'.repeat(32);

function module(sourceDigest: string, name: string): CoverageModule {
  return {
    file: 'src/cart.ts',
    sourceDigest,
    instrumented: true,
    blocks: [
      { ordinal: 0, kind: 'module', digest: 'b0', name: '', path: 'module', source: true, startLine: 1, endLine: 9, testFiles: [] },
      { ordinal: 1, kind: 'function', digest: 'b1', name, path: 'entry', source: true, startLine: 2, endLine: 4, testFiles: [] },
    ],
  };
}

/** A story directory beside a record holding two texts of `src/cart.ts`, the second of them `HEX`. */
function beside(): string {
  const directory = join(mkdtempSync(join(tmpdir(), 'va-regions-of-story-')), 'coverage.stories');
  mkdirSync(directory);
  writeFileSync(join(directory, '..', 'coverage.bin'), encodeTestCoverage({
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [],
    modules: [module(digestOfSha256('cd'.repeat(32)), 'before'), module(digestOfSha256(HEX), 'after')],
  }));
  return join(directory, 'case.story');
}

const names = (path: string, id: string) =>
  regionsOfStory(path, { rows: [[id, 2]] } as never).regions[0]?.map((region) => region.name);

describe('the regions of a story row', () => {
  it('are the ones of the text the row names', () => {
    expect(names(beside(), `src/cart.ts@${HEX}`)).toEqual(['', 'after']);
  });

  it('are the first text of the path holding as many regions, where the row names no text', () => {
    expect(names(beside(), 'src/cart.ts')).toEqual(['', 'before']);
  });
});
