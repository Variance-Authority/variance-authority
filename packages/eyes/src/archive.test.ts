import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEyesArchive, parseEyesJournal, readEyesArchive } from './archive.js';

describe('portable Eyes evidence', () => {
  it('validates phase-bearing test attention from JSON', () => {
    expect(parseEyesArchive({
      eyesVersion: 1,
      tests: [{
        id: 'test-1',
        title: 'redraws',
        file: 'redraw.spec.ts',
        complete: true,
        attention: [{ kind: 'eyes-phase', phase: 'arrange', sequence: 0 }],
      }],
    })).toMatchObject({
      eyesVersion: 1,
      tests: [{ attention: [{ phase: 'arrange' }] }],
    });
  });

  it('validates portable updater paths without turning absence into an empty set', () => {
    const archive = parseEyesArchive({
      eyesVersion: 1,
      tests: [{
        id: 'test-1',
        title: 'redraws',
        complete: true,
        attention: [{
          kind: 'react-commit',
          sequence: 0,
          commit: {
            at: 12,
            components: ['Canvas'],
            updaters: [{
              path: [
                { name: 'Canvas', key: null, propsDigest: 'canvas-props' },
                { name: 'DrawingPage', key: null, propsDigest: 'page-props' },
              ],
              source: { file: 'src/Canvas.tsx', line: 12, column: 0 },
            }],
          },
        }],
      }],
    });

    const attention = archive.tests[0]?.attention[0];
    expect(attention?.kind).toBe('react-commit');
    if (attention?.kind === 'react-commit') {
      expect(attention.commit.updaters?.[0]?.path[0]?.name).toBe('Canvas');
      expect(attention.commit.updaters?.[0]?.source?.column).toBe(0);
    }
  });

  it('carries a tap refusal across the boundary, and rejects a reason it cannot read', () => {
    const refused = (reason: string): unknown => ({
      eyesVersion: 1,
      tests: [{
        id: 'test-1',
        title: 'redraws',
        complete: true,
        attention: [{ kind: 'react-tap-refused', reason, sequence: 0 }],
      }],
    });

    expect(parseEyesArchive(refused('no-hook'))).toMatchObject({
      tests: [{ attention: [{ kind: 'react-tap-refused', reason: 'no-hook' }] }],
    });
    // A reason invented by a newer producer is not a refusal this reader can
    // present, and passing it through would put an unexplained word in a report.
    expect(() => parseEyesArchive(refused('gave-up'))).toThrow(/unknown tap refusal/);
  });

  it('reads the same contract from a runner-owned JSON artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-eyes-'));
    const path = join(directory, 'eyes.json');
    try {
      await writeFile(path, JSON.stringify({
        eyesVersion: 1,
        tests: [{ id: 'test-1', title: 'redraws', complete: true, attention: [] }],
      }));
      await expect(readEyesArchive(path)).resolves.toMatchObject({ eyesVersion: 1 });
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('carries which tests were watched across the boundary, and leaves it absent when the producer did not say', () => {
    const test = { id: 'test-1', title: 'redraws', complete: true, attention: [] };
    expect(parseEyesArchive({ eyesVersion: 1, watched: ['test-1', 'test-2'], tests: [test] }).watched).toEqual(['test-1', 'test-2']);
    expect(parseEyesArchive({ eyesVersion: 1, tests: [test] })).not.toHaveProperty('watched');
    expect(() => parseEyesArchive({ eyesVersion: 1, watched: 'test-1', tests: [] })).toThrow('eyes archive watched must be an array');
  });

  it('refuses unsupported versions and invented empty partial evidence', () => {
    expect(() => parseEyesArchive({ eyesVersion: 2, tests: [] })).toThrow(/unsupported/);
    expect(() => parseEyesArchive({
      eyesVersion: 1,
      tests: [{ id: 'test-1', title: 'redraws', complete: false, attention: [] }],
    })).toThrow(/partial reason/);
  });

  it('rejects malformed attribution instead of trusting a known attention kind', () => {
    expect(() => parseEyesArchive({
      eyesVersion: 1,
      tests: [{
        id: 'test-1',
        title: 'uses a button',
        complete: true,
        attention: [{
          kind: 'document-event',
          event: 'click',
          trusted: true,
          target: { nodeName: 'button', provenance: { status: 'resolved', provenance: {} } },
          sequence: 0,
        }],
      }],
    })).toThrow(/owners must be an array/);
  });

  it('refuses a journal a record carries when it cannot say whether it is complete, or holds no attention list', () => {
    expect(parseEyesJournal({ complete: true, attention: [] })).toEqual({ complete: true, attention: [] });
    expect(() => parseEyesJournal({ complete: 'yes', attention: [] }, 'journal'))
      .toThrow('journal complete must be boolean');
    expect(() => parseEyesJournal({ complete: true, attention: {} }, 'journal'))
      .toThrow('journal attention must be an array');
  });
});
