import { describe, expect, it } from 'vitest';
import { CHROMIUM_PROFILE, JSDOM_PROFILE, capture, node } from '../rules/normalize/fixture.js';
import { normalize } from '../rules/normalize/index.js';
import type { SubjectComposition } from './composition.js';
import { instance } from './composition-fixture.js';
import { LANDMARK_CAP } from './landmark.js';
import { lexiconOf } from './lexicon.js';

/**
 * The half of the lexicon that keeps where things were.
 *
 * A bag of words can say a subject holds `carrier` and holds `contract`. It can
 * never say the second sits beneath the first, and *beneath* is most of what a
 * person arriving at a screen is actually holding. These assertions are the
 * places that distinction is cheap to lose: a container that swallows its
 * children's sentences, a wrapper stack that buries what encloses what, and a
 * reading with no layout answering a spatial question anyway.
 */

/**
 * A drawer with a field, a warning under it, and a button under that — each
 * written in a different file, wrapped the way a real application wraps things.
 */
const drawer = (rect: boolean) =>
  node({
    tag: 'div',
    role: 'dialog',
    name: 'Dispatch shipment',
    ...(rect ? { rect: { x: 0, y: 100, width: 480, height: 300 } } : {}),
    source: { file: 'src/dispatch/DispatchDrawer.tsx', line: 31 },
    children: [
      // Two wrappers a styling library and a layout needed. Neither says
      // anything, so neither is a landmark, and what they enclose still knows
      // the dialog is what encloses it.
      node({
        tag: 'div',
        children: [
          node({
            tag: 'div',
            children: [
              node({
                tag: 'div',
                role: 'combobox',
                name: 'Carrier',
                ...(rect ? { rect: { x: 24, y: 148, width: 432, height: 40 } } : {}),
                source: { file: 'src/dispatch/CarrierPicker.tsx', line: 64 },
              }),
              node({
                tag: 'p',
                role: 'status',
                ...(rect ? { rect: { x: 24, y: 192, width: 432, height: 20 } } : {}),
                source: { file: 'src/dispatch/CarrierPicker.tsx', line: 78 },
                children: [node({ tag: '#text', text: 'No active contract on file' })],
              }),
            ],
          }),
        ],
      }),
      node({
        tag: 'button',
        role: 'button',
        name: 'Dispatch',
        ...(rect ? { rect: { x: 340, y: 312, width: 116, height: 36 } } : {}),
        source: { file: 'src/dispatch/DispatchDrawer.tsx', line: 96 },
        children: [node({ tag: '#text', text: 'Dispatch' })],
      }),
    ],
  });

const surfaceOf = (rect: boolean): SubjectComposition => ({
  subject: 'shipping/dispatch-drawer--carrier-unverified',
  instances: [instance({ component: 'DispatchDrawer', path: '0', depth: 0 })],
  snapshot: normalize(
    capture({ root: drawer(rect), profile: rect ? CHROMIUM_PROFILE : JSDOM_PROFILE }),
  ),
});

