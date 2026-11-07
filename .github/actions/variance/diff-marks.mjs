#!/usr/bin/env node
//
// A changed function no case covered, marked on the lines of the diff that hold it.
//
// The comment says so at the foot of the conversation, and a reviewer reads the
// diff. A workflow command printed to the log is all GitHub asks for: no token,
// no API. It shows ten warnings of a step and drops the rest in silence, so the
// last line says how many it would have dropped.
//
// A record older than the change has not run what the change wrote, so its
// `hole` says the record is behind, not that a test is missing: nothing is marked.
//
// Usage: node diff-marks.mjs <review.json>

import { readFileSync } from 'node:fs';

const SHOWN = 10;
const NO_CASE = new Set(['hole', 'unwalked', 'unknown']);
const TITLE = 'No case covered this';

const data = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const property = (text) => data(text).replaceAll(':', '%3A').replaceAll(',', '%2C');

/** The functions of `file` no case covered, each once: one inside another is the outer one's finding. */
function uncovered({ regions = [] }) {
  const kept = [];
  const sorted = regions
    .filter((region) => region.kind === 'function' && NO_CASE.has(region.reach))
    .sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
  for (const region of sorted) {
    const last = kept.at(-1);
    if (last === undefined || region.endLine > last.endLine) kept.push(region);
  }
  return kept;
}

const review = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const marks = review.record !== 'ran'
  ? []
  : review.files.flatMap((file) => uncovered(file).map((region) => ({ file: file.file, region })));

for (const { file, region } of marks.slice(0, SHOWN)) {
  console.log(
    `::warning file=${property(file)},line=${region.startLine},endLine=${region.endLine},title=${TITLE}::\`${data(region.name)}\` changed, and no case covered it.`,
  );
}
const left = marks.length - SHOWN;
if (left > 0) {
  console.log(`::notice title=No case covered these::${left} more changed function${left === 1 ? '' : 's'} no case covered: the comment lists them.`);
}
