import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareValues, shapeValue } from '@variance-authority/core';
import { BASELINE, ROOT, countOf } from './surface.mjs';

/**
 * What we publish is a subject, and this is its baseline.
 *
 * Not a new kind of rule — an arrangement of parts that already exist, aimed at
 * an edge that had nothing on it. `@variance-authority/package` is the **source**:
 * it reads every published manifest and the source each entrypoint points at, and
 * produces one value, which `tools/surface.mjs` runs against this checkout.
 * `compareValues` is the **diff**, and it is the floor rather than the
 * point — a general JSON comparison, used here because nobody ships an `oasdiff`
 * for "the shape of a workspace's published exports" the way somebody ships one
 * for OpenAPI. Where a real detector exists, it produces the diff and this layer
 * reads it instead.
 *
 * The layer worth having is the third one. A delta carries a *fingerprint* —
 * dialect, wildcarded pointer, change kind, hashed and stable across commits —
 * so `removed /@variance-authority~1core/names/./digestValue` is the same finding
 * tomorrow as it was today, under whatever commit, in whatever order it was
 * found. That is what makes an approval durable and a recurrence countable, and
 * it is the part neither the source nor the comparison supplies.
 *
 * The rule this file enforces is deliberately small: **the surface is what the
 * baseline says it is**. Adding an export is normal and cheap to record; the
 * failure exists so that removing one, renaming one, or closing a subpath is a
 * line in a review rather than something an adopter's build discovers.
 *
 * ```bash
 * yarn surface --write
 * ```
 */

const DIALECT = 'package-surface';

/** What a package offers, and what each entrypoint it opens reaches. */
type Published = {
  readonly declared: { readonly exports?: Record<string, unknown> };
  readonly names: Record<string, Record<string, string>>;
};

/** The baseline is stored readable and re-shaped here, not stored canonical. */
const recorded = (): unknown => JSON.parse(readFileSync(BASELINE, 'utf8'));

const produced = (): Record<string, Published> =>
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
            'them with `yarn surface --write` — and read the removals twice, because ' +
            "those are the ones somebody else's build finds out about.",
    ).toBe('');
  });

  it('reads every entrypoint it says a package opens', () => {
    const unread: string[] = [];
    for (const [pkg, published] of Object.entries(produced())) {
      for (const [subpath, condition] of Object.entries(published.declared.exports ?? {})) {
        // A subpath with no `types` is a file we publish without declarations —
        // `jsx-source`'s `./jest-resolver` is one — and it is recorded under
        // `declared` rather than read. A subpath *with* one has a source file
        // behind it, and an empty reading of it means the producer gave up quietly.
        const typed = typeof condition === 'object' && condition !== null && 'types' in condition;
        const names = published.names[subpath];
        if (typed && (names === undefined || Object.keys(names).length === 0)) {
          unread.push(`${pkg}${subpath.slice(1)}`);
        }
      }
    }

    expect(unread).toEqual([]);
  });

  it('is large enough that a silent emptying would show', () => {
    // A resolver bug returns nothing rather than something wrong, and a baseline
    // rewritten from an empty surface would then agree with it forever.
    expect(countOf(produced())).toBeGreaterThan(1000);
  });
});

/** A number, spelled or dialled, applied to what this workspace holds. */
const NUMBERED =
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand)(?:-\w+)?[ -](?:packages|names|manifests|boxes|workspaces)\b/gi;

/** `over a thousand names` is a floor and stays true; `fourteen hundred` is not. */
const FLOORED = /\b(?:over|than|least|about|around|nearly|almost)\s+(?:a\s+)?$/i;

/** The sizes a text states outright, floors excluded. */
function counted(text: string): string[] {
  return [...text.matchAll(NUMBERED)]
    .filter((match) => !FLOORED.test(text.slice(Math.max(0, match.index - 24), match.index)))
    .map((match) => match[0].trim());
}

/**
 * Prose that describes this reading states a floor, not a count.
 *
 * `packages/help/src/server.ts` justifies re-reading the checkout on every MCP
 * request by naming what the reading costs, and it named it as "twenty-five
 * packages and fourteen hundred names". True when written, wrong three packages
 * later, and wrong in the silent direction — nothing reads a comment, and that
 * one is not the server's self-description either, so no client could ever have
 * contradicted it. `tools/surface.mjs` carried the same twenty-five.
 *
 * Here rather than with the documentation rules because the floor is already in
 * this file: `is large enough that a silent emptying would show` refuses a
 * surface under a thousand names, which is the same thousand the prose claims.
 * One number, asserted once, quoted in words next door.
 *
 * Deliberately not a general ban on counting packages. ADR-0024 says "it held
 * for fourteen packages and then stopped answering the question anyone had",
 * and that sentence is a record of when a rule broke — it is *supposed* to stay
 * at fourteen. The difference is tense, which no regular expression can see, so
 * the list is named: the files that narrate the reading in the present tense.
 */
describe('what the prose claims about this reading', () => {
  /** Present tense about the current workspace, as opposed to a record of history. */
  const NARRATORS = ['packages/help/src/server.ts', 'tools/surface.mjs'];

  it('still catches the sentence it was written for, and lets a floor through', () => {
    // Verbatim from `server.ts`, so a loosened pattern cannot quietly turn the
    // rule below into one that reads every file and finds nothing by construction.
    expect(counted('Twenty-five packages and fourteen hundred names take under 200ms')).toEqual([
      'Twenty-five packages',
      'hundred names',
    ]);
    expect(counted('every package it publishes, well over a thousand exported names')).toEqual([]);
    expect(counted('and more than 25 packages went past')).toEqual([]);
  });

  it.each(NARRATORS)('%s counts no packages and no names', (file) => {
    expect(
      counted(readFileSync(join(ROOT, file), 'utf8')),
      `${file} states a size the next package falsifies; say a floor instead`,
    ).toEqual([]);
  });
});
