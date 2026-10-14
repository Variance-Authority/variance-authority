import { createRequire } from 'node:module';

import type { BlockKind } from '../instrument/index.js';

/**
 * The record's layout as the native addon reads it: one file, `record-layout.json`,
 * that both the addon and this package read, so a version, a sentinel or a
 * section name is written once and the two sides cannot drift.
 */
export interface RecordLayout {
  readonly alignment: number;
  readonly packAbove: number;
  readonly run: number;
  readonly blobRun: number;
  readonly codecs: { readonly raw: number; readonly zstd: number };
  readonly levels: { readonly numbers: number; readonly text: number };
  readonly coverage: {
    /** The `version` a decoded `TestCoverage` carries, which the record's own format number does not. */
    readonly model: 3;
    readonly format: number;
    readonly uncased: number;
    readonly untimed: number;
    readonly noOwner: number;
    readonly noDuration: number;
    readonly noLine: number;
    /** Every coverage section, in the order a record holds them. */
    readonly sections: readonly string[];
    /** The section the untimed layout lacks. */
    readonly duration: string;
    /** The case parts, `[part, section]`, in the order a record holds them after the coverage. */
    readonly parts: readonly (readonly [string, string])[];
    /** A kind's position is the byte `blocks.kind` holds for it; the list is append-only. */
    readonly blockKinds: readonly BlockKind[];
  };
  readonly sets: { readonly list: number; readonly bits: number; readonly runs: number; readonly narrow: number };
  readonly cases: {
    readonly format: number;
    readonly loadedSets: number;
    readonly duration: string;
    readonly lines: string;
    readonly linesOffsets: string;
  };
}

export const LAYOUT = createRequire(import.meta.url)('../../record-layout.json') as RecordLayout;
