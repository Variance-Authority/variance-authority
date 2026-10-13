import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyFor, planList } from './collector.js';
import { planStorybook } from './run.js';

/**
 * The route from a story to the name and place of its baseline.
 *
 * Storybook's index is the only thing that knows a story's file, title and
 * name, `planStorybook` is the only place they pass through, and the baseline
 * path template is what spends them. A plan that drops them is not a visible
 * failure: the images land under names read off the id instead, the run is
 * green, and the path the project configured never happens.
 */
describe('planning a storybook run', () => {
  const indexOf = async (entries: Record<string, unknown>): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-index-'));
    const path = join(directory, 'index.json');
    await writeFile(path, JSON.stringify({ v: 5, entries }), 'utf8');
    return path;
  };

  it('keys each story by its file, with the `./` off it, its title and its name', async () => {
    const path = await indexOf({
      'hatbar--accepted': {
        type: 'story',
        id: 'hatbar--accepted',
        name: 'Accepted',
        title: 'Shell/HatBar',
        importPath: './src/ui/shell/HatBar.stories.tsx',
      },
    });

    const plan = await planStorybook(path, { width: 100, height: 100 });

    expect(keyFor(plan.subjects[0]!)).toEqual({
      subject: 'story:hatbar--accepted',
      file: 'src/ui/shell/HatBar.stories.tsx',
      title: 'Shell/HatBar',
      name: 'Accepted',
    });
  });

  it('leaves a file climbing out of the project for the store to refuse by name', async () => {
    // Not clamped here. A placement this cannot express is worth a sentence
    // naming the subject, not a quiet fallback to whichever directory happens
    // to be writable.
    const path = await indexOf({
      'a--b': {
        type: 'story',
        id: 'a--b',
        name: 'B',
        title: 'A',
        importPath: '../shared/A.stories.tsx',
      },
    });

    const plan = await planStorybook(path, { width: 100, height: 100 });

    expect(keyFor(plan.subjects[0]!).file).toBe('../shared/A.stories.tsx');
  });

  it('keys a listed subject by its id alone', () => {
    expect(keyFor(planList(['checkout/cart/empty']).subjects[0]!)).toEqual({ subject: 'checkout/cart/empty' });
  });
});
