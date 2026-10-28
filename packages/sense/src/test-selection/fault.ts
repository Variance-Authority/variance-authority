/**
 * The one region a run skips, to ask whether the tests that enter it notice.
 *
 * A recording says which cases entered a region, never whether any of them
 * would fail if it did something else. A run started with
 * `VARIANCE_AUTHORITY_FAULT=<path>#<ordinal>` reads that file with that region
 * skipped, every other line as written, and its cases either go red or pass
 * whatever the region does. The path is the checkout's, as a recording names
 * the file, and the ordinal is the region's in the walk. What stands in the
 * region's place is the crate's,
 * [`fault.rs`](../../native/instrument/src/fault.rs).
 *
 * The seam skips it where it reads the file, ahead of every transform, so the
 * project's transforms, the probes and the record all take the skipped text as
 * the file. Nothing of the file is written to disk; the run marks that it read
 * the file skipped ({@link markFaultRead}).
 */

// compass: variance-authority.reach

import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { instrumenter } from '../instrument/spliced.js';
import { CACHE_VARIABLE, FAULT_VARIABLE } from './cache-layers.js';
import { handedTexts } from './source-lines.js';

/** A region of one file, by the walk's ordinal. */
export interface Fault {
  /** The file, by its path in the checkout. */
  readonly file: string;
  readonly ordinal: number;
}

/** The fault `value` names, or none when it is unset; an address that names no region throws. */
export function faultOf(value: string | undefined): Fault | undefined {
  if (value === undefined || value === '') return undefined;
  const at = value.lastIndexOf('#');
  const ordinal = value.slice(at + 1);
  if (at <= 0 || !/^\d+$/.test(ordinal)) {
    throw new Error(`${FAULT_VARIABLE}=${value} names no region: write it as <path>#<ordinal>`);
  }
  return { file: value.slice(0, at), ordinal: Number(ordinal) };
}

let read: { readonly fault: Fault | undefined } | undefined;

/** This process's fault, read once. */
export function runFault(): Fault | undefined {
  read ??= { fault: faultOf(process.env[FAULT_VARIABLE]) };
  return read.fault;
}

/**
 * The file `file` as the run reads it: the `code` the runner handed over and
 * the `text` read from disk, both skipped where the fault names `file`, and
 * both as they are otherwise. A fault on a file that reached the seam already
 * changed, or on a region with no text of its own, throws: skipped anywhere
 * else, it would answer for a region it did not skip.
 */
export function readFaulted(
  file: string,
  code: string,
  text: string | undefined,
  fault: Fault | undefined = runFault(),
): { readonly code: string; readonly text: string | undefined } {
  if (fault === undefined || fault.file !== file) return { code, text };
  const address = `${FAULT_VARIABLE}=${file}#${fault.ordinal}`;
  if (text !== undefined && !handedTexts(text).includes(code)) {
    throw new Error(`${address}: the file reached the seam already changed, so no region of it can be skipped`);
  }
  const skipped = instrumenter().faulted(code, file, fault.ordinal);
  if (skipped === null) throw new Error(`${address} names a region with no text of its own, or a text that does not parse`);
  markFaultRead(fault);
  return { code: skipped, text: skipped };
}

/**
 * Mark, in the cache the run records into, that this run reads `fault`'s file
 * skipped: a run that went red before it did says nothing about the region,
 * and its caller tells the two apart by the mark. A seam that serves the file
 * from a transform cache of its own marks it where it keys the file, which it
 * does whether or not the cache holds it.
 */
export function markFaultRead(fault: Fault): void {
  const cache = process.env[CACHE_VARIABLE];
  if (cache === undefined || !isAbsolute(cache)) return;
  mkdirSync(cache, { recursive: true });
  writeFileSync(faultReadIn(cache), `${fault.file}#${fault.ordinal}\n`);
}

/** The mark a run leaves in `cache`, the absolute cache it records into, once it read its file skipped. */
export function faultReadIn(cache: string): string {
  return resolve(cache, 'fault-read');
}

/** Whether region `ordinal` of `text` has a text of its own a run can skip. */
export function skippable(text: string, file: string, ordinal: number): boolean {
  return instrumenter().faulted(text, file, ordinal) !== null;
}
