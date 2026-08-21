import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareValues, shapeValue } from '@variance-authority/core';
import { BASELINE, countOf } from './surface.mjs';

/**
 * What we publish is a subject, and this is its baseline.
 *
 * Not a new kind of rule — an arrangement of parts that already exist, aimed at
 * an edge that had nothing on it. `tools/surface.mjs` is the **source**: it reads
 * the built declarations and produces one value. `compareValues` is the **diff**,
 * and it is the floor rather than the point — a general JSON comparison, used
 * here because nobody ships an `oasdiff` for "the shape of a workspace's
 * published exports" the way somebody ships one for OpenAPI. Where a real
 * detector exists, it produces the diff and this layer reads it instead.
 *
 * The layer worth having is the third one. A delta carries a *fingerprint* —
 * dialect, wildcarded pointer, change kind, hashed and stable across commits —
 * so `removed /@variance-authority~1core/entrypoints/./exports/digestValue` is
 * the same finding tomorrow as it was today, under whatever commit, in whatever
 * order it was found. That is what makes an approval durable and a recurrence
 * countable, and it is the part neither the source nor the comparison supplies.
 *
 * The rule this file enforces is deliberately small: **the surface is what the
 * baseline says it is**. Adding an export is normal and cheap to record; the
 * failure exists so that removing one, renaming one, or closing a subpath is a
 * line in a review rather than something an adopter's build discovers.
 *
 * ```bash
 * yarn build && yarn surface --write
 * ```
 */

const DIALECT = 'package-surface';

/** The baseline is stored readable and re-shaped here, not stored canonical. */
const recorded = (): unknown => JSON.parse(readFileSync(BASELINE, 'utf8'));

const produced = (): unknown =>
  JSON.parse(execFileSync('node', ['tools/surface.mjs'], { encoding: 'utf8', maxBuffer: 32e6 }));

describe('published surface', () => {
  it('is what the baseline records', () => {
    const baseline = shapeValue(recorded(), { dialect: DIALECT });
    const candidate = shapeValue(produced(), { dialect: DIALECT });
    const deltas = compareValues(baseline, candidate);

    const report = deltas
      .map((delta) => `  ${delta.change.padEnd(13)} ${delta.pointer}\n      ${delta.fingerprint}`)
      .join('\n');

    expect(
      deltas.length === 0
        ? ''
        : `${deltas.length} change(s) to what this repository publishes:\n\n${report}\n\n` +
            'Each fingerprint is stable across commits, so an approval carries. Record ' +
            'them with `yarn build && yarn surface --write` — and read the removals ' +
            "twice, because those are the ones somebody else's build finds out about.",
    ).toBe('');
  });

  it('has no name the producer could not read', () => {
    const value = produced() as Record<string, { entrypoints: Record<string, { exports: Record<string, string> }> }>;
    const unreadable: string[] = [];
    for (const [pkg, published] of Object.entries(value)) {
      for (const [subpath, entry] of Object.entries(published.entrypoints)) {
        for (const [name, kind] of Object.entries(entry.exports)) {
          if (kind.includes('unknown')) unreadable.push(`${pkg}${subpath.slice(1)} ${name}`);
        }
      }
    }

    // `foreign` is a fact about us — `jsx-source` forwards React's `JSX` and
    // cannot see through it. `unknown` is a fact about the parser: it met a
    // declaration form it does not read, and the baseline is short a name.
    expect(unreadable).toEqual([]);
  });

  it('is large enough that a silent emptying would show', () => {
    // A resolver bug returns nothing rather than something wrong, and a baseline
    // rewritten from an empty surface would then agree with it forever.
    expect(countOf(produced())).toBeGreaterThan(1000);
  });
});
