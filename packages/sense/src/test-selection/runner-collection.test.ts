import { describe, expect, it } from 'vitest';
import { collectionOf, type CollectingRunner } from './runner-collection.js';

const FILE = '/repository/test/alpha.test.ts';
const says = (answer: boolean) => ({ matchesTestGlob: () => answer });
const ask = (runner: CollectingRunner | undefined) => collectionOf(() => runner)(FILE);

describe('collectionOf', () => {
  it('says a file is collected when any project collects it', async () => {
    expect(await ask({ projects: [says(false), says(true)] })).toBe(true);
  });

  it('says a file is not collected only when every project says so', async () => {
    expect(await ask({ projects: [says(false), says(false)] })).toBe(false);
  });

  it('asks Vitest 2 through isTargetFile', async () => {
    expect(await ask({ projects: [{ isTargetFile: async () => false }] })).toBe(false);
  });

  it.each<[string, CollectingRunner | undefined]>([
    ['no runner yet', undefined],
    ['a runner that names no projects', {}],
    ['a runner with no projects', { projects: [] }],
    ['a project that answers neither way', { projects: [says(false), {}] }],
    ['a project that cannot read the file', {
      projects: [{ isTargetFile: () => Promise.reject(new Error('ENOENT')) }],
    }],
    ['files excluded on the command line', { projects: [says(false)], config: { cliExclude: ['x'] } }],
    ['projects picked on the command line', { projects: [says(false)], config: { project: ['unit'] } }],
    ['projects picked in watch mode', { projects: [says(false)], configOverride: { project: 'unit' } }],
  ])('has no answer for %s', async (_, runner) => {
    expect(await ask(runner)).toBeUndefined();
  });

  it('reads the runner when asked, not when made', async () => {
    let runner: CollectingRunner = { projects: [says(false)] };
    const collects = collectionOf(() => runner);
    runner = { ...runner, configOverride: { project: 'unit' } };

    expect(await collects(FILE)).toBeUndefined();
  });
});
