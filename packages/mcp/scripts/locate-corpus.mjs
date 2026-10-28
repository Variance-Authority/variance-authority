#!/usr/bin/env node
/**
 * What `variance_locate` costs and how well it answers, on a report a real
 * project wrote.
 *
 * Run by hand against a run report:
 *
 *   node packages/mcp/scripts/locate-corpus.mjs <report.json> [questions.json] [before-dist]
 *
 * Every number it prints is a count, a byte, or a millisecond measured inside
 * one process. Nothing here is a ratio of two timed runs: the timings say what
 * one machine paid, and the counts are what a gate may read.
 *
 * A questions file is `[{ "query": "...", "subject": "..." | null }]`. A null
 * subject is a question the suite has no answer to, and the right answer says
 * it did not cover the question or that none of its words distinguishes a
 * subject. `locate-sheet.mjs` writes one from screens an author has seen.
 *
 * ## Whether a change to the ranking may ship
 *
 * Given `before-dist` — a built `packages/mcp/dist` from the base, copied
 * aside under a `node_modules` so its imports still resolve — the same
 * questions are put to that build and to this package's own, and the change
 * ships when **no question loses its subject from the page**, **at least as
 * many questions gain first place as lose it**, and **no question with no
 * answer stops saying so**. All three are counts of questions read off one
 * process, so none moves on a slower machine. The page is the eight hits the
 * tool prints by default.
 *
 * The rule is applied twice: to every question, and to the held-out fifth
 * alone. A question's fifth is the first byte of the SHA-256 of its lowercased
 * words, modulo five, so it is the same on every machine and in every rebuild
 * of the set, and fifth 0 is held out. A change worked out against the
 * questions it was failing has seen four fifths of them; the fifth it has not
 * seen says whether it generalised. Read the other four while working; judge
 * on the fifth.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { locateSubjects } from '../dist/tools/locate.js';
import { indexOf } from '../dist/tools/locate-index.js';

const [, , reportPath, questionsPath, beforeDist] = process.argv;
if (reportPath === undefined) {
  console.error('usage: locate-corpus.mjs <report.json> [questions.json] [before-dist]');
  process.exit(2);
}

const bytes = readFileSync(reportPath);
const parseAt = performance.now();
const report = JSON.parse(bytes.toString('utf8'));
const parseMs = performance.now() - parseAt;

const lexicon = report.lexicon;
if (lexicon === undefined) {
  console.error(`${reportPath} carries no lexicon.`);
  process.exit(1);
}

console.log(`# ${reportPath}`);
console.log(`report ${mb(bytes.length)} MB · parsed in ${ms(parseMs)} ms`);

// The record.
const perField = new Map();
const distinct = new Map();
let values = 0;
let valueChars = 0;
let elided = 0;
let boundaries = 0;
for (const subject of lexicon.subjects) {
  boundaries += subject.boundaries ?? 0;
  for (const [field, held] of Object.entries(subject.terms)) {
    perField.set(field, (perField.get(field) ?? 0) + held.length);
    let seen = distinct.get(field);
    if (seen === undefined) distinct.set(field, (seen = new Set()));
    for (const value of held) {
      values += 1;
      valueChars += value.length;
      seen.add(value);
    }
  }
  for (const cut of Object.values(subject.elided ?? {})) elided += cut;
}

console.log();
console.log('## the record');
console.log(`subjects ${lexicon.subjects.length} · boundaries ${boundaries} · values ${values} · elided ${elided}`);
console.log(`value bytes ${valueChars} · ${(values / lexicon.subjects.length).toFixed(1)} values per subject`);
console.log();
console.log('| field | values | distinct | values per distinct |');
console.log('|---|---:|---:|---:|');
for (const field of lexicon.fields) {
  const held = perField.get(field) ?? 0;
  const seen = distinct.get(field)?.size ?? 0;
  console.log(`| \`${field}\` | ${held} | ${seen} | ${seen === 0 ? '—' : (held / seen).toFixed(1)} |`);
}

// The index.
const before = process.memoryUsage().heapUsed;
const buildAt = performance.now();
const index = indexOf(report);
const buildMs = performance.now() - buildAt;
const after = process.memoryUsage().heapUsed;

console.log();
console.log('## the index');
console.log(`built in ${ms(buildMs)} ms · ${index.entries.length} entries · ${index.tokens.length} distinct tokens`);
let postings = 0;
for (const list of index.postings.values()) postings += list.length;
console.log(`${postings} postings · ${(postings / index.tokens.length).toFixed(1)} per token`);
console.log(`heap after build ${mb(after)} MB (+${mb(after - before)} MB over the parsed report)`);

// What a question costs. Every distinct token in the corpus is asked once, so
// the spread is the corpus's own, not a question set's.
const sample = index.tokens.filter((_, at) => at % Math.max(1, Math.floor(index.tokens.length / 500)) === 0);
const spent = [];
for (const token of sample) {
  const at = performance.now();
  locateSubjects(report, token);
  spent.push(performance.now() - at);
}
spent.sort((left, right) => left - right);
console.log();
console.log('## a question');
console.log(`${sample.length} one-word questions drawn evenly from the corpus's own tokens`);
console.log(`median ${ms(spent[spent.length >> 1])} ms · p90 ${ms(spent[Math.floor(spent.length * 0.9)])} ms · max ${ms(spent[spent.length - 1])} ms`);

if (questionsPath === undefined) process.exit(0);

// The answer.
const questions = JSON.parse(readFileSync(questionsPath, 'utf8'));
const answered = questions.filter((question) => question.subject !== null);
const unanswerable = questions.filter((question) => question.subject === null);

let first = 0;
let three = 0;
let anywhere = 0;
const missed = [];
for (const question of answered) {
  const located = locateSubjects(report, question.query, question.from);
  const hits = located.hits;
  const at = hits.findIndex((hit) => hit.subject === question.subject);
  if (at === 0) first += 1;
  if (at >= 0 && at < 3) three += 1;
  if (at >= 0) anywhere += 1;
  else missed.push(question.query);
  if (at > 0) missed.push(`${question.query} @${at + 1}`);
}

// Two refusals, told apart. A suite of five thousand subjects always holds
// *some* subject carrying one word of any question, so silence is the wrong
// thing to measure. What a reader needs is the answer saying it did not cover
// the question — and naming the words it has never seen.
let silent = 0;
let uncovered = 0;
const claimed = [];
for (const question of unanswerable) {
  const located = locateSubjects(report, question.query, question.from);
  if (located.hits.length === 0) silent += 1;
  if (saysSo(located)) uncovered += 1;
  else claimed.push(`${question.query} → ${located.hits[0].subject} (covered all ${located.terms.length} terms)`);
}

console.log();
console.log('## the answer');
console.log(`${questionsPath}`);
console.log(`first hit      ${first} of ${answered.length}`);
console.log(`within three   ${three} of ${answered.length}`);
console.log(`found at all   ${anywhere} of ${answered.length}`);
console.log(`said so        ${uncovered} of ${unanswerable.length}  (no subject covered the whole question, or none was distinguished)`);
console.log(`no hits at all ${silent} of ${unanswerable.length}`);
if (missed.length > 0) console.log(`\nnot first:\n  ${missed.join('\n  ')}`);
if (claimed.length > 0) console.log(`\nanswered anyway:\n  ${claimed.join('\n  ')}`);

if (beforeDist !== undefined) await gate(beforeDist, questions);

/** A refusal: the answer says no subject covered the question, or that none of its words distinguishes one. */
function saysSo(located) {
  return located.cover < located.terms.length || located.distinguished === false;
}

