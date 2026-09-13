import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planStorybook } from './run.js';

/**
 * The route from a story to the directory its code lives in.
 *
 * Storybook's index is the only thing that knows it, `planStorybook` is the only
 * place it passes through, and a `beside` baseline layout is what spends it. A
 * plan that drops it is not a visible failure: the images land in the baseline
 * root instead, the run is green, and the placement the project configured never
 * happens.
 */
describe('planning a storybook run', () => {
  const indexOf = async (entries: Record<string, unknown>): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-index-'));
    const path = join(directory, 'index.json');
    await writeFile(path, JSON.stringify({ v: 5, entries }), 'utf8');
    return path;
  };

  it('carries the directory declaring each story, with the `./` off it', async () => {
    const path = await indexOf({
      'hatbar--accepted': {
        type: 'story',
        id: 'hatbar--accepted',
        name: 'Accepted',
        title: 'HatBar',
        importPath: './src/ui/shell/HatBar.stories.tsx',
      },
    });

    const plan = await planStorybook(path, { width: 100, height: 100 });

    expect(plan.subjects[0]?.path).toBe('src/ui/shell');
  });

  it('reads a story declared at the root as the root, not as absent', async () => {
    const path = await indexOf({
      'a--b': { type: 'story', id: 'a--b', name: 'B', title: 'A', importPath: './App.stories.tsx' },
    });

    const plan = await planStorybook(path, { width: 100, height: 100 });

    expect(plan.subjects[0]?.path).toBe('');
  });

  it('leaves a path climbing out of the project for the store to refuse by name', async () => {
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

    expect(plan.subjects[0]?.path).toBe('../shared');
  });
});
