import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEyesArchive, readEyesArchive } from './archive.js';

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
});
