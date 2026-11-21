import { describe, expect, it } from 'vitest';
import { rankedAreas, type Declared } from './classify-areas.js';

/**
 * The areas a request's words point to: directories of at most a bounded
 * number of tracked files, each scored by the request's stems its path, its
 * file names and the names its files declare hold, the rarer stem counting for
 * more.
 */

const NONE: Declared = { holding: new Map(), words: new Map() };

const filesUnder = (directory: string, names: readonly string[]): string[] => names.map((name) => `${directory}/${name}`);

const PATHS = [
  ...filesUnder('x-pack/plugins/task_manager/server', ['task_pool.ts', 'task_claimer.ts', 'index.ts']),
  ...filesUnder('x-pack/plugins/alerting/server', ['rule_runner.ts', 'index.ts', 'task_runner.ts']),
  ...filesUnder('src/core/server', ['index.ts', 'server.ts', 'restart.ts']),
];

describe('rankedAreas', () => {
  it('ranks first the directory whose path and file names hold the request\'s words, none of them a declared name', () => {
    const areas = rankedAreas('Fix task manager claiming tasks twice after a restart', PATHS, NONE, { most: 2 });

    expect(areas[0]?.path).toBe('x-pack/plugins/task_manager/server');
    // The words lead with the one that weighs most there: `manager`, rare and in the path, before
    // `task`, in the path and two file names but also beside it, before `claiming`, in one file name.
    expect(areas[0]?.words).toEqual(['manager', 'task', 'claiming']);
    expect(areas[0]?.files).toBe(3);
  });

  it('splits a directory holding more than the bound into its children', () => {
    const areas = rankedAreas('alerting rule runner', PATHS, NONE, { most: 4 });

    expect(areas.map((area) => area.path)).toContain('x-pack/plugins/alerting');
    expect(areas.map((area) => area.path)).not.toContain('x-pack/plugins');
  });

  it('counts the names a directory\'s files declare', () => {
    const declaring: Declared = {
      holding: new Map([['restart', new Map([['src/core/server/server.ts', 1]])]]),
      words: new Map([['src/core/server/server.ts', 1]]),
    };

    const without = rankedAreas('server restart', PATHS, NONE, { most: 3 });
    const withNames = rankedAreas('server restart', PATHS, declaring, { most: 3 });

    expect(withNames[0]?.path).toBe('src');
    expect(withNames[0]?.score).toBeGreaterThan(without[0]?.score ?? 0);
  });

  it('weighs a word less in an area that holds more words, as many files as it has', () => {
    const paths = [...filesUnder('alpha', ['restart.ts', 'other.ts']), ...filesUnder('beta', ['restart.ts', 'other.ts'])];
    // `alpha`'s files declare many names, so its one `restart` is a smaller share of what it says.
    const declared: Declared = { holding: new Map(), words: new Map([['alpha/other.ts', 40]]) };

    expect(rankedAreas('restart', paths, declared, { most: 2 }).map((area) => area.path)).toEqual(['beta', 'alpha']);
  });

  it('ranks the same on every run, in integers, ties in code-unit order of the path', () => {
    // Two areas alike in every count tie, and the earlier path in code-unit order ranks first.
    const paths = [...filesUnder('b', ['restart.ts', 'other.ts']), ...filesUnder('a', ['restart.ts', 'other.ts'])];
    const one = rankedAreas('restart', paths, NONE, { most: 2 });

    expect(one).toEqual(rankedAreas('restart', paths, NONE, { most: 2 }));
    expect(one.every((area) => Number.isInteger(area.score))).toBe(true);
    expect(one[0]?.score).toBe(one[1]?.score);
    expect(one.map((area) => area.path)).toEqual(['a', 'b']);
  });

  it('says which areas hold a file the source index read a name from, the ones `search` can start in', () => {
    const paths = [...filesUnder('docs/task', ['claiming.md']), ...filesUnder('src/task', ['claimer.ts'])];
    const declared: Declared = { holding: new Map(), words: new Map([['src/task/claimer.ts', 2]]) };

    const areas = rankedAreas('task claiming', paths, declared, { most: 1 });

    expect(Object.fromEntries(areas.map((area) => [area.path, area.declares]))).toEqual({ docs: false, src: true });
  });

  it('ranks nothing for a request with no word to describe', () => {
    expect(rankedAreas('a the of', PATHS, NONE, { most: 3 })).toEqual([]);
  });
});
