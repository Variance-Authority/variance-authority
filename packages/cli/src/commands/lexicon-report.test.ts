import { describe, expect, it } from 'vitest';
import { compositionOf, lexiconReportOf } from './compose.js';
import { SOURCE, SUITE, instance } from './compose-fixture.js';

/**
 * The subject-first readers, on the same suite `compose.test.ts` reads
 * component-first: what each subject is made of, and every name it carries.
 */

describe('compositionOf — the rows a subject is made of', () => {
  it('writes one structure record per subject, in plan order, with identical rows folded', () => {
    const report = compositionOf({
      subjects: SUITE,
      observations: [],
      source: SOURCE,
    });

    expect(report?.structure?.map((record) => record.subject)).toEqual([
      'story:ds-button--danger',
      'story:page--default',
      'story:page--quiet',
    ]);
    expect(report?.structure?.[1]?.rows).toEqual([
      { component: 'App', depth: 0, count: 1, variants: 1 },
      { component: 'Footer', depth: 1, within: 'App', count: 1, variants: 1 },
      {
        component: 'Button',
        depth: 2,
        within: 'Footer',
        createdBy: 'Footer',
        count: 1,
        variants: 1,
      },
      {
        component: 'Icon',
        depth: 3,
        within: 'Button',
        createdBy: 'Footer',
        count: 1,
        variants: 1,
      },
    ]);
  });

  it('keeps a record for a subject with nothing attributed, so absent and empty stay apart', () => {
    const report = compositionOf({
      subjects: [
        {
          subject: 'story:bare',
          instances: [instance({ component: '(unattributed)' })],
        },
      ],
      observations: [],
    });

    expect(report?.structure).toEqual([{ subject: 'story:bare', rows: [] }]);
  });
});

describe('lexiconReportOf — the names the run wrote down', () => {
  it('is absent when nothing was read, like the census', () => {
    expect(lexiconReportOf({ subjects: [null, null], observations: [] })).toBeUndefined();
  });

  it('indexes each subject under what its instances and the source index hold', () => {
    const report = lexiconReportOf({
      subjects: SUITE,
      observations: [],
      source: SOURCE,
    });

    expect(report?.version).toBe(1);
    expect(report?.fields).toEqual(['example', 'components', 'createdBy', 'files', 'tokens']);
    expect(report?.subjects[0]).toEqual({
      subject: 'story:ds-button--danger',
      boundaries: 2,
      terms: {
        example: ['Button'],
        components: ['Button', 'Icon'],
        files: ['src/ds/Button.tsx', 'src/ds/Icon.tsx'],
        tokens: ['--va-danger', '--va-warn'],
      },
    });
    expect(report?.subjects[1]?.terms.createdBy).toEqual(['Footer']);
  });

  it('names the example the census chose, never one derived twice', () => {
    const report = lexiconReportOf({ subjects: SUITE, observations: [] });

    expect(report?.subjects.map((subject) => subject.terms.example)).toEqual([
      ['Button'],
      ['App'],
      ['App'],
    ]);
  });

  it('lists regions among the fields only when a journal was read', () => {
    const without = lexiconReportOf({ subjects: SUITE, observations: [] });
    const withRegions = lexiconReportOf({
      subjects: SUITE,
      observations: [],
      regions: new Map([['story:page--default', ['Footer', 'Footer/onClear']]]),
    });

    expect(without?.fields).toEqual(['example', 'components', 'createdBy', 'tokens']);
    expect(withRegions?.fields).toEqual([
      'example',
      'components',
      'createdBy',
      'regions',
      'tokens',
    ]);
    expect(withRegions?.subjects[1]?.terms.regions).toEqual(['Footer', 'Footer/onClear']);
    // A journal that was read and says a subject entered nothing is a journal
    // with nothing to say about it, which is not the same field left unread.
    expect(withRegions?.subjects[0]?.terms.regions).toBeUndefined();
  });

  it('skips the slots nothing was read for and keeps the rest in plan order', () => {
    const report = lexiconReportOf({
      subjects: [null, SUITE[2]!, SUITE[0]!],
      observations: [],
    });

    expect(report?.subjects.map((subject) => subject.subject)).toEqual([
      'story:page--quiet',
      'story:ds-button--danger',
    ]);
  });
});
