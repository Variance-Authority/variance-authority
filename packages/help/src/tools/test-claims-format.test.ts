import type { RanRegion, TestComposition, TestRan } from '@variance-authority/sense';
import { describe, expect, it } from 'vitest';
import { formatTestClaims } from './test-claims-format.js';

const test = { case: 0, file: 'e2e/signup.spec.ts', name: 'submits the form', blocks: 4 };
const other = (name: string, blocks: number) => ({ case: 1, file: 'e2e/signup.spec.ts', name, blocks });

function region(kind: string, line: number, end: number, entered: boolean, others: number, fn?: string): RanRegion {
  return { kind, line, end, source: true, entered, others, ...(fn === undefined ? {} : { function: fn }) };
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
    { file: 'app/boot.js', regions: [region('function', 1, 9, true, 3, 'boot')] },
    {
      file: 'app/form.js',
      regions: [
        region('module', 1, 30, true, 3),
        region('function', 2, 20, true, 1, 'submit'),
        region('branch', 4, 5, false, 0, 'submit'),
        region('function', 10, 12, true, 0),
        region('branch', 11, 11, true, 0),
        region('function', 22, 28, false, 1, 'reset'),
        region('branch', 23, 24, false, 1, 'reset'),
      ],
    },
  ],
};

describe('formatTestClaims', () => {
  it('lists the last attempt\'s steps, sets structure apart and names what only this test enters', () => {
    const steps = { steps: ['action fill on getByLabel(\'Email\')', 'assertion toBeVisible on getByRole(\'status\')'], attempt: 2, attempts: 2, partial: 'the page closed' };

    expect(formatTestClaims(composition, ran, steps).split('\n')).toEqual([
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
      '  executes exactly what no other test executes',
      '  pieces, smaller tests inside it: 2, the most shared e2e/signup.spec.ts  validates',
      '  wholes, larger tests holding it: none',
      '  only this test enters:',
      '    app/form.js:10-12  function',
      '    app/form.js:11  branch',
      '',
      'Passed by, the branches of the functions it entered that it did not take:',
      '  app/form.js:4-5  branch in submit  no test takes it',
    ]);
  });

  it('says Eyes recorded no step when the journal holds none, and that nothing was passed by', () => {
    const took = { ...ran, modules: [{ file: 'app/form.js', regions: [region('function', 2, 20, true, 1, 'submit')] }] };

    const answer = formatTestClaims(composition, took, { steps: [], attempt: 1, attempts: 1 });

    expect(answer).toContain('\n  its steps and assertions: Eyes recorded none\n');
    expect(answer.endsWith('Passed by: nothing; it took every branch of the functions it entered.')).toBe(true);
  });
});
