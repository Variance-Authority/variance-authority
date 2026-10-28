import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { LexiconSubject, RunReport } from '@variance-authority/report';
import { locate, locateSubjects } from './locate.js';

/**
 * What the answer says about its own evidence, asserted in two directions.
 *
 * A word more than half the searched subjects hold in a field picks none of
 * them out there, and the answer says so beside the hit and above the list. It
 * still ranks: measured on questions written for a suite, dropping it lost more
 * first places than it won, because a word held by one subject more than half
 * of them is a cliff and not a fact. Two words of the question side by side in
 * one recorded value pick a subject out better than the same two found apart.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

function reportOf(subjects: readonly LexiconSubject[]): RunReport {
  return {
    runVersion: 1,
    at: '2026-10-19T00:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    observations: subjects.map(({ subject }) => ({
      subject,
      verdict: 'unchanged',
      because: 'same',
      changedPixels: 0,
      regions: [],
    })),
    notObserved: [],
    lexicon: { version: 1, fields: ['names', 'text'], subjects: [...subjects] },
  };
}

// Four of five screens print the same section heading; one shows an invoice.
const SECTIONS = reportOf([
  { subject: 'a/one', boundaries: 3, terms: { text: ['Section', 'Page'] } },
  { subject: 'a/two', boundaries: 3, terms: { text: ['Section', 'Page'] } },
  { subject: 'a/three', boundaries: 3, terms: { text: ['Section', 'Page'] } },
  { subject: 'a/four', boundaries: 3, terms: { text: ['Section', 'Page'] } },
  { subject: 'b/statement', boundaries: 5, terms: { text: ['Invoice'] } },
]);

describe('a word most subjects hold is named as no evidence', () => {
  it('counts the subjects searched and names the words they mostly hold', () => {
    const located = locateSubjects(SECTIONS, 'section page invoice');
    expect(located.searched).toBe(5);
    expect(located.common).toEqual(['section', 'page']);
    expect(located.hits.map((hit) => hit.subject)).toContain('b/statement');
  });

  it('keeps how many hold the word beside every match', () => {
    const { hits } = locateSubjects(SECTIONS, 'section');
    expect(hits).toHaveLength(4);
    expect(hits[0]?.matches).toEqual([
      { term: 'section', field: 'text', values: ['Section'], holders: 4, common: true },
    ]);
  });

  it('does not call a word held by exactly half common, because half is not most', () => {
    const half = reportOf([
      { subject: 'a/one', boundaries: 1, terms: { text: ['Filter'] } },
      { subject: 'a/two', boundaries: 1, terms: { text: ['Filter'] } },
      { subject: 'a/three', boundaries: 1, terms: { text: ['Other'] } },
      { subject: 'a/four', boundaries: 1, terms: { text: ['Other'] } },
    ]);
    const located = locateSubjects(half, 'filter');
    expect(located.hits[0]?.matches[0]?.common).toBe(false);
    expect(located.common).toEqual([]);
  });

  it('does not call a word common where it is rare somewhere else', () => {
    // `section` is in every text, and in one id: the id still picks one out.
    const named = reportOf([
      { subject: 'a/section', boundaries: 1, terms: { text: ['Section'] } },
      { subject: 'a/two', boundaries: 1, terms: { text: ['Section'] } },
      { subject: 'a/three', boundaries: 1, terms: { text: ['Section'] } },
    ]);
    expect(locateSubjects(named, 'section').common).toEqual([]);
  });

  it('says where a word was common, and beside each value', () => {
    const answer = locate.run(SECTIONS, { query: 'section page invoice' });
    expect(answer).toContain(
      '`section`, `page` are in the text of more than half the 5 subjects searched, and there ' +
        'they distinguish none of them.',
    );
    expect(answer).toContain('  section: text `Section` (in 4 of 5)');
  });

  it('says that nothing was picked out when every word is common, and still lists the holders', () => {
    const answer = locate.run(SECTIONS, { query: 'section page' });
    expect(answer.split('\n')[0]).toBe(
      'None of the 2 terms of `section page` distinguishes a subject: each is in more than half the ' +
        '5 subjects searched, in every field it matched. The 4 subject(s) with them are listed; ' +
        'their order is no answer.',
    );
    expect(answer).toContain('a/four · 3 boundaries');
  });
});

describe('two words side by side in one value', () => {
  // Both screens say `Clear` and `completed`; one says them as one label. The
  // other three are there so that neither word is held by most of the suite.
  const PAIRS = reportOf([
    { subject: 'page/footer', boundaries: 9, terms: { names: ['Clear completed'] } },
    { subject: 'page/list', boundaries: 2, terms: { names: ['Clear'], text: ['completed'] } },
    { subject: 'page/a', boundaries: 1, terms: { names: ['Add'] } },
    { subject: 'page/b', boundaries: 1, terms: { names: ['Edit'] } },
    { subject: 'page/c', boundaries: 1, terms: { names: ['Save'] } },
  ]);

  it('ranks the subject holding them together above the one holding them apart', () => {
    const { hits } = locateSubjects(PAIRS, 'clear completed');
    expect(hits.map((hit) => hit.subject)).toEqual(['page/footer', 'page/list']);
    expect(hits[0]?.pairs).toBe(1);
    expect(hits[1]?.pairs).toBe(0);
    expect(hits[0]?.weight).toBe(hits[1]?.weight);
    expect(hits[0]?.together).toEqual([
      { term: 'clear completed', field: 'names', values: ['Clear completed'], holders: 1, common: false },
    ]);
  });

  it('holds a pair only where the two words stand next to each other, in that order', () => {
    // A paragraph holds most of a question's words somewhere; holding two of them
    // in one value is no closer to the question than holding them in two.
    const report = reportOf([
      { subject: 'page/footer', boundaries: 9, terms: { names: ['Clear Completed'] } },
      { subject: 'page/apart', boundaries: 2, terms: { names: ['Clear every item completed'] } },
      { subject: 'page/turned', boundaries: 2, terms: { names: ['Completed, clear'] } },
      { subject: 'page/a', boundaries: 1, terms: { names: ['Add'] } },
      { subject: 'page/b', boundaries: 1, terms: { names: ['Edit'] } },
      { subject: 'page/c', boundaries: 1, terms: { names: ['Save'] } },
    ]);
    const { hits } = locateSubjects(report, 'clear completed');
    expect(hits.map((hit) => [hit.subject, hit.pairs])).toEqual([
      ['page/footer', 1],
      ['page/apart', 0],
      ['page/turned', 0],
    ]);
  });

  it('reads a pair inside a camel-case name and across a stopword, as the question is read', () => {
    const report = reportOf([
      { subject: 'page/footer', boundaries: 9, terms: { names: ['ClearCompleted'] } },
      { subject: 'page/said', boundaries: 9, terms: { names: ['Clear the completed'] } },
      { subject: 'page/list', boundaries: 2, terms: { names: ['Clear'], text: ['completed'] } },
      { subject: 'page/a', boundaries: 1, terms: { names: ['Add'] } },
      { subject: 'page/b', boundaries: 1, terms: { names: ['Edit'] } },
      { subject: 'page/c', boundaries: 1, terms: { names: ['Save'] } },
    ]);
    const { hits } = locateSubjects(report, 'clear completed');
    expect(hits.map((hit) => [hit.subject, hit.pairs])).toEqual([
      ['page/footer', 1],
      ['page/said', 1],
      ['page/list', 0],
    ]);
  });

  it('reads a compound typed whole as one word of a pair, as the index keeps it', () => {
    const report = reportOf([
      { subject: 'page/footer', boundaries: 9, terms: { names: ['TodoFooter list'] } },
      { subject: 'page/apart', boundaries: 2, terms: { names: ['TodoFooter'], text: ['list'] } },
      { subject: 'page/a', boundaries: 1, terms: { names: ['Add'] } },
    ]);
    const { hits } = locateSubjects(report, 'todofooter list');
    expect(hits.map((hit) => [hit.subject, hit.pairs])).toEqual([
      ['page/footer', 1],
      ['page/apart', 0],
    ]);
  });

  it('says the pairs are as common as the words when it abstains over a pair', () => {
    const report = reportOf([
      { subject: 'a/one', boundaries: 1, terms: { text: ['red green'] } },
      { subject: 'a/two', boundaries: 1, terms: { text: ['red green'] } },
      { subject: 'a/three', boundaries: 1, terms: { text: ['red green'] } },
      { subject: 'b/other', boundaries: 1, terms: { text: ['blue'] } },
    ]);
    const headline = locate.run(report, { query: 'red green' }).split('\n')[0];
    expect(headline).toMatch(/^None of the 2 terms/);
    expect(headline).toContain('and so is every pair of them said side by side');
  });

  it('passes over a stopword inside a hyphenated word of the question, as it does in the value', () => {
    const report = reportOf([
      { subject: 'page/login', boundaries: 3, terms: { names: ['Sign in feature'] } },
      { subject: 'page/apart', boundaries: 1, terms: { names: ['Sign'], text: ['feature'] } },
      { subject: 'page/a', boundaries: 1, terms: { names: ['Add'] } },
    ]);
    const { hits } = locateSubjects(report, 'sign-in feature');
    expect(hits.find((hit) => hit.subject === 'page/login')?.pairs).toBe(1);
  });

  it('abstains over the words it found when another word of the question is held nowhere', () => {
    const report = reportOf([
      { subject: 'a/one', boundaries: 1, terms: { text: ['red', 'green'] } },
      { subject: 'a/two', boundaries: 1, terms: { text: ['red', 'green'] } },
      { subject: 'a/three', boundaries: 1, terms: { text: ['red', 'green'] } },
      { subject: 'b/other', boundaries: 1, terms: { text: ['blue'] } },
    ]);
    const located = locateSubjects(report, 'red green frobnicate');
    expect(located.distinguished).toBe(false);
    const headline = locate.run(report, { query: 'red green frobnicate' }).split('\n')[0];
    expect(headline).toMatch(/^None of the 2 terms of `red green frobnicate` found distinguishes a subject/);
    expect(headline).toContain('`frobnicate` is held by none');
  });

  it('does not abstain when a hit below the first says two of the words side by side', () => {
    // Every word is common; the top hit has all three apart, and the second
    // says two of them as one label, which picks it out.
    const report = reportOf([
      { subject: 'a/one', boundaries: 1, terms: { text: ['red', 'green', 'blue'] } },
      { subject: 'a/two', boundaries: 1, terms: { text: ['red', 'green', 'blue'] } },
      { subject: 'a/three', boundaries: 1, terms: { text: ['red', 'green', 'blue'] } },
      { subject: 'b/pair', boundaries: 1, terms: { text: ['red green'] } },
    ]);
    const answer = locate.run(report, { query: 'red green blue' });
    expect(answer.split('\n')[0]).not.toMatch(/^None of the/);
  });

  it('prints the pair it counted', () => {
    const answer = locate.run(PAIRS, { query: 'clear completed' });
    expect(answer).toContain('  `clear completed` side by side: names `Clear completed`');
  });

  it('picks a subject out by a pair where neither word alone does', () => {
    const report = reportOf([
      { subject: 'a/one', boundaries: 1, terms: { text: ['Section', 'Page'] } },
      { subject: 'a/two', boundaries: 1, terms: { text: ['Section', 'Page'] } },
      { subject: 'a/three', boundaries: 1, terms: { text: ['Section', 'Page'] } },
      { subject: 'b/heading', boundaries: 4, terms: { text: ['Section page'] } },
    ]);
    const { hits } = locateSubjects(report, 'section page');
    expect(hits[0]?.subject).toBe('b/heading');
    expect(hits[0]?.terms).toBe(hits[1]?.terms);
    expect(hits[0]?.pairs).toBe(1);
  });
});
