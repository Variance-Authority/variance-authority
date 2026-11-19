import { describe, expect, it } from 'vitest';
import { directoriesOf, movedDirectories } from './witness.js';

describe('naming a directory by what it holds', () => {
  it('names every directory on the way down, root included', () => {
    const directories = directoriesOf(['package.json', 'src/panel/Panel.tsx']);

    expect([...directories.keys()].sort()).toEqual(['', 'src', 'src/panel']);
  });

  it('moves only the directory a path appeared in', () => {
    const before = directoriesOf(['src/a.ts', 'docs/b.md']);
    const after = directoriesOf(['src/a.ts', 'src/c.ts', 'docs/b.md']);

    // The property the whole change exists for: one file added, one directory
    // moved, and every record that never named `src` keeps its edges.
    expect([...movedDirectories(before, after)]).toEqual(['src']);
  });

  it('moves the parent as well when a directory itself appears', () => {
    const before = directoriesOf(['src/a.ts']);
    const after = directoriesOf(['src/a.ts', 'src/panel/b.ts']);

    expect([...movedDirectories(before, after)].sort()).toEqual(['src', 'src/panel']);
  });

  it('moves a directory that went away', () => {
    const before = directoriesOf(['src/panel/b.ts', 'src/a.ts']);
    const after = directoriesOf(['src/a.ts']);

    expect([...movedDirectories(before, after)].sort()).toEqual(['src', 'src/panel']);
  });

  it('holds still when a file is edited, because it names no contents', () => {
    expect([...movedDirectories(
      directoriesOf(['src/a.ts', 'src/b.ts']),
      directoriesOf(['src/b.ts', 'src/a.ts']),
    )]).toEqual([]);
  });
});
