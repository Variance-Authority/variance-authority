import { describe, expect, it } from 'vitest';
import { matchedThrough } from './case-motion.js';
import { hunksByFile, type Hunk } from './placed.js';
import type { ExecutionBlock, ExecutionModule } from './reverse.js';

function block(name: string, startLine: number, endLine: number, path = 'entry'): ExecutionBlock {
  return { kind: 'function', name, path, startLine, endLine, source: true, crossings: [] };
}

function module(blocks: readonly ExecutionBlock[]): ExecutionModule {
  return { file: 'src/total.ts', blocks };
}

// Lines 1-3 removed, and line 10 rewritten in place.
const HUNKS: readonly Hunk[] = [
  { oldStart: 1, oldCount: 3, newStart: 0, newCount: 0 },
  { oldStart: 10, oldCount: 1, newStart: 7, newCount: 1 },
];

describe('regions paired through the diff between two texts', () => {
  it('pairs a row the edit left whole with the region on the lines it moved to, of its own path first', () => {
    const kept = block('kept', 5, 7);
    const theirs = block('kept', 2, 4, 'other');
    const ours = block('kept', 2, 4);

    expect(matchedThrough(module([kept]), module([theirs, ours]), HUNKS)).toEqual([[kept, ours]]);
  });

  it('pairs a row the edit touched with the nearest region of its name still on its lines', () => {
    const edited = block('edited', 9, 11);
    const near = block('edited', 6, 8);
    const far = block('edited', 8, 8);

    expect(matchedThrough(module([edited]), module([far, near]), HUNKS)).toEqual([[edited, near]]);
  });

  it('pairs nothing with a row the edit removed, nor with one whose lines hold no region of its name', () => {
    const gone = block('gone', 1, 3);
    const stray = block('stray', 5, 5);
    const edited = block('edited', 9, 11);

    const now = module([block('gone', 1, 3), block('stray', 30, 30), block('edited', 40, 42)]);

    expect(matchedThrough(module([gone, stray, edited]), now, HUNKS)).toEqual([]);
  });
});

describe('the hunks of a diff over many files', () => {
  it('holds a removed file by its old name, an added one by its new name, and not a file it shows no lines of', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/old.ts',
      'deleted file mode 100644',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1 @@',
      'diff --git a/bin/run b/bin/run',
      'old mode 100644',
      'new mode 100755',
      '',
    ].join('\n');

    expect([...hunksByFile(diff)]).toEqual([
      ['src/old.ts', [{ oldStart: 1, oldCount: 2, newStart: 0, newCount: 0 }]],
      ['src/new.ts', [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1 }]],
    ]);
  });
});
