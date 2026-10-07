#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Detector, getDefaultOptions, mild } from '@jscpd/core';
import { Tokenizer } from '@jscpd/tokenizer';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { ROOT, sources } from './owners.mjs';

/**
 * Blocks that appear twice in what ships.
 *
 * `owners.mjs` finds the idioms nobody copied. This finds the code somebody
 * did copy: a loop pasted into a second file and edited a little. jscpd
 * compares token streams with identifiers kept, so it finds a pasted block and
 * not a re-typed one, which is why the two checks sit side by side.
 *
 * A ratchet, keyed by the pair of files and the number of clones between them.
 * A new pair, or a pair that grew, fails. A pair that shrank or went away
 * tightens the baseline.
 *
 * `yarn clones` prints the clones; `--write` records them.
 * `tools/clones.check.ts` compares the two.
 */

export const BASELINE = join(ROOT, 'tools/clones.baseline.json');

/**
 * jscpd's own window: fifty tokens across at least five lines.
 *
 * The hash is ours. jscpd hashes every token and every fifty-token window with
 * a JavaScript MD5, which was 4.7 of the 7 seconds a scan of this repository
 * took. The hash only keys a map of windows, so it needs no cryptography: two
 * 32-bit FNV-1a lanes give 64 bits, and a collision among a few million
 * windows would cost one false clone in a report a person reads.
 */
export const OPTIONS = { ...getDefaultOptions(), minTokens: 50, minLines: 5, mode: mild, hashFunction: fnv };

function fnv(text) {
  let low = 0x811c9dc5;
  let high = 0x01000193 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    low = Math.imul(low ^ unit, 0x01000193);
    high = Math.imul(high ^ unit, 0x01000193 + 0x100);
  }
  // jscpd cuts each token's hash to twenty characters, so it gets twenty.
  return `${(low >>> 0).toString(16).padStart(8, '0')}${(high >>> 0).toString(16).padStart(8, '0')}0000`;
}

const FORMATS = { '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx', '.mjs': 'javascript' };

const formatOf = (file) => FORMATS[file.slice(file.lastIndexOf('.'))];

/**
 * jscpd's store interface over a `Map`.
 *
 * Its `MemoryStore` answers a miss by rejecting with a new `Error`, and nearly
 * every window is a miss: capturing a stack for each was 1.7 seconds of a scan.
 * A miss rejects with one error made once, since nothing reads its stack.
 */
function windows() {
  const missing = Promise.reject(new Error('not found'));
  missing.catch(() => {});
  let values = new Map();
  let space = new Map();
  return {
    namespace(name) {
      if (!values.has(name)) values.set(name, new Map());
      space = values.get(name);
    },
    get: (key) => (space.has(key) ? Promise.resolve(space.get(key)) : missing),
    set(key, value) {
      space.set(key, value);
      return Promise.resolve(value);
    },
    close() {
      values = new Map();
    },
  };
}

/** Every clone among `files`, read as `read(file)` says. */
export async function clonesIn(files, read) {
  const detector = new Detector(new Tokenizer(), windows(), [], OPTIONS);
  const found = [];
  for (const file of files) {
    const format = formatOf(file);
    if (format === undefined) continue;
    for (const clone of await detector.detect(file, read(file), format)) {
      const a = clone.duplicationA;
      const b = clone.duplicationB;
      if (a.end.line - a.start.line + 1 < OPTIONS.minLines) continue;
      found.push({
        a: { at: a.sourceId, lines: [a.start.line, a.end.line] },
        b: { at: b.sourceId, lines: [b.start.line, b.end.line] },
      });
    }
  }
  return found;
}

/** Every clone in the sources `owners.mjs` reads. */
export function clones() {
  return clonesIn(sources(), (file) => readFileSync(join(ROOT, file), 'utf8'));
}

/** One row per pair of files, in code-unit order: what the baseline records. */
export function paired(found) {
  const rows = new Map();
  for (const clone of found) {
    const [first, second] = [clone.a.at, clone.b.at].sort(codeUnitOrder);
    const key = `${first}\n${second}`;
    const row = rows.get(key) ?? { files: [first, second], count: 0 };
    row.count += 1;
    rows.set(key, row);
  }
  return [...rows.entries()].sort(([left], [right]) => codeUnitOrder(left, right)).map(([, row]) => row);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = await clones();
  if (process.argv.includes('--write')) {
    const rows = paired(found);
    writeFileSync(BASELINE, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    process.stdout.write(`clones: ${found.length} clones between ${rows.length} pairs of files, recorded\n`);
  } else {
    for (const clone of found) {
      process.stdout.write(
        `${clone.a.at}:${clone.a.lines.join('-')}  ${clone.b.at}:${clone.b.lines.join('-')}\n`,
      );
    }
  }
}
