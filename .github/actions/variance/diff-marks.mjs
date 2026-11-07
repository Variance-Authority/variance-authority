#!/usr/bin/env node
//
// A changed function no run of the change covered, marked on the lines of the diff it wrote there.
//
// The comment says so at the foot of the conversation, and a reviewer reads the
// diff. A workflow command printed to the log is all GitHub asks for: no token,
// no API. It shows ten warnings of a step and drops the rest in silence, so the
// last line says how many it would have dropped.
//
// A record older than the change has not run what the change wrote, so its
// `hole` says the record is behind, not that a test is missing: a file is marked
// only when the named suite ran the change, or a suite the review read ran the file.
// With several suites, one that has not run the change answers for nothing, so a
// mark says what the runs of this change did, not what no test could do.
//
// Usage: node diff-marks.mjs <review.json>

import { readFileSync } from 'node:fs';

const SHOWN = 10;
const NO_CASE = new Set(['hole', 'unwalked', 'unknown']);
const TITLE = 'No run of this change covered this';

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
    const same = last?.startLine === region.startLine && last.endLine === region.endLine;
    if (last === undefined || same || region.endLine > last.endLine) kept.push(region);
  }
  return kept;
}

/** The first lines of `region` the change wrote: a line outside the diff shows no mark on it. */
function lines(region, written = []) {
  const hit = written.find(({ start, end }) => start <= region.endLine && end >= region.startLine);
  return hit === undefined
    ? { line: region.startLine, endLine: region.endLine }
    : { line: Math.max(hit.start, region.startLine), endLine: Math.min(hit.end, region.endLine) };
}

const review = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const marks = review.files
  .filter((file) => review.record === 'ran' || file.ran === true)
  .flatMap((file) => uncovered(file).map((region) => ({ file: file.file, name: region.name, ...lines(region, file.written) })));

for (const { file, name, line, endLine } of marks.slice(0, SHOWN)) {
  const subject = name === '' ? 'A function' : `\`${data(name)}\``;
  console.log(`::warning file=${property(file)},line=${line},endLine=${endLine},title=${TITLE}::${subject} changed, and no case that ran this change covered it.`);
}
const left = marks.length - SHOWN;
if (left > 0) {
  console.log(`::notice title=No run of this change covered these::${left} more changed function${left === 1 ? '' : 's'} no case that ran this change covered: the review lists them.`);
}
