import { describe, expect, it } from 'vitest';
import type { ExecutionNarrowing } from './narrowing.js';
import { askPerStand, type StandQuestion } from './stands.js';

/**
 * A suite's `ignore` is applied by each answer a stand gives, and the files it
 * ignored are named by the selection as a whole: a file changed only between
 * an older stand and the snapshot's commit is ignored in that stand's answer
 * alone, and is still a file the selection ignored.
 */
describe('the files a selection over stands ignored', () => {
  it('are every answer’s, not the snapshot commit’s alone', async () => {
    const stands = [{ commit: 'older', tests: ['test/old.test.ts'], changed: ['src/old.css'], whole: [] }];
    const answer = (question: StandQuestion) => ({
      narrowing: narrowing(question.read === 'stand' ? ['src/old.css'] : question.at === undefined ? [] : ['src/new.css']),
    });

    const { narrowing: asked } = await askPerStand(stands, async (question) => answer(question));

    expect(asked.ignored).toEqual(['src/new.css', 'src/old.css']);
  });

  it('stay absent when no answer ignores by a declaration', async () => {
    const stands = [{ commit: 'older', tests: ['test/old.test.ts'], changed: ['src/old.ts'], whole: [] }];

    const { narrowing: asked } = await askPerStand(stands, async () => ({ narrowing: narrowing(undefined) }));

    expect(asked).not.toHaveProperty('ignored');
  });
});

function narrowing(ignored: readonly string[] | undefined): ExecutionNarrowing {
  return { whole: [], entered: [], unread: [], stale: [], ...(ignored === undefined ? {} : { ignored }) };
}
