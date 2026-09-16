#!/usr/bin/env node
/**
 * What `variance_locate` costs and how well it answers, on a report a real
 * project wrote.
 *
 * Run by hand against a run report:
 *
 *   node packages/mcp/scripts/locate-corpus.mjs <report.json> [questions.json]
 *
 * Every number it prints is a count, a byte, or a millisecond measured inside
 * one process. Nothing here is a ratio of two timed runs: the timings say what
 * one machine paid, and the counts are what a gate may read.
 *
 * A questions file is `[{ "query": "...", "subject": "..." | null }]`. A null
 * subject is a question the suite has no answer to, and the only right answer
 * is no hits.
 */

import { readFileSync } from 'node:fs';
import { locateSubjects } from '../dist/tools/locate.js';
import { indexOf } from '../dist/tools/locate-index.js';

const [, , reportPath, questionsPath] = process.argv;
if (reportPath === undefined) {
  console.error('usage: locate-corpus.mjs <report.json> [questions.json]');
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
  const located = locateSubjects(report, question.query);
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
  const located = locateSubjects(report, question.query);
  if (located.hits.length === 0) silent += 1;
  if (located.cover < located.terms.length) uncovered += 1;
  else claimed.push(`${question.query} → ${located.hits[0].subject} (covered all ${located.terms.length} terms)`);
}

console.log();
console.log('## the answer');
console.log(`${questionsPath}`);
console.log(`first hit      ${first} of ${answered.length}`);
console.log(`within three   ${three} of ${answered.length}`);
console.log(`found at all   ${anywhere} of ${answered.length}`);
console.log(`said so        ${uncovered} of ${unanswerable.length}  (no subject covered the whole question)`);
console.log(`no hits at all ${silent} of ${unanswerable.length}`);
if (missed.length > 0) console.log(`\nnot first:\n  ${missed.join('\n  ')}`);
if (claimed.length > 0) console.log(`\nanswered anyway:\n  ${claimed.join('\n  ')}`);

function mb(value) {
  return (value / 1048576).toFixed(1);
}

function ms(value) {
  return value < 10 ? value.toFixed(2) : value.toFixed(0);
}
