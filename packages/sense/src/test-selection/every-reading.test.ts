import { describe, expect, it } from 'vitest';
import { withEveryReading } from './reading-lines.js';

describe('a reading for every changed file', () => {
  it('follows the lists a caller edited after the selection, so a line never contradicts the count', () => {
    const selected = withEveryReading(
      { unread: ['package.json', 'src/a.ts'], stale: [], readings: [{ file: 'src/b.ts', verdict: 'bodies', names: [] }] },
      ['package.json', 'src/a.ts', 'src/b.ts', 'src/c.ts'],
    );
    // The install comparison answered the manifest, and a moved package's file nothing places joined.
    const edited = withEveryReading({ ...selected, unread: ['packages/x/index.ts', 'src/a.ts'] });

    expect(edited.readings).toEqual([
      { file: 'src/b.ts', verdict: 'bodies', names: [] },
      { file: 'packages/x/index.ts', unread: 'nothing' },
      { file: 'src/a.ts', unread: 'nothing' },
      { file: 'package.json', unread: 'answered' },
      { file: 'src/c.ts', unread: 'answered' },
    ]);
  });

  it('names a stale built twin by its changed source, and keeps that when a caller projects again', () => {
    const knownAs = (file: string): readonly string[] => (file === 'src/component.ts' ? [file, 'dist/component.js'] : [file]);
    const selected = withEveryReading({ unread: [], stale: ['dist/component.js'], readings: [] }, ['src/component.ts'], knownAs);
    const edited = withEveryReading({ ...selected, unread: [] });

    expect(selected.readings).toEqual([{ file: 'src/component.ts', unread: 'stale' }]);
    expect(edited).toMatchObject({ stale: ['dist/component.js'], readings: [{ file: 'src/component.ts', unread: 'stale' }] });
  });

  it('names a file by the first list that holds it', () => {
    const selected = withEveryReading({ unread: [], declined: ['a.ts'], stale: ['a.ts', 'b.ts'], ignored: ['b.ts', 'c.css'] }, []);

    expect(selected.readings).toEqual([
      { file: 'a.ts', unread: 'declined' },
      { file: 'b.ts', unread: 'stale' },
      { file: 'c.css', unread: 'ignored' },
    ]);
  });
});
