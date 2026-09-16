import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { Landmark, LexiconReport, RunReport, SubjectLexicon } from '@variance-authority/report';
import { locate } from './locate.js';
import { orient } from './orient.js';
import { readQuestion } from './question.js';
import { Holds } from './holds.js';

/**
 * The step past *which subject*, asserted where it would otherwise be luck.
 *
 * Every question below has a decoy built for it: a surface holding the same
 * words in the wrong arrangement, a warning above the field instead of below
 * it, a second field on the same screen with its own warning. A reader that
 * ranked on words alone would answer all of them, which is exactly the failure
 * this record exists to remove — so each test names the decoy it beat.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const at = (
  spec: Partial<Landmark> & { box: readonly [number, number, number, number] },
): Landmark => spec as Landmark;

/** The drawer the question is about: carrier field, its warning beneath it. */
const DISPATCH: SubjectLexicon = {
  subject: 'shipping/dispatch-drawer--carrier-unverified',
  boundaries: 6,
  terms: { example: ['DispatchDrawer'] },
  landmarks: [
    at({ role: 'dialog', name: 'Dispatch shipment', box: [0, 100, 480, 300], file: 'src/dispatch/DispatchDrawer.tsx', line: 31 }),
    at({ role: 'combobox', name: 'Carrier', within: 0, box: [24, 148, 432, 40], file: 'src/dispatch/CarrierPicker.tsx', line: 64 }),
    at({ role: 'status', text: 'No active contract on file', within: 0, box: [24, 192, 432, 20], file: 'src/dispatch/CarrierPicker.tsx', line: 78 }),
    at({ role: 'group', name: 'Pickup window', within: 0, box: [24, 236, 432, 40], file: 'src/dispatch/PickupWindow.tsx', line: 22 }),
    // The decoy inside the right surface: a second warning, on the other field.
    at({ role: 'status', text: 'Outside depot hours', within: 0, box: [24, 280, 432, 20], file: 'src/dispatch/PickupWindow.tsx', line: 40 }),
    at({ role: 'button', name: 'Dispatch', within: 0, box: [340, 312, 116, 36], file: 'src/dispatch/DispatchDrawer.tsx', line: 96 }),
  ],
};

/** The decoy surface: the same words, the warning *above* the field. */
const SETTINGS: SubjectLexicon = {
  subject: 'shipping/carrier-settings--unverified',
  boundaries: 4,
  terms: { example: ['CarrierSettings'] },
  landmarks: [
    at({ role: 'region', name: 'Carrier settings', box: [0, 0, 600, 200], file: 'src/settings/CarrierSettings.tsx', line: 12 }),
    at({ role: 'status', text: 'No active contract on file', within: 0, box: [16, 24, 568, 20], file: 'src/settings/CarrierBanner.tsx', line: 9 }),
    at({ role: 'combobox', name: 'Carrier', within: 0, box: [16, 60, 568, 40], file: 'src/settings/CarrierSettings.tsx', line: 31 }),
  ],
};

/** A surface holding neither word. It must never be walked at all. */
const UNRELATED: SubjectLexicon = {
  subject: 'billing/invoice-table--paid',
  boundaries: 3,
  terms: { example: ['InvoiceTable'] },
  landmarks: [
    at({ role: 'table', name: 'Invoices', box: [0, 0, 800, 400] }),
    at({ role: 'columnheader', name: 'Amount', within: 0, box: [0, 0, 120, 32] }),
  ],
};

/**
 * The words a run would have written for a surface, from that surface.
 *
 * One walk fills the bags and the arrangement, so a fixture that gave a subject
 * landmarks and no matching `names` and `text` would be a run that cannot
 * happen — and would let a test pass on a record no suite ever writes.
 */
const said = (subject: SubjectLexicon): SubjectLexicon => ({
  ...subject,
  terms: {
    ...subject.terms,
    names: [...new Set((subject.landmarks ?? []).map(({ name }) => name).filter((n): n is string => n !== undefined))],
    text: [...new Set((subject.landmarks ?? []).map(({ text }) => text).filter((t): t is string => t !== undefined))],
    roles: [...new Set((subject.landmarks ?? []).map(({ role }) => role).filter((r): r is string => r !== undefined))],
  },
});