async function gate(dist, questions) {
  const { locateSubjects: before } = await import(pathToFileURL(resolve(dist, 'tools/locate.js')).href);
  // A second parse, because the index is built on the first question and kept
  // with the report object: one shared object would hand the base build this
  // build's index.
  const reportBefore = JSON.parse(bytes.toString('utf8'));
  const PAGE = 8;
  const HELD_OUT = 0;
  const fifthOf = (query) => createHash('sha256').update(query.toLowerCase()).digest()[0] % 5;
  const rankOf = (located, subject) => located.hits.findIndex((hit) => hit.subject === subject);
  const rows = questions.map((question) => {
    const was = before(reportBefore, question.query, question.from);
    const is = locateSubjects(report, question.query, question.from);
    return question.subject === null
      ? { ...question, fifth: fifthOf(question.query), saidBefore: saysSo(was), saidAfter: saysSo(is) }
      : { ...question, fifth: fifthOf(question.query), before: rankOf(was, question.subject), after: rankOf(is, question.subject) };
  });

  const onPage = (rank) => rank >= 0 && rank < PAGE;
  const tally = (set) => {
    const answered = set.filter((row) => row.subject !== null);
    const unanswerable = set.filter((row) => row.subject === null);
    return {
      asked: set.length,
      firstBefore: answered.filter((row) => row.before === 0).length,
      firstAfter: answered.filter((row) => row.after === 0).length,
      threeBefore: answered.filter((row) => row.before >= 0 && row.before < 3).length,
      threeAfter: answered.filter((row) => row.after >= 0 && row.after < 3).length,
      pageBefore: answered.filter((row) => onPage(row.before)).length,
      pageAfter: answered.filter((row) => onPage(row.after)).length,
      saidBefore: unanswerable.filter((row) => row.saidBefore).length,
      saidAfter: unanswerable.filter((row) => row.saidAfter).length,
      gainedFirst: answered.filter((row) => row.after === 0 && row.before !== 0).length,
      lostFirst: answered.filter((row) => row.before === 0 && row.after !== 0).length,
      fellOff: answered.filter((row) => onPage(row.before) && !onPage(row.after)).length,
      stoppedSaying: unanswerable.filter((row) => row.saidBefore && !row.saidAfter).length,
    };
  };
  const passes = (count) => count.fellOff === 0 && count.gainedFirst >= count.lostFirst && count.stoppedSaying === 0;
  const all = tally(rows);
  const held = tally(rows.filter((row) => row.fifth === HELD_OUT));

  console.log();
  console.log(`## against ${dist}`);
  console.log(`${rows.length} question(s) · ${held.asked} held out`);
  console.log();
  console.log('| | every question | held out |');
  console.log('|---|---:|---:|');
  const line = (name, key) =>
    console.log(`| ${name} | ${all[`${key}Before`]} → ${all[`${key}After`]} | ${held[`${key}Before`]} → ${held[`${key}After`]} |`);
  line('the subject is first', 'first');
  line('the subject is within three', 'three');
  line(`the subject is on the page of ${PAGE}`, 'page');
  line('a question with no answer is said so', 'said');
  for (const [name, key] of [['gained first place', 'gainedFirst'], ['lost first place', 'lostFirst'], ['fell off the page', 'fellOff'], ['stopped saying so', 'stoppedSaying']]) {
    console.log(`| ${name} | ${all[key]} | ${held[key]} |`);
  }

  const at = (rank) => (rank < 0 ? '—' : String(rank + 1));
  const moved = rows.filter((row) => (row.subject === null ? row.saidBefore !== row.saidAfter : row.before !== row.after));
  if (moved.length > 0) {
    console.log();
    console.log('### moved');
    for (const row of moved) {
      const change = row.subject === null ? `${row.saidBefore ? 'said so' : 'answered'} → ${row.saidAfter ? 'said so' : 'answered'}` : `${at(row.before)} → ${at(row.after)}`;
      console.log(`${change}${row.fifth === HELD_OUT ? ' (held out)' : ''} · ${row.query} · ${row.subject ?? 'no answer'}`);
    }
  }

  const verdict = passes(all) && passes(held);
  console.log();
  console.log(verdict ? 'ships: nothing fell off the page, first place did not shrink, every refusal stands' : 'refused');
  process.exitCode = verdict ? 0 : 1;
}

function mb(value) {
  return (value / 1048576).toFixed(1);
}

function ms(value) {
  return value < 10 ? value.toFixed(2) : value.toFixed(0);
}
