import { describe, expect, it } from 'vitest';
import { parseArgs } from './parse.js';

describe('variance python', () => {
  it('records the suite named, passing what follows `--` to pytest', () => {
    expect(parseArgs(['python', '--suite', 'unit', '--', 'tests/', '-x'])).toEqual({ command: 'python', suite: 'unit', args: ['tests/', '-x'] });
  });

  it('names no suite when none is given, so the only declared one is meant', () => {
    expect(parseArgs(['python'])).toEqual({ command: 'python', args: [] });
  });
});