const reportOf = (raw: readonly SubjectLexicon[]): RunReport => {
  const subjects = raw.map(said);
  const lexicon: LexiconReport = {
    version: 1,
    fields: ['example', 'names', 'text', 'roles'],
    subjects: [...subjects],
  };
  return {
    runVersion: 1,
    at: '2026-09-06T00:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    observations: subjects.map(({ subject }) => ({
      subject,
      verdict: 'unchanged' as const,
      because: 'same',
      changedPixels: 0,
      regions: [],
    })),
    notObserved: [],
    lexicon,
  };
};

const REPORT = reportOf([DISPATCH, SETTINGS, UNRELATED]);

describe('reading the question', () => {
  it('splits at the relation, target in front, anchor and surface behind', () => {
    expect(readQuestion('Change the warning underneath the Carrier field on the dispatch drawer')).toEqual({
      relation: 'beneath',
      target: ['warning'],
      anchor: ['carrier', 'field', 'dispatch', 'drawer'],
    });
  });

  it('keeps a question with no relation as one phrase', () => {
    // Still orientation — *which surfaces hold these things* — and the answer
    // says so by carrying no target rather than by inventing a relation.
    expect(readQuestion('the carrier field')).toEqual({ target: [], anchor: ['carrier', 'field'] });
  });
});

describe('the filter that decides what is walked', () => {
  it('never says no to a word it holds', () => {
    const holds = new Holds();
    for (const word of ['carrier', 'contract', 'dispatch']) holds.add(word);
    expect(holds.maybe('carrier')).toBe(true);
    expect(holds.maybe('contract')).toBe(true);
  });

  it('drops the surfaces that hold neither word before reading their landmarks', () => {
    const { considered, surfaces } = orient(REPORT, 'the warning under the Carrier field');
    expect(surfaces).toBe(3);
    // The invoice table says neither `carrier` nor `warning`, so it never
    // reaches the exact walk. This is the step that has to hold at scale.
    expect(considered).toBe(2);
  });
});

describe('answering where a thing is', () => {
  const { hits } = orient(
    REPORT,
    'Change the warning underneath the Carrier field on the dispatch drawer',
  );

  it('answers with a file and a line, not another id to look up', () => {
    expect(hits[0]?.target).toMatchObject({
      text: 'No active contract on file',
      file: 'src/dispatch/CarrierPicker.tsx',
      line: 78,
    });
  });

  it('beats the surface holding the same words in the wrong arrangement', () => {
    // `carrier-settings` says `carrier`, says `warning`'s text verbatim, and is
    // the wrong answer because there the warning sits *above* the field. Only
    // the rectangles separate them.
    expect(hits[0]?.subject).toBe('shipping/dispatch-drawer--carrier-unverified');
    expect(hits.map((hit) => hit.subject)).not.toContain('shipping/carrier-settings--unverified');
  });

  it('beats the second warning on the same surface', () => {
    // `Outside depot hours` is also a status, also beneath the carrier field —
    // eighty-eight pixels down instead of four. Nearer wins among equals.
    expect(hits[0]?.apart).toBe(4);
  });

  it('says where on the surface the answer sits', () => {
    expect(hits[0]?.within.map((landmark) => landmark.name)).toEqual(['Dispatch shipment']);
  });
});

