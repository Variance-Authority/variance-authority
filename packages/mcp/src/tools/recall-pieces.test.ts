import type { CompositionReport, RunReport, SubjectPiecesRecord } from '@variance-authority/report';
import { describe, expect, it } from 'vitest';
import { recallPieces } from './recall-pieces.js';
import { recall } from './recall.js';

/** One subject read as the narrower subjects inside it, the way `variance_composition` prints it. */

const page: SubjectPiecesRecord = {
  footprint: 6,
  structure: 1,
  alike: [],
  pieces: [
    { subject: 'story:footer', footprint: 2, shared: 2 },
    { subject: 'story:chip', footprint: 1, shared: 1 },
  ],
  wholes: [],
  explained: 3,
  own: [{ component: 'Counter', renderings: 1 }, { component: 'Layout', renderings: 2 }],
  inContext: [{ component: 'Chip', renderings: 1, pieces: ['story:footer', 'story:chip'] }],
};

describe('one subject, as the narrower subjects inside it', () => {
  it('names its pieces, then splits what they leave into its own components and components in context', () => {
    expect(recallPieces(page).split('\n')).toEqual([
      '6 renderings of its own; 1 structural component, mounted by more than half the suite, is left out.',
      'pieces, smaller subjects inside it, most shared first:',
      '  story:footer  (2 of its 2 renderings inside it)',
      '  story:chip  (1 of its 1 rendering inside it)',
      'pieces render 3 of its 6 renderings. The other 3 no piece renders:',
      '  its own, in components no piece mounts:',
      '    Counter  (1 rendering)',
      '    Layout  (2 renderings)',
      '  in context, components a piece renders another way:',
      '    Chip  (1 rendering; story:footer, story:chip render it otherwise)',
    ]);
  });

  it('names the larger subjects holding it and its twins, and says when nothing is its alone', () => {
    const chip: SubjectPiecesRecord = {
      footprint: 1,
      structure: 1,
      alike: ['story:chip again'],
      pieces: [],
      wholes: [{ subject: 'story:footer', footprint: 2, shared: 1 }, { subject: 'story:page', footprint: 6, shared: 1 }],
      explained: 0,
      own: [{ component: 'Chip', renderings: 1 }],
      inContext: [],
    };
    expect(recallPieces(chip).split('\n')).toEqual([
      '1 rendering of its own; 1 structural component, mounted by more than half the suite, is left out.',
      '1 other subject renders exactly the same: story:chip again',
      'wholes, larger subjects holding it, smallest first:',
      '  story:footer  (2 renderings, 1 of the 1 inside it)',
      '  story:page  (6 renderings, 1 of the 1 inside it)',
      'no piece renders any of its 1 rendering:',
      '  its own, in components no piece mounts:',
      '    Chip  (1 rendering)',
    ]);
    const explained = { ...page, own: [], inContext: [], explained: 6 };
    expect(recallPieces(explained)).toContain('its pieces render all 6 renderings: nothing is its alone.');
  });

  it('says a subject made only of structure has no footprint to compare', () => {
    const blank: SubjectPiecesRecord = { footprint: 0, structure: 2, alike: [], pieces: [], wholes: [], explained: 0, own: [], inContext: [] };
    expect(recallPieces(blank)).toBe('nothing of its own: all 2 components it mounts are structure, mounted by more than half the suite.');
  });

  it('follows the tree and the shared renderings in the recall, and stays out of a report written before it', () => {
    const composed: CompositionReport = {
      subjects: ['story:page'],
      components: [],
      echoes: [],
      divergences: [],
      movements: [],
      structure: [{ subject: 'story:page', rows: [{ component: 'Layout', depth: 0, count: 1, variants: 1 }], pieces: page }],
    };
    const report = {} as RunReport;
    const answer = recall(report, composed, 'story:page');
    expect(answer).toContain('  Layout\n\n6 renderings of its own');

    const before = { ...composed, structure: [{ subject: 'story:page', rows: [{ component: 'Layout', depth: 0, count: 1, variants: 1 }] }] };
    expect(recall(report, before, 'story:page')).not.toContain('renderings of its own');
  });
});
