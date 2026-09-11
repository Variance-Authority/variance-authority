import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { LexiconReport, RunReport } from '@variance-authority/report';
import { indexed, locate, locateSubjects, tokensOf } from './locate.js';

/**
 * The lookup, asserted where the ranking would otherwise be taken on trust.
 *
 * Every order this prints is a claim, so every test that says "first" also says
 * why in integers: more of the query's words, then a rarer word in a heavier
 * field, then the smaller subject. And every absence is asserted as its own
 * sentence, because the whole point of a fielded index is that "no subject
 * says `footer`" and "no subject was read for text" are different answers.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const LEXICON: LexiconReport = {
  version: 1,
  fields: ['example', 'names', 'text', 'components', 'createdBy', 'files', 'roles', 'tokens'],
  subjects: [
    {
      subject: 'ds/button--danger',
      boundaries: 1,
      terms: {
        example: ['Button'],
        names: ['Clear'],
        text: ['Clear'],
        components: ['Button'],
        files: ['src/ds/components.tsx'],
        roles: ['button'],
        tokens: ['--va-danger'],
      },
    },
    {
      subject: 'page/footer--counts',
      boundaries: 7,
      terms: {
        example: ['TodoFooter'],
        names: ['Clear completed', 'active', 'all', 'completed'],
        text: ['2 left', 'Clear completed', 'active', 'all', 'completed'],
        components: ['Button', 'Chip', 'Stack', 'Text', 'TodoFooter'],
        createdBy: ['TodoFooter'],
        files: ['src/app/todo.tsx', 'src/ds/components.tsx'],
        roles: ['button'],
        tokens: ['--va-danger', '--va-space-2'],
      },
    },
    {
      subject: 'page/todos--populated',
      boundaries: 23,
      terms: {
        example: ['TodoApp'],
        names: ['Clear completed', 'Mark "Write the spec" as done', 'What needs doing?'],
        text: ['Clear completed', 'Write the spec'],
        components: ['Button', 'Card', 'Chip', 'Stack', 'Text', 'Toggle', 'TodoApp', 'TodoFooter', 'TodoItem'],
        createdBy: ['TodoApp', 'TodoFooter', 'TodoItem'],
        files: ['src/app/todo.tsx', 'src/ds/components.tsx'],
        roles: ['button', 'checkbox', 'textbox'],
        tokens: ['--va-danger', '--va-space-2'],
      },
    },
  ],
};

const REPORT: RunReport = {
  runVersion: 1,
  at: '2026-09-06T00:00:00.000Z',
  identity: IDENTITY,
  retention: 'durable',
  observations: [
    { subject: 'ds/button--danger', verdict: 'unchanged', because: 'same', changedPixels: 0, regions: [] },
    { subject: 'page/footer--counts', verdict: 'unchanged', because: 'same', changedPixels: 0, regions: [] },
    { subject: 'page/todos--populated', verdict: 'unchanged', because: 'same', changedPixels: 0, regions: [] },
  ],
  notObserved: [{ subject: 'page/dark', reason: 'render failed', because: 'threw' }],
  lexicon: LEXICON,
};

describe('tokensOf — one rule for both sides', () => {
  it('splits on separators and camel case, keeps the compound, and folds a plural', () => {
    expect(tokensOf('page/footer--counts')).toEqual(['page', 'footer', 'count']);
    expect(tokensOf('TodoFooter')).toEqual(['todofooter', 'todo', 'footer']);
    expect(tokensOf('--va-space-2')).toEqual(['va', 'space', '2']);
    expect(tokensOf('Mark "Write the spec" as done')).toEqual(['mark', 'write', 'the', 'spec', 'as', 'done']);
  });

  it('drops a digest whole, because a coordinate is not a word', () => {
    expect(tokensOf('v1:0123456789abcdef')).toEqual([]);
  });
});

describe('locateSubjects — the rank, in integers', () => {
  it('puts the subject that matches more of the query first', () => {
    const { hits } = locateSubjects(REPORT, 'footer button');
    expect(hits.map((hit) => hit.subject)).toEqual([
      'page/footer--counts',
      'page/todos--populated',
      'ds/button--danger',
    ]);
    expect(hits[0]?.terms).toBe(2);
    expect(hits[2]?.terms).toBe(1);
  });

  it('within one word, ranks the id and the example above a component held in passing', () => {
    const { hits } = locateSubjects(REPORT, 'button');
    // Three hold `Button`; only one is named for it and is its example.
    expect(hits[0]?.subject).toBe('ds/button--danger');
    expect(hits[0]?.matches.map((match) => match.field)).toEqual(['id', 'example', 'components', 'roles']);
  });

  it('breaks a tie between equal weights by the smaller subject, then the id', () => {
    const { hits } = locateSubjects(REPORT, 'clear completed');
    // Both pages hold the same words in the same fields; the footer story is the
    // one to open because it holds seven boundaries to the page's twenty-three.
    expect(hits.slice(0, 2).map((hit) => hit.subject)).toEqual([
      'page/footer--counts',
      'page/todos--populated',
    ]);
    expect(hits[0]?.weight).toBe(hits[1]?.weight);
  });

  it('counts rarity per field, so a region every subject entered does not dull the word in an id', () => {
    // Twenty subjects entered `createCard` while the cards module evaluated;
    // one is named for the card, and both it and the tile mention a socket, the
    // tile twice. Counted once across all fields, `card` is held by all twenty
    // and worth 47 in the id too, so `cpu card socket` goes to the tile on its
    // second `socket`. Counted per field, one id says `card`, and the card
    // keeps its name.
    const subjects = Array.from({ length: 20 }, (_, index) => ({
      subject: index === 0 ? 'page/cpu-card' : index === 1 ? 'page/cpu-tile' : `page/other-${index}`,
      boundaries: 3,
      terms: {
        ...(index === 1 ? { names: ['socket'] } : {}),
        ...(index <= 1 ? { text: ['socket'] } : {}),
        regions: ['createCard'],
      },
    }));
    const report: RunReport = {
      ...REPORT,
      observations: subjects.map(({ subject }) => ({
        subject,
        verdict: 'unchanged',
        because: 'same',
        changedPixels: 0,
        regions: [],
      })),
      notObserved: [],
      lexicon: { version: 1, fields: ['names', 'text', 'regions'], subjects },
    };
    const { hits } = locateSubjects(report, 'cpu card socket');
    expect(hits.slice(0, 2).map((hit) => hit.subject)).toEqual(['page/cpu-card', 'page/cpu-tile']);
    expect(hits[0]?.terms).toBe(hits[1]?.terms);
    // `cpu` sits in two of twenty ids (904), `card` in one id (952) and in every
    // subject's regions (47), `socket` in two texts (904) and one label (952).
    expect(hits[0]?.weight).toBe(6 * 904 + 6 * 952 + 2 * 47 + 4 * 904);
    expect(hits[1]?.weight).toBe(6 * 904 + 2 * 47 + 4 * 952 + 4 * 904);
  });

  it('finds a component by what the page called it, with no thesaurus', () => {
    const { hits } = locateSubjects(REPORT, 'checkbox');
    expect(hits.map((hit) => hit.subject)).toEqual(['page/todos--populated']);
    expect(hits[0]?.matches).toEqual([{ term: 'checkbox', field: 'roles', values: ['checkbox'] }]);
  });

  it('requires every part of a compound term to land, so a name typed whole finds the name', () => {
    const { hits } = locateSubjects(REPORT, 'TodoFooter');
    expect(hits.map((hit) => hit.subject)).toEqual(['page/footer--counts', 'page/todos--populated']);
    expect(hits[0]?.matches[0]).toEqual({ term: 'todofooter', field: 'example', values: ['TodoFooter'] });
  });

  it('indexes a subject the run did not compose by its id alone, and counts it', () => {
    const located = locateSubjects(REPORT, 'dark');
    expect(located.hits.map((hit) => hit.subject)).toEqual(['page/dark']);
    expect(located.idOnly).toBe(1);
    expect(located.indexed).toBe(4);
  });

  it('reads a word without the punctuation around it, and prints it that way', () => {
    const located = locateSubjects(REPORT, '"footer", (button).');
    expect(located.terms).toEqual(['footer', 'button']);
  });

  it('drops the stoplist and reports the words nothing holds', () => {
    const located = locateSubjects(REPORT, 'the remove button in the footer');
    expect(located.dropped).toEqual(['the', 'in']);
    expect(located.unmatched).toEqual(['remove']);
    expect(located.read).toEqual(['id', ...LEXICON.fields]);
    expect(located.unread).toEqual(['regions']);
  });
});

describe('variance_locate — the answer', () => {
  it('prints the field and value behind every hit, so the order can be checked', () => {
    const answer = locate.run(REPORT, { query: 'footer button' });

    expect(answer.split('\n')[0]).toBe('3 of 4 subject(s) match `footer button`.');
    expect(answer).toContain('page/footer--counts · 7 boundaries · example of TodoFooter');
    expect(answer).toContain('  footer: id `page/footer--counts`; example `TodoFooter`; components `TodoFooter`; createdBy `TodoFooter`');
    expect(answer).toContain('  button: components `Button`; roles `button`');
    expect(answer).toContain('next: variance_composition {subject: "page/footer--counts"}');
  });

  it('names what was read and what was not, per field', () => {
    const answer = locate.run(REPORT, { query: 'footer' });
    expect(answer).toContain('Read: id, example, names, text, components, createdBy, files, roles, tokens.');
    expect(answer).toContain('Not read: regions (no execution journal was read).');
  });

  it('answers a word nothing holds with the names the suite does use', () => {
    const answer = locate.run(REPORT, { query: 'remove' });
    expect(answer.split('\n')[0]).toBe('No subject of 4 matches `remove`.');
    expect(answer).toContain('`remove` occurs in no field that was read. The names this run did record:');
    expect(answer).toContain('Clear · Clear completed · Mark "Write the spec" as done');
    expect(answer).not.toContain('next:');
  });

  it('counts past the limit rather than dropping in silence', () => {
    const answer = locate.run(REPORT, { query: 'button', limit: 1 });
    expect(answer).toContain('…and 2 more: page/footer--counts, page/todos--populated');
  });

  it('says so when a report carries no lexicon, instead of reporting a miss', () => {
    const raster: RunReport = { ...REPORT, lexicon: undefined };
    const answer = locate.run(raster, { query: 'checkbox' });
    expect(answer).toContain('No subject of 4 matches `checkbox`.');
    expect(answer).toContain('indexed subject ids and nothing else');
    expect(answer).toContain('Read: id.');
    expect(locate.run(raster, { query: 'footer' })).toContain('page/footer--counts · 0 boundaries');
  });

  it('refuses an empty query the way every tool refuses a missing argument', () => {
    expect(() => locate.run(REPORT, {})).toThrow('`query` is required');
  });
});

describe('the summary line', () => {
  it('names the lexicon and the tool that reads it', () => {
    expect(indexed(REPORT)).toEqual([
      'names of 3 subject(s) written down over 8 field(s); `variance_locate {query}` finds a ' +
        'subject from a description',
    ]);
  });

  it('is omitted when the run wrote no names down', () => {
    const { lexicon: _, ...bare } = REPORT;
    expect(indexed(bare)).toEqual([]);
  });
});
