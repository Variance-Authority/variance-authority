import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { RunReport } from '@variance-authority/report';
import { entriesMatching, indexOf, partsOf } from './locate-index.js';

/**
 * The postings, asserted as facts about the names: which entries a token
 * points at, and that a question reads the index rather than the report. The
 * rank over these facts is `locate.test.ts`'s business.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const REPORT: RunReport = {
  runVersion: 1,
  at: '2026-09-06T00:00:00.000Z',
  identity: IDENTITY,
  retention: 'durable',
  observations: [
    { subject: 'ds/button--danger', verdict: 'unchanged', because: 'same', changedPixels: 0, regions: [] },
    { subject: 'page/footer--counts', verdict: 'unchanged', because: 'same', changedPixels: 0, regions: [] },
  ],
  notObserved: [{ subject: 'page/dark', reason: 'render failed', because: 'threw' }],
  lexicon: {
    version: 1,
    fields: ['example', 'names', 'components', 'createdBy'],
    subjects: [
      {
        subject: 'ds/button--danger',
        boundaries: 1,
        terms: { example: ['Button'], names: ['Clear'], components: ['Button'] },
      },
      {
        subject: 'page/footer--counts',
        boundaries: 7,
        terms: {
          example: ['TodoFooter'],
          names: ['Clear completed', 'v1:0123456789abcdef'],
          components: ['Button', 'Chip', 'TodoFooter'],
          createdBy: ['TodoFooter'],
        },
      },
    ],
  },
};

const valuesOf = (ids: readonly number[]) =>
  ids.map((id) => {
    const entry = indexOf(REPORT).entries[id]!;
    return `${entry.subject} ${entry.field} ${entry.value}`;
  });

describe('indexOf — the lexicon as postings', () => {
  it('is built once per report and kept with it', () => {
    expect(indexOf(REPORT)).toBe(indexOf(REPORT));
    expect(indexOf({ ...REPORT })).not.toBe(indexOf(REPORT));
  });

  it('enters every subject the report names, the unlexiconed by id alone', () => {
    const index = indexOf(REPORT);
    expect([...index.subjects.keys()]).toEqual(['ds/button--danger', 'page/footer--counts', 'page/dark']);
    expect(index.idOnly).toBe(1);
    expect(index.read).toEqual(['id', 'example', 'names', 'components', 'createdBy']);
    expect(index.unread).toEqual(['text', 'regions', 'files', 'roles', 'tokens']);
  });

  it('numbers entries in subject, field, value order and keeps the tokens sorted', () => {
    const index = indexOf(REPORT);
    expect(index.entries.slice(0, 4).map((entry) => `${entry.field} ${entry.value}`)).toEqual([
      'id ds/button--danger',
      'example Button',
      'names Clear',
      'components Button',
    ]);
    expect(index.tokens).toEqual([...index.tokens].sort());
    for (const list of index.postings.values()) expect(list).toEqual([...list].sort((a, b) => a - b));
  });

  it('points a token at every value holding it, and a digest at nothing', () => {
    const index = indexOf(REPORT);
    expect(valuesOf(index.postings.get('footer')!)).toEqual([
      'page/footer--counts id page/footer--counts',
      'page/footer--counts example TodoFooter',
      'page/footer--counts components TodoFooter',
      'page/footer--counts createdBy TodoFooter',
    ]);
    expect(index.tokens.some((token) => token.startsWith('v1'))).toBe(false);
    expect(index.names).toEqual(['Clear', 'Clear completed', 'v1:0123456789abcdef']);
  });
});

describe('entriesMatching — a part is a token or a prefix of one', () => {
  it('matches the whole token and, at three characters, its prefix run', () => {
    const index = indexOf(REPORT);
    expect(valuesOf(entriesMatching(index, ['clear']))).toEqual([
      'ds/button--danger names Clear',
      'page/footer--counts names Clear completed',
    ]);
    expect(valuesOf(entriesMatching(index, ['comp']))).toEqual(['page/footer--counts names Clear completed']);
    expect(entriesMatching(index, ['co'])).toEqual([]);
  });

  it('needs every part of a compound to land on the same value', () => {
    const index = indexOf(REPORT);
    expect(partsOf('TodoFooter')).toEqual(['todo', 'footer']);
    expect(valuesOf(entriesMatching(index, partsOf('TodoFooter')))).toEqual([
      'page/footer--counts example TodoFooter',
      'page/footer--counts components TodoFooter',
      'page/footer--counts createdBy TodoFooter',
    ]);
    expect(entriesMatching(index, ['todo', 'chip'])).toEqual([]);
    expect(entriesMatching(index, [])).toEqual([]);
  });
});
