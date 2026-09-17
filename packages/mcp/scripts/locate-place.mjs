#!/usr/bin/env node
/**
 * Whether the answer says where the thing lives, and what a start point is
 * worth to that.
 *
 *   node packages/mcp/scripts/locate-place.mjs <report.json> [repo-root] [count]
 *
 * The question is a landmark's own words — what somebody looking at the screen
 * would type — and the start point is the folder of the file that landmark was
 * written in, which is the one thing somebody arriving already knows. Both come
 * out of the run's own record, so the set is mechanical, seeded and re-runnable
 * rather than hand-picked, and nothing in it was chosen because it worked.
 *
 * Right means the place printed beside the top hit names the same file the
 * landmark was recorded in. Anything else is wrong, including a plausible
 * neighbour: a reader sent to the wrong file has not been oriented. The rank of
 * the reader's own *subject* is printed beside it, because one file is usually
 * shown by several subjects and picking a different one that opens the same
 * file is not a miss.
 *
 * Every number is a count measured inside one process. Nothing here is a ratio
 * of two timed runs.
 *
 * ## A start point needs a source tree, and a run that recorded one
 *
 * A start point is a path, and a path is a fact about a repository, so the
 * repository is an argument. Give none and the whole suite is measured, which
 * is also all a run off a production build can be asked: that build records no
 * source coordinate anywhere, so there is nothing to start from and the place
 * an answer hands over is the component that owns the landmark rather than a
 * line.
 */

import { readFileSync } from 'node:fs';
import { locateSubjects } from '../dist/tools/locate.js';
import { placesOn } from '../dist/tools/place.js';
import { readTree } from '../dist/tools/tree.js';

const [, , reportPath, root, countArg] = process.argv;
if (reportPath === undefined) {
  console.error('usage: locate-place.mjs <report.json> [repo-root] [count]');
  process.exit(2);
}
const wanted = Number(countArg ?? 300);

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const subjects = report.lexicon?.subjects ?? [];
if (subjects.length === 0) {
  console.error(`${reportPath} carries no lexicon.`);
  process.exit(1);
}

const tree = root === undefined ? undefined : await readTree({ root });

/**
 * The coordinate a recorded path names in *this* checkout.
 *
 * A report travels — it is a file, and the run that wrote it may have happened
 * in a different checkout of the same tree, or in a container. So a recorded
 * path is taken back to the tree by the longest tail of it the tree holds,
 * which is a question asked of the tree rather than a guess about a prefix.
 *
 * Preparation, not resolution. What the tool under measurement is handed is a
 * path, and it decides on its own whether one exists.
 */
function hereOf(path) {
  for (let at = 0; at >= 0; at = path.indexOf('/', at + 1)) {
    const tail = path.slice(at + 1);
    if (tree.files.has(tail)) return tail;
  }
  return undefined;
}

const asks = [];
let noCoordinate = 0;
for (const row of subjects) {
  for (const landmark of row.landmarks ?? []) {
    const said = landmark.name ?? landmark.text;
    if (said === undefined || said.length < 4 || said.length > 40) continue;
    // Where the build kept a line, the file is the truth. Off a production
    // build there is no line anywhere and the owning component is the only
    // place there is, so that is what the answer is held to instead.
    const file = tree === undefined || landmark.file === undefined ? undefined : hereOf(landmark.file);
    const where = file ?? landmark.component;
    if (where === undefined) continue;
    if (file === undefined) noCoordinate += 1;
    asks.push({
      subject: row.subject,
      query: said.toLowerCase(),
      from: file === undefined ? undefined : file.slice(0, file.lastIndexOf('/') + 1),
      file: where,
    });
  }
}

// One deterministic stream, so the same corpus gives the same set every run.
let seed = 20260917;
const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
for (let at = asks.length - 1; at > 0; at -= 1) {
  const swap = Math.floor(next() * (at + 1));
  [asks[at], asks[swap]] = [asks[swap], asks[at]];
}
const set = asks.slice(0, wanted);

const empty = () => ({ subjectFirst: 0, subjectThree: 0, fileFirst: 0, fileThree: 0, silent: 0, asked: 0 });
const scoped = empty();
const whole = empty();
let inScope = 0;
let refused = 0;
let scopable = 0;

const measure = (into, located, ask) => {
  into.asked += 1;
  const hits = located.hits ?? [];
  if (hits.length === 0) {
    into.silent += 1;
    return;
  }
  const at = hits.findIndex((hit) => hit.subject === ask.subject);
  if (at === 0) into.subjectFirst += 1;
  if (at >= 0 && at < 3) into.subjectThree += 1;
  // Three is what a reader will actually open before giving up.
  const three = hits.slice(0, 3).map((hit) => hit.subject);
  const places = placesOn(report, three, ask.query);
  if ((places.get(three[0]) ?? '').includes(ask.file)) into.fileFirst += 1;
  if (three.some((subject) => (places.get(subject) ?? '').includes(ask.file))) into.fileThree += 1;
};

for (const ask of set) {
  measure(whole, locateSubjects(report, ask.query), ask);
  if (ask.from === undefined) continue;
  scopable += 1;
  const located = locateSubjects(report, ask.query, ask.from, tree);
  if (located.scope?.refused !== undefined) refused += 1;
  else inScope += located.scope?.subjects.size ?? 0;
  measure(scoped, located, ask);
}

const row = (name, key) =>
  `| ${name} | ${share(scoped, key)} | ${share(whole, key)} |`;
const share = (of, key) => (of.asked === 0 ? '—' : `${((100 * of[key]) / of.asked).toFixed(1)}%`);

console.log(`# ${reportPath}`);
console.log(tree === undefined ? 'no source tree given' : `tree ${root} · ${tree.files.size} file(s)`);
console.log();
console.log('## the set');
console.log(`${set.length} question(s) of ${asks.length} askable · ${subjects.length} subject(s)`);
console.log(
  `${scopable} carry a source coordinate this tree holds, ${noCoordinate} do not and are held to ` +
    'the component that owns them instead',
);
if (scopable > 0) {
  const kept = Math.max(1, scopable - refused);
  console.log(`start points refused ${refused}`);
  console.log(
    `subjects in scope, mean ${(inScope / kept).toFixed(1)} of ${subjects.length} · ` +
      `${(subjects.length / Math.max(1, inScope / kept)).toFixed(1)}x narrower`,
  );
}
console.log();
console.log('| | within the scope | whole suite |');
console.log('|---|---:|---:|');
console.log(row('the top hit names the right place', 'fileFirst'));
console.log(row('the right place is within three', 'fileThree'));
console.log(row("the top hit is the reader's subject", 'subjectFirst'));
console.log(row("the reader's subject is within three", 'subjectThree'));
console.log(row('no hits at all', 'silent'));