describe('the landmarks a run keeps, beside the words', () => {
  const [row] = lexiconOf([surfaceOf(true)]);
  const landmarks = row?.landmarks ?? [];
  const named = (name: string) => landmarks.find((landmark) => landmark.name === name);
  const withText = (text: string) => landmarks.find((landmark) => landmark.text === text);

  it('keeps only what says something, however deep the wrappers go', () => {
    // Three wrapper divs between the dialog and the field, and none of them is
    // a landmark: the test is what a node says, not what it is called, which is
    // why an era of higher-order components costs nothing here.
    expect(landmarks).toHaveLength(4);
    expect(landmarks.map((landmark) => landmark.role)).toEqual([
      'dialog',
      'combobox',
      'status',
      'button',
    ]);
  });

  it('names the nearest enclosing landmark, not the nearest node', () => {
    const dialog = landmarks.indexOf(named('Dispatch shipment')!);
    expect(named('Carrier')?.within).toBe(dialog);
    expect(withText('No active contract on file')?.within).toBe(dialog);
  });

  it('leaves a sentence on the thing that says it', () => {
    // The dialog encloses the warning and does not hold its words. A container
    // that inherited them would answer "where does this sentence live" with
    // "on the page", which is not an answer.
    expect(named('Dispatch shipment')?.text).toBeUndefined();
    expect(withText('No active contract on file')?.role).toBe('status');
  });

  it('carries the file and line of each one separately', () => {
    expect(named('Carrier')).toMatchObject({ file: 'src/dispatch/CarrierPicker.tsx', line: 64 });
    expect(withText('No active contract on file')).toMatchObject({
      file: 'src/dispatch/CarrierPicker.tsx',
      line: 78,
    });
    expect(named('Dispatch')).toMatchObject({ file: 'src/dispatch/DispatchDrawer.tsx', line: 96 });
  });

  it('records the rectangle, so beneath is observed rather than assumed', () => {
    const field = named('Carrier')!;
    const warning = withText('No active contract on file')!;
    expect(field.box).toEqual([24, 148, 432, 40]);
    expect(warning.box).toEqual([24, 192, 432, 20]);
    // The one arithmetic the record makes possible and does not itself perform.
    expect(warning.box![1]).toBeGreaterThanOrEqual(field.box![1] + field.box![3]);
  });

  it('still indexes every word it saw, in the same pass', () => {
    // One walk, both halves. A second walk would eventually disagree with the
    // first about what was on the screen.
    expect(row?.terms.names).toContain('Carrier');
    expect(row?.terms.text).toContain('No active contract on file');
    expect(row?.terms.roles).toContain('status');
  });
});

describe('a reading that did not resolve layout', () => {
  const [row] = lexiconOf([surfaceOf(false)]);

  it('keeps the arrangement and omits every box', () => {
    // Absent, never zeroed. A box of zeroes would let a reader answer a
    // question about what sits beneath what, confidently and from nothing.
    expect(row?.landmarks).toHaveLength(4);
    expect(row?.landmarks?.every((landmark) => landmark.box === undefined)).toBe(true);
  });
});

describe('a subject with no snapshot', () => {
  it('carries no landmarks at all rather than an empty list', () => {
    // A dialog with nothing on it and a run that never looked are different
    // sentences, and a reader that cannot tell them apart reports the second
    // as the first.
    const [row] = lexiconOf([
      { subject: 'story:unread', instances: [instance({ component: 'Root', path: '0', depth: 0 })] },
    ]);
    expect(row?.landmarks).toBeUndefined();
  });
});

describe('a surface wider than the cap', () => {
  const rows = Array.from({ length: LANDMARK_CAP + 50 }, (_, at) =>
    node({
      tag: 'li',
      role: 'listitem',
      ...(at % 2 === 0 ? { name: `row ${at}` } : {}),
    }),
  );
  const [row] = lexiconOf([
    {
      subject: 'story:long-table',
      instances: [instance({ component: 'Table', path: '0', depth: 0 })],
      snapshot: normalize(
        capture({ root: node({ tag: 'ul', role: 'list', name: 'Shipments', children: rows }) }),
      ),
    },
  ]);

  it('keeps the ones a question can reach and counts what it cut', () => {
    expect(row?.landmarks).toHaveLength(LANDMARK_CAP);
    expect(row?.elidedLandmarks).toBe(51);
    // Every named row survives, and the unnamed ones fill what is left: worth
    // decides what is kept, and a row a question could ask for outranks one it
    // could not.
    const named = Math.ceil((LANDMARK_CAP + 50) / 2) + 1;
    expect(row?.landmarks?.filter((landmark) => landmark.name !== undefined).length).toBe(named);
  });

  it('rewrites containment onto what survived, so no index points at the wrong thing', () => {
    const list = row?.landmarks?.findIndex((landmark) => landmark.name === 'Shipments');
    expect(list).toBe(0);
    const enclosed = row?.landmarks?.slice(1).every((landmark) => landmark.within === 0);
    expect(enclosed).toBe(true);
  });
});
