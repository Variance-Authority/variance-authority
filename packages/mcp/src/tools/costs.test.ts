import { describe, expect, it } from 'vitest';
import { costs, type CostsSubject } from './costs.js';

/**
 * The answer, because the answer is the product: which files and which
 * subjects the time goes to, ordered the same way twice, with the subjects
 * that name no file counted rather than dropped.
 */

const SUBJECT: CostsSubject = {
  from: 'Mainline main at 3f1c9a0e',
  subjects: [
    { subject: 'story:card--a', ms: 400, file: 'src/card.stories.tsx' },
    { subject: 'story:card--b', ms: 900, file: 'src/card.stories.tsx' },
    { subject: 'story:page--home', ms: 1200, file: 'src/page.stories.tsx' },
    { subject: 'route:/pricing', ms: 400 },
  ],
};

describe('variance_costs', () => {
  it('lists files by their summed time, then subjects, longest first and ties by id', () => {
    expect(costs.run(SUBJECT, {}).split('\n')).toEqual([
      'Mainline main at 3f1c9a0e: 4 subjects timed, 2.9 s in all.',
      '',
      'Slowest files (1 subject names no file):',
      '  1.3 s  src/card.stories.tsx  2 subjects',
      '  1.2 s  src/page.stories.tsx  1 subject',
      '',
      'Slowest subjects:',
      '   1.2 s  story:page--home  src/page.stories.tsx',
      '  900 ms  story:card--b  src/card.stories.tsx',
      '  400 ms  route:/pricing',
      '  400 ms  story:card--a  src/card.stories.tsx',
    ]);
  });

  it('stops at the limit and says how many it left', () => {
    const answer = costs.run(SUBJECT, { limit: 1 });
    expect(answer).toContain('  and 1 more file');
    expect(answer).toContain('  and 3 more subjects; `--limit` lists more');
  });

  it('says a run timed nothing rather than printing empty tables, and refuses a limit below one', () => {
    expect(costs.run({ from: 'The report run.json', subjects: [] }, {})).toBe('The report run.json timed no subject.');
    expect(() => costs.run(SUBJECT, { limit: 0 })).toThrow(/at least 1/);
  });

  it('leaves the file table out when no subject names a file', () => {
    const answer = costs.run({ from: 'x', subjects: [{ subject: 'route:/', ms: 5 }] }, {});
    expect(answer).not.toContain('Slowest files');
  });
});
