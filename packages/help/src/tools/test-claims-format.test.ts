import type { RanRegion, TestComposition, TestRan } from '@variance-authority/sense';
import { describe, expect, it } from 'vitest';
import { formatTestClaims } from './test-claims-format.js';

const test = { case: 0, id: 't0', file: 'e2e/signup.spec.ts', name: 'submits the form', blocks: 4 };
const other = (name: string, blocks: number) => ({ case: 1, id: name, file: 'e2e/signup.spec.ts', name, blocks });

/** A region of the four-test suite; `functionEntered` is the record's, for the function it is written in. */
function region(kind: string, line: number, end: number, entered: boolean, others: number, fn?: string, functionEntered?: boolean): RanRegion {
  return {
    kind,
    line,
    end,
    source: true,
    entered,
    structure: (others + (entered ? 1 : 0)) * 2 > 4,
    others,
    ...(fn === undefined ? {} : { function: fn }),
    ...(functionEntered === undefined ? {} : { functionEntered }),
  };
}

const composition: TestComposition = {
  suite: 4,
  test,
  structure: 1,
  alike: [],
  pieces: [{ case: other('validates', 2), shared: 2 }, { case: other('posts', 2), shared: 1 }],
  wholes: [],
  explained: 3,
  own: [],
  reached: [],
};

const ran: TestRan = {
  suite: 4,
  test,
  modules: [
    { file: 'app/boot.js', ownersNamed: true, regions: [region('function', 1, 9, true, 3, 'boot')] },
    {
      file: 'app/form.js',
      ownersNamed: true,
      regions: [
        region('module', 1, 30, true, 3),
        region('function', 2, 20, true, 1, 'submit', true),
        region('branch', 4, 5, false, 0, 'submit', true),
        { ...region('handler', 7, 8, false, 1, 'submit', true), smallest: other('validates', 2) },
        region('function', 10, 12, true, 0, undefined, true),
        region('branch', 11, 11, true, 0, undefined, true),
        region('function', 22, 28, false, 1, 'reset', false),
        region('branch', 23, 24, false, 1, 'reset', false),
      ],
    },
  ],
};

describe('formatTestClaims', () => {
  it('lists the last attempt\'s steps, sets structure apart, names what only this test enters and every region it passed by', () => {
    const steps = { steps: ['action fill on getByLabel(\'Email\')', 'assertion toBeVisible on getByRole(\'status\')'], attempt: 2, attempts: 2, partial: 'the page closed' };

    expect(formatTestClaims(test, composition, ran, steps).split('\n')).toEqual([
      'e2e/signup.spec.ts  submits the form',
      '',
      'Claims:',
      '  its name: submits the form',
      '  its steps and assertions, from attempt 2 of 2:',
      '    action fill on getByLabel(\'Email\')',
      '    assertion toBeVisible on getByRole(\'status\')',
      '    the journal stops short: the page closed',
      '',
      'Ran, the functions it entered:',
      '  app/form.js  submit, function at 10-12',
      '  and 1 function of structure, run by more than half of the 4 recorded tests',
      '',
      'Adds:',
      '  no other test runs the same regions, structure aside',
      '  pieces, smaller tests inside it: 2, the most shared e2e/signup.spec.ts  validates',
      '  wholes, larger tests holding it: none',
      '  only this test enters:',
      '    app/form.js:10-12  function',
      '    app/form.js:11  branch',
      '',
      'Passed by, the regions of the functions it entered that it did not take:',
      '  app/form.js:4-5  branch in submit  no test takes it',
      '  app/form.js:7-8  handler in submit  taken by 1 other test: e2e/signup.spec.ts  validates',
    ]);
  });

  it('says Eyes recorded no step when the journal holds none, that it ran only structure, and that nothing was passed by', () => {
    const took = { ...ran, modules: [{ file: 'app/form.js', ownersNamed: true, regions: [region('function', 2, 20, true, 3, 'submit')] }] };

    const answer = formatTestClaims(test, composition, took, { steps: [], attempt: 1, attempts: 1 });

    expect(answer).toContain('\n  its steps and assertions: Eyes recorded none\n');
    expect(answer).toContain('\nRan, the functions it entered:\n  1 function, all structure, run by more than half of the 4 recorded tests\n');
    expect(answer.endsWith('Passed by: nothing; it took every region of the functions it entered.')).toBe(true);
  });

  it('says what it passed by is not known in a file whose record names no owners, rather than nothing', () => {
    // A record written before regions named their owners: the branch is in no function it can name, though `submit` holds it.
    const unowned = { ...ran, modules: [{ file: 'app/form.js', ownersNamed: false, regions: [region('function', 2, 20, true, 0, 'submit', true), region('branch', 4, 5, false, 0)] }] };

    expect(formatTestClaims(test, composition, unowned, { steps: [], attempt: 1, attempts: 1 }).split('\n').slice(-2)).toEqual([
      'Passed by, the regions of the functions it entered that it did not take:',
      '  app/form.js: not known; the record names no owner for its regions, so which function holds each is not known',
    ]);
  });
});