describe('the one door', () => {
  // The lexicon is the orientation index: one record, one walk, one tool. A
  // relation word in the query is what says which half of that record to read,
  // and a suite that recorded no arrangement falls back to the words rather
  // than answering that it cannot.
  it('answers a relation question through `variance_locate`, with the place on it', () => {
    const printed = locate.run(REPORT, { query: 'the warning under the Carrier field on the dispatch drawer' });

    expect(printed).toContain('src/dispatch/CarrierPicker.tsx:78');
    expect(printed).toContain('No active contract on file');
    expect(printed).toContain('matched on place');
    expect(printed).not.toContain('src/settings/');
  });

  it('still answers a question with no relation in it from the words', () => {
    const printed = locate.run(REPORT, { query: 'carrier' });
    expect(printed).toContain('subject(s) match');
  });

  it('ends a question with no relation in it at a file, not at another id', () => {
    // The first five minutes is four words and no grammar. An id is where the
    // other tools start; it is not where the question ends, and the run wrote a
    // file down for every landmark it walked.
    const printed = locate.run(REPORT, { query: 'no active contract on file' });
    expect(printed).toContain('where: status “No active contract on file”');
    expect(printed).toContain('src/dispatch/CarrierPicker.tsx:78');
    expect(printed).toContain('within Dispatch shipment');
  });

  it('names the thing and not what it sits in, when the phrase names both', () => {
    // `Dispatch shipment` is two rare words against one, so the dialog
    // outscores what is on it outright and no tie-break reaches the answer.
    // Both scored and one holds the other, which is the phrase saying it named
    // a path — so the place is the enclosed one, and this is decided without a
    // rectangle anywhere.
    const printed = locate.run(REPORT, { query: 'the Pickup window on the Dispatch shipment dialog' });

    expect(printed).toContain('where: group `Pickup window` · src/dispatch/PickupWindow.tsx:22');
    expect(printed).toContain('within Dispatch shipment');
    expect(printed).not.toContain('where: dialog `Dispatch shipment`');
  });
});

describe('a run off a production build', () => {
  // What a real built Storybook records: every landmark boxed, and not one of
  // them carrying a file, a line or a testid, because the JSX-source plugin and
  // the display names are what a production build strips. Measured on a 572-
  // subject product run: 13,084 landmarks, 13,084 boxes, 0 files. The owner
  // chain is what survives, so the place has to be carried by the component.
  const built: RunReport = {
    ...reportOf([
      {
        ...DISPATCH,
        landmarks: DISPATCH.landmarks?.map(({ file, line, ...rest }, index) => ({
          ...rest,
          component: index === 2 ? 'CarrierPicker' : 'DispatchDrawer',
        })) as Landmark[],
      },
    ]),
  };
  const withJoin: RunReport = {
    ...built,
    lexicon: {
      ...built.lexicon!,
      declaredIn: { CarrierPicker: ['src/dispatch/CarrierPicker.tsx'], DispatchDrawer: ['src/dispatch/DispatchDrawer.tsx'] },
    },
  };

  it('still ends at a file, through the component that owns the thing', () => {
    const printed = locate.run(withJoin, { query: 'the warning under the Carrier field' });

    expect(printed).toContain('in `CarrierPicker` · src/dispatch/CarrierPicker.tsx');
    expect(printed).toContain('No active contract on file');
  });

  it('names the component when no source index says where it is declared', () => {
    // A run with no source index knows which component owns the thing and not
    // which file declares it. A component name is still a place to open; a
    // line number invented for it would not be.
    const printed = locate.run(built, { query: 'the warning under the Carrier field' });

    expect(printed).toContain('in `CarrierPicker`');
    expect(printed).not.toContain('.tsx');
  });
});

describe('the relation the reading cannot support', () => {
  const flat = reportOf([
    {
      ...DISPATCH,
      landmarks: DISPATCH.landmarks?.map(({ box, ...rest }) => rest as Landmark),
    },
  ]);

  it('refuses a spatial question rather than answering it from document order', () => {
    // Document order agrees with the screen often enough to be dangerous and
    // not often enough to be relied on, so the answer is a sentence about the
    // run rather than a guess with a file and a line on it.
    const answer = orient(flat, 'the warning under the Carrier field');
    expect(answer.hits).toEqual([]);
    expect(answer.laidOut).toBe(false);
    expect(answer.refused).toContain('did not resolve layout');
  });

  it('still answers a containment question, which needs no rectangles', () => {
    // Containment is read off `within`, which every landmark carries, so this
    // question survives a run that resolved no layout. What the run cannot do
    // is order the answer: nothing on the surface says `warning`, and with no
    // rectangles there is no distance to separate the six things inside the
    // dialog. So the answer is everything inside it, flagged as matched on
    // place, with the sentence among them — and the reader picks.
    const answer = orient(flat, 'the warning inside the Dispatch shipment dialog');
    expect(answer.refused).toBeUndefined();

    const hit = answer.hits[0];
    expect(hit?.targetMatched).toBe(false);
    const offered = [hit?.target, ...(hit?.alsoThere ?? [])].map((landmark) => landmark?.text);
    expect(offered).toContain('No active contract on file');
  });
});
