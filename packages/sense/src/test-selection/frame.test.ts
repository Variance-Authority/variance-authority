import { describe, expect, it } from 'vitest';
import type { TestCoverageView } from './format-view.js';
import { arrivedFrame } from './frame.js';
import { hunksOf } from './patch.js';

const coverage = { commit: 'recorded' } as TestCoverageView;
const unheld = (): string | undefined => undefined;

describe('arrivedFrame', () => {
  it('reads a file the diff adds by its hunks alone', () => {
    const hunks = hunksOf(
      ['diff --git a/src/new.js b/src/new.js', '--- /dev/null', '+++ b/src/new.js', '@@ -0,0 +1,2 @@', '+export const a = 1;', '+export const b = 2;', ''].join('\n'),
    ).get('src/new.js');

    expect(arrivedFrame(coverage, ['src/new.js'], hunks, unheld)).toEqual({
      name: 'src/new.js',
      text: 'export const a = 1;\nexport const b = 2;\n',
    });
  });

  it('gives no text for a file the diff edits when the commit gives none, though its one hunk inserts at the top', () => {
    const hunks = hunksOf(
      ['diff --git a/src/old.js b/src/old.js', '--- a/src/old.js', '+++ b/src/old.js', '@@ -0,0 +1 @@', '+import { a } from "./new.js";', ''].join('\n'),
    ).get('src/old.js');

    expect(arrivedFrame(coverage, ['src/old.js'], hunks, unheld)).toBeUndefined();
  });
});
