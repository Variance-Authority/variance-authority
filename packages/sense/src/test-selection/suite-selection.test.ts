import { describe, expect, it } from 'vitest';
import { kept, selectedLines } from './suite-selection.js';

const selection = (skip: string[], declined?: string) => ({ whole: new Set(skip), skip: new Set(skip), notes: [], declined });

describe('the files a seam keeps', () => {
  it('are the files the runner discovered that the selection does not skip', () => {
    expect(kept(selection(['a.test.ts']), ['a.test.ts', 'b.test.ts'])).toEqual(['b.test.ts']);
  });

  it('are none when the selection skips every discovered file', () => {
    expect(kept(selection(['a.test.ts', 'b.test.ts']), ['a.test.ts'])).toEqual([]);
  });

  it('are every discovered file when the reading declined, which skips nothing', () => {
    expect(kept(selection([], 'no record'), ['a.test.ts'])).toEqual(['a.test.ts']);
  });

  it('are the handles the runner passed, named as `skip` names them', () => {
    const files = [{ path: '/repo/a.test.ts' }, { path: '/repo/b.test.ts' }];
    expect(kept(selection(['a.test.ts']), files, (file) => file.path.slice('/repo/'.length))).toEqual([files[1]]);
  });

  it('are what the headline counts', () => {
    expect(selectedLines(selection(['a.test.ts']), ['a.test.ts', 'b.test.ts'])[0]).toBe('variance-authority: selected 1 of 2');
  });
});
