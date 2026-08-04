import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { documentDigest, type RenderDocument } from '@variance-authority/core';
import type { Found, Renderer } from '@variance-authority/raster';
import type { Collector, Plan } from './run.js';
import {
  IDENTITY,
  VIEWPORT,
  collectorOf,
  configOf,
  documentFor,
  runWith,
  storeAnswering,
} from './run-fixture.js';

/**
 * The corner-cut this whole project is built on is that the world is not rebuilt
 * between subjects, and the risk it buys is that subject B renders differently
 * because subject A ran first. A comparison cannot tell that apart from a
 * regression: both arrive as "the pixels moved".
 *
 * Every case here is the *deterministic* leak, and that is the point. The
 * detection `@variance-authority/session` already implements re-runs a subject
 * in the same session and compares hashes, which varies time and holds the world
 * fixed — so a leak that happens every time never moves the hash and is reported
 * as nothing at all. These subjects would pass that check and still be wrong.
 */
describe('a change that does not survive a clean world', () => {
  const WHITE = png(255);
  const BLACK = png(0);

  /**
   * A real PNG, because the comparison decodes one and a stub does not survive
   * `PNG.sync.read`. Hand-rolled on `node:zlib` rather than on `pngjs`, which
   * would be a fourth package declaring the same requirement to write ten pixels.
   */
  function png(level: number): string {
    const raw = Buffer.alloc(10 * (1 + 10 * 4));
    for (let y = 0; y < 10; y += 1) {
      const row = y * (1 + 10 * 4);
      raw[row] = 0;
      for (let x = 0; x < 10; x += 1) {
        const at = row + 1 + x * 4;
        raw[at] = level;
        raw[at + 1] = level;
        raw[at + 2] = level;
        raw[at + 3] = 255;
      }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(10, 0);
    ihdr.writeUInt32BE(10, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]).toString('base64');
  }

  function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  }

  function crc32(bytes: Buffer): number {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
      }
    }
    return (value ^ 0xffffffff) >>> 0;
  }

  /**
   * `dark` is what a leaked stylesheet did to this subject; `plain` is the truth.
   *
   * Carried in the html rather than in a hash field, because `documentDigest`
   * covers the document's own inputs and not the snapshot's derived hashes — a
   * marker the digest cannot see settles against the baseline and never reaches
   * a comparison at all.
   */
  function documentPainted(id: string, paint: 'plain' | 'dark'): RenderDocument {
    return documentFor(id, `<div data-va-path="0" data-paint="${paint}">x</div>`);
  }

  function painter(): Renderer {
    return {
      identity: IDENTITY,
      identityFor(document) {
        return { ...IDENTITY, deviceScaleFactor: document.viewport.deviceScaleFactor };
      },
      async render(document) {
        return {
          documentDigest: documentDigest(document),
          identity: { ...IDENTITY, deviceScaleFactor: document.viewport.deviceScaleFactor },
          width: 10,
          height: 10,
          bytes: document.html.includes('data-paint="dark"') ? BLACK : WHITE,
          missingFonts: [],
        };
      },
      async close() {
        /* nothing to release */
      },
    };
  }

  /** The baseline: this subject, painted from a document nothing had polluted. */
  function baselineOf(id: string): Found {
    const clean = documentPainted(id, 'plain');
    return {
      raster: {
        documentDigest: documentDigest(clean),
        identity: { ...IDENTITY, deviceScaleFactor: VIEWPORT.deviceScaleFactor },
        width: 10,
        height: 10,
        bytes: WHITE,
        missingFonts: [],
      },
      comparable: true,
      storedUnder: IDENTITY,
    };
  }

  /**
   * A collector whose shared world is poisoned and whose clean world is not.
   *
   * `collect` returns the same polluted document every time it is asked, which is
   * exactly the failure a same-session re-run cannot see.
   */
  function leaking(
    ids: readonly string[],
    options: { alone?: 'plain' | 'dark'; shared?: 'plain' | 'dark' } = {},
  ): Collector & { aloneCalls: string[] } {
    const aloneCalls: string[] = [];
    const plan: Plan = {
      subjects: ids.map((id) => ({ subject: { id, kind: 'fixture' as const } })),
      notObserved: [],
      warnings: [],
    };

    return {
      aloneCalls,
      async plan() {
        return plan;
      },
      async collect(subject) {
        return { ok: true, document: documentPainted(subject.subject.id, options.shared ?? 'dark') };
      },
      async collectAlone(subject) {
        aloneCalls.push(subject.subject.id);
        return { ok: true, document: documentPainted(subject.subject.id, options.alone ?? 'plain') };
      },
      async close() {
        /* nothing to release */
      },
    };
  }

  it('calls it order dependence when the difference is gone with nothing else in the world', async () => {
    const collector = leaking(['fixture:a']);
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    const [observation] = report.observations;
    // The verdict stays `changed`, and that is deliberate: the pixels really did
    // move. What the second pass adds is *why*, and the two need opposite work.
    expect(observation?.verdict).toBe('changed');
    expect(observation?.alone?.reproduced).toBe(false);
    expect(observation?.alone?.because).toContain('gone when nothing else has run');
    expect(collector.aloneCalls).toEqual(['fixture:a']);
  });

  it('leaves a real change standing, because it is still there alone', async () => {
    // Same shape, one difference: the clean world shows the change too. Nothing
    // here may soften a regression — a second render that can only clear a
    // failure is a retry, and this is not one.
    const collector = leaking(['fixture:a'], { alone: 'dark' });
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.verdict).toBe('changed');
    expect(report.observations[0]?.alone?.reproduced).toBe(true);
    expect(report.observations[0]?.alone?.because).toContain('still there');
  });

  it('never re-collects a subject that did not change, so a green run pays nothing', async () => {
    const collector = leaking(['fixture:a'], { shared: 'plain' });
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.verdict).toBe('unchanged');
    expect(report.observations[0]?.alone).toBeUndefined();
    expect(collector.aloneCalls).toEqual([]);
  });

  it('says the collector has no clean world, rather than reading silence as clean', async () => {
    // A collector holding one page open across the whole run cannot produce one,
    // and the absent capability has to arrive as a sentence. Read as "it
    // reproduces", a missing method promotes every leak with a confirmation
    // attached to it.
    const collector = collectorOf(
      { subjects: [{ subject: { id: 'fixture:a', kind: 'fixture' } }], notObserved: [], warnings: [] },
      (subject) => ({ ok: true, document: documentPainted(subject.subject.id, 'dark') }),
    );

    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.alone?.reproduced).toBe(true);
    expect(report.observations[0]?.alone?.because).toContain('no `collectAlone`');
  });

  it('stops at the budget and says so, so a token change cannot buy full isolation', async () => {
    // The one case where this pass costs more than the isolation it replaces:
    // everything changed, so everything would be re-collected. The cap is the
    // answer, and a cap that is not reported reads as coverage.
    const collector = leaking(['fixture:a', 'fixture:b', 'fixture:c']);
    const store = storeAnswering(baselineOf('fixture:a'));

    const { report } = await runWith(configOf({ alone: { limit: 2 } }), collector, store, {
      renderer: painter(),
    });

    // Spent across the run rather than per subject: two re-collections, not three.
    expect(collector.aloneCalls).toEqual(['fixture:a', 'fixture:b']);
    expect(report.observations[2]?.alone?.reproduced).toBe(true);
    expect(report.observations[2]?.alone?.because).toContain('budget of 2 subjects');
  });

  it('turns the pass off at zero without claiming anything about the change', async () => {
    // `limit: 0` is a decision and an absent `collectAlone` is a missing
    // capability. Both skip the work; only one of them is worth a sentence about
    // the collector, so the operator who chose this is not told to write a method
    // they already wrote.
    const collector = leaking(['fixture:a']);
    const { report } = await runWith(configOf({ alone: { limit: 0 } }), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.verdict).toBe('changed');
    expect(report.observations[0]?.alone).toBeUndefined();
    expect(collector.aloneCalls).toEqual([]);
  });
});
