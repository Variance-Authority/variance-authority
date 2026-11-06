#!/usr/bin/env node
/**
 * Questions for `variance_locate`, written on demand by an author who has seen
 * the screens and never the index.
 *
 *   node packages/mcp/scripts/locate-sheet.mjs sheet <report.json> <out-dir> [count] [seed]
 *   node packages/mcp/scripts/locate-sheet.mjs resolve <out-dir>
 *
 * `sheet` draws `count` subjects (default 40) from the report with a seeded
 * shuffle and writes two files. `sheet.md` is what the author reads: each drawn
 * subject under an opaque label — `S01`, `S02` — with the roles, accessible
 * names and visible text the run recorded on it, and nothing else. No id, no
 * component, no file: a question written from those is phrased the way
 * somebody who has looked at the product would phrase it, and never the way
 * somebody who has read the index would. `labels.json` holds the label to
 * subject map, and the author is not shown it.
 *
 * The author — a person, or a small model given `sheet.md` and nothing else —
 * writes `answers.json` beside them: `[{ "label": "S01", "query": "…" }]`, one
 * or more per label. `resolve` turns the labels back into subjects and prints
 * the questions file `locate-corpus.mjs` reads.
 *
 * No question here is "something the product does not have": the sheet shows a
 * draw, not the suite, so a thing absent from the sheet may be on a screen the
 * draw left out, and a question whose truth is unknown measures nothing.
 *
 * Nothing here ranks or scores. The set is drawn by a seed and written by an
 * author with no view of the ranking, so a change measured against it was not
 * chosen because it worked on it.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** A recorded string as the author reads it: one line, and short enough to read. */
const SHOWN = 80;
/** Lines per subject. A screen with more than this is shown by its first lines. */
const LINES = 60;

function sheet(reportPath, out, countArg, seedArg) {
  if (reportPath === undefined || out === undefined) {
    console.error('usage: locate-sheet.mjs sheet <report.json> <out-dir> [count] [seed]');
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const subjects = (report.lexicon?.subjects ?? []).filter((row) => (row.landmarks ?? []).length > 0);
  if (subjects.length === 0) {
    console.error(`${reportPath} carries no landmarks to show an author.`);
    process.exit(1);
  }

  // One deterministic stream, so the same report and seed draw the same sheet.
  let seed = Number(seedArg ?? 20261019) >>> 0;
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const drawn = [...subjects];
  for (let at = drawn.length - 1; at > 0; at -= 1) {
    const swap = Math.floor(next() * (at + 1));
    [drawn[at], drawn[swap]] = [drawn[swap], drawn[at]];
  }
  const picked = drawn.slice(0, Number(countArg ?? 40));

  const labels = {};
  const pages = [];
  picked.forEach((row, at) => {
    const label = `S${String(at + 1).padStart(2, '0')}`;
    labels[label] = row.subject;
    const lines = [];
    const seen = new Set();
    for (const landmark of row.landmarks) {
      // A role alone says nothing a person would type, and a text that only
      // repeats the name is said once.
      const name = landmark.name === undefined ? '' : oneLine(landmark.name);
      const text = landmark.text === undefined ? '' : oneLine(landmark.text);
      if (name === '' && text === '') continue;
      const said = [landmark.role ?? '', name, text === name ? '' : text].join(' · ');
      if (seen.has(said)) continue;
      seen.add(said);
      lines.push(`- ${said}`);
    }
    const more = lines.length > LINES ? [`- …and ${lines.length - LINES} more`] : [];
    pages.push(`## ${label}\n\n${[...lines.slice(0, LINES), ...more].join('\n')}`);
  });

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'labels.json'), `${JSON.stringify(labels, null, 2)}\n`);
  writeFileSync(join(out, 'sheet.md'), `${BRIEF}\n${pages.join('\n\n')}\n`);
  console.log(`${picked.length} subject(s) of ${subjects.length} drawn into ${join(out, 'sheet.md')}`);
}

function resolve(out) {
  if (out === undefined) {
    console.error('usage: locate-sheet.mjs resolve <out-dir>');
    process.exit(2);
  }
  const labels = JSON.parse(readFileSync(join(out, 'labels.json'), 'utf8'));
  const answers = JSON.parse(readFileSync(join(out, 'answers.json'), 'utf8'));
  const questions = [];
  for (const { label, query } of answers) {
    if (typeof query !== 'string' || query.trim() === '') continue;
    if (labels[label] === undefined) {
      console.error(`answers.json names ${label}, which the sheet does not hold.`);
      process.exit(1);
    }
    questions.push({ query, subject: labels[label] });
  }
  console.log(JSON.stringify(questions, null, 2));
}

function oneLine(value) {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > SHOWN ? `${line.slice(0, SHOWN)}…` : line;
}

const BRIEF = `# Screens

Each section below is one screen of a product, under a label. A line is one
thing on it: its role, its accessible name and the text it shows, in that
order, any of them possibly empty.

For each label, write one to three things somebody who had seen that screen
might type to find it again — the way you would describe it to a colleague, not
a copy of a line.

Answer with JSON only, in this shape:

[{ "label": "S01", "query": "..." }, { "label": "S01", "query": "..." }]
`;

const [, , mode, ...rest] = process.argv;
if (mode === 'sheet') sheet(...rest);
else if (mode === 'resolve') resolve(...rest);
else {
  console.error('usage: locate-sheet.mjs sheet <report.json> <out-dir> [count] [seed]');
  console.error('       locate-sheet.mjs resolve <out-dir>');
  process.exit(2);
}
