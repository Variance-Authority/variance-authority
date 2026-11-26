// compass: variance-authority.reach.crossings
import { describe, expect, it } from 'vitest';
import { parseArgs } from './parse.js';

const DAY = 86_400_000;

describe('what view is asked for', () => {
  it('reads --since as days or weeks', () => {
    expect(parseArgs(['view', '--since', '30d'])).toEqual({ command: 'view', since: 30 * DAY });
    expect(parseArgs(['view', '--since', '2w', '--suite', 'unit'])).toEqual({ command: 'view', suite: 'unit', since: 14 * DAY });
  });

  it('leaves the window to its default when --since is not given', () => {
    expect(parseArgs(['view'])).toEqual({ command: 'view' });
  });

  it('refuses a window that is not a count of days or weeks', () => {
    expect(() => parseArgs(['view', '--since', 'main'])).toThrow('view: --since takes days or weeks, such as 14d or 2w, not main');
    expect(() => parseArgs(['view', '--since', '0d'])).toThrow(/not 0d/u);
  });
});
