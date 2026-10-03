import { describe, expect, it } from 'vitest';
import { arrangedText, type SnapshotCase } from './arranged.js';

/**
 * What a snapshot taken inside a case says about the case.
 *
 * Read through the text because the text is what a reader is handed: the
 * failing assertion's message and the annotation Playwright's report shows
 * under the test, passing or not.
 */

const CASE = { file: 'tests/checkout.spec.ts', name: 'mocked > pays', id: 'abc-123' };

describe('arrangedText', () => {
  it('names the case the snapshot was taken in, and each precondition with the call that said it', () => {
    const taken: SnapshotCase = {
      ...CASE,
      preconditions: [
        { name: 'network', value: 'mocked', site: 'tests/checkout.spec.ts:12', level: 0xffff },
        { name: 'seeded', value: true, site: 'tests/checkout.spec.ts:8', level: 0 },
      ],
    };

    expect(arrangedText(taken)).toBe(
      'taken in tests/checkout.spec.ts > mocked > pays, arranged network=mocked (tests/checkout.spec.ts:12), ' +
        'seeded (tests/checkout.spec.ts:8)',
    );
  });

  it('keeps both values of a contradiction, as `variance covering` prints it', () => {
    const taken: SnapshotCase = {
      ...CASE,
      preconditions: [
        { name: 'network', value: 'live', site: 'tests/checkout.spec.ts:20', level: 0xffff },
        { name: 'network', value: 'mocked', site: 'tests/checkout.spec.ts:21', level: 0xffff },
      ],
    };

    expect(arrangedText(taken)).toBe(
      'taken in tests/checkout.spec.ts > mocked > pays, arranged network contradicted: ' +
        'live (tests/checkout.spec.ts:20), mocked (tests/checkout.spec.ts:21)',
    );
  });

  it('says a case that listened and heard nothing arranged nothing', () => {
    expect(arrangedText({ ...CASE, preconditions: [] })).toBe(
      'taken in tests/checkout.spec.ts > mocked > pays, nothing arranged',
    );
  });

  it('says a run that did not listen left its preconditions unmeasured, not empty', () => {
    expect(arrangedText(CASE)).toBe(
      'taken in tests/checkout.spec.ts > mocked > pays, preconditions unmeasured: varianceExecution is off, ' +
        'so nothing listened for variancePrecondition',
    );
  });

  // FIXME: the case's row and the run's one record (spec 0094) do not name
  // the snapshots taken in the case, so a reviewer reaches the case from the
  // snapshot and not back.
  it.todo('names each snapshot on the row of the case it was taken in — needs an observation section on the case rows of the one record');

  // FIXME: `names.axes` is parsed and read only in `packages/cli`, so a worker
  // cannot read the grammar until it moves to `@variance-authority/sense`, as
  // `parseSuites` did. See spec 0093, "A snapshot taken inside a case".
  it.todo('reports by name an axis whose subject coordinate disagrees with the value the case said — needs the names grammar readable from a worker');
});
