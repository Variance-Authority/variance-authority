import { describe, expect, it } from 'vitest';
import type { EyesArchive, TargetSnapshot } from '@variance-authority/eyes';
import { attention } from './attention.js';

const BUTTON: TargetSnapshot = {
  nodeName: 'button',
  role: 'button',
  ariaLabel: 'Redraw',
  provenance: {
    status: 'resolved',
    provenance: {
      owners: [{ name: 'DrawingPanel', propsDigest: 'props' }],
      createdBy: 'RedrawButton',
      source: { file: 'src/drawing/RedrawButton.tsx', line: 17, column: 5 },
    },
  },
};

const ARCHIVE: EyesArchive = {
  eyesVersion: 1,
  tests: [{
    id: 'redraw-test',
    title: 'redraws the canvas',
    file: 'test/drawing.test.tsx',
    complete: true,
    attention: [
      { kind: 'eyes-phase', phase: 'arrange', sequence: 0 },
      {
        kind: 'rtl-query',
        query: 'getByRole',
        arguments: ['button', { name: 'Redraw' }],
        outcome: 'resolved',
        targets: [BUTTON],
        sequence: 1,
      },
      { kind: 'eyes-phase', phase: 'act', sequence: 2 },
      {
        kind: 'document-event',
        event: 'click',
        trusted: false,
        target: BUTTON,
        sequence: 3,
      },
      {
        kind: 'react-commit',
        commit: {
          at: 7,
          components: ['DrawingPanel', 'Canvas'],
          updaters: [{
            path: [{ name: 'DrawingPanel', key: null, propsDigest: 'props' }],
          }],
        },
        sequence: 4,
      },
      { kind: 'eyes-phase', phase: 'assert', sequence: 5 },
      {
        kind: 'playwright-locator',
        operation: 'assertion',
        member: 'to.have.text',
        locator: [{ member: 'getByRole', arguments: ['button', { name: 'Redraw' }] }],
        before: [BUTTON],
        after: [BUTTON],
        outcome: 'resolved',
        sequence: 6,
      },
    ],
  }],
};

describe('variance_test_attention', () => {
  it('lists test-scoped evidence with completion state and stable identity', () => {
    expect(attention.run(ARCHIVE, {})).toContain(
      'complete — redraws the canvas — test/drawing.test.tsx [redraw-test]',
    );
  });

  it('reports selectors, events and synchronous Fiber attribution in authored order', () => {
    const text = attention.run(ARCHIVE, { test: 'redraw-test' });

    expect(text).toContain('#1 [arrange] getByRole');
    expect(text).toContain('#3 [act] document click (synthetic)');
    expect(text).toContain('#4 [act] React commit → rendered DrawingPanel, Canvas');
    expect(text).toContain('update initiators: DrawingPanel');
    expect(text).toContain('#6 [assert] assertion to.have.text');
    expect(text).toContain('DrawingPanel at src/drawing/RedrawButton.tsx:17');
  });

  it('names a test by its id or whole title, never a part of it', () => {
    expect(attention.run(ARCHIVE, { test: 'redraws the canvas' })).toContain('redraws the canvas — ');
    for (const asked of ['redraws', 'Redraws the canvas']) {
      expect(attention.run(ARCHIVE, { test: asked })).toBe(
        `No Eyes test has the id or title ${asked}. 1 test(s) are recorded.`,
      );
    }
  });

  it('lists a title two tests share with their ids, rather than answering with either', () => {
    const [test] = ARCHIVE.tests;
    const twice: EyesArchive = { ...ARCHIVE, tests: [test!, { ...test!, id: 'redraw-again' }] };

    expect(attention.run(twice, { test: 'redraws the canvas' })).toBe(
      '2 Eyes tests are titled redraws the canvas; ask by id:\n  redraws the canvas [redraw-test]\n  redraws the canvas [redraw-again]',
    );
  });

  it('filters by an authored phase without classifying calls itself', () => {
    const text = attention.run(ARCHIVE, { test: 'redraw-test', phase: 'act' });

    expect(text).toContain('Authored phase: act.');
    expect(text).toContain('document click');
    expect(text).not.toContain('getByRole("button"');
  });
});
