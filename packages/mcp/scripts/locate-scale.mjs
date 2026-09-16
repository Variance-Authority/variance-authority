#!/usr/bin/env node
/**
 * What the lexicon costs at suite sizes no repository here has yet.
 *
 *   node packages/mcp/scripts/locate-scale.mjs <report.json> [sizes...]
 *
 * The axis is synthetic and the distribution is not. Every subject it invents
 * draws its field values from the real corpus's own populations: how many
 * values that field carries per subject, and how often each value occurs. The
 * script prints the agreement it achieved — per field, the total variation
 * distance between the synthetic value-frequency distribution and the real one
 * — so a reader can see the draw is the corpus's shape rather than a uniform
 * one that would make every word equally rare and every query equally cheap.
 *
 * It answers bytes, milliseconds and megabytes. **It cannot answer whether an
 * answer is right**: the ids are invented, so first-hit and refusals mean
 * nothing here. Those are measured on the real corpora only.
 */

import { readFileSync } from 'node:fs';
import { locateSubjects } from '../dist/tools/locate.js';
import { indexOf } from '../dist/tools/locate-index.js';

const [, , reportPath, ...sizeArgs] = process.argv;
if (reportPath === undefined) {
  console.error('usage: locate-scale.mjs <report.json> [sizes...]');
  process.exit(2);
}
const sizes = sizeArgs.length > 0 ? sizeArgs.map(Number) : [2_000, 20_000, 100_000];

const real = JSON.parse(readFileSync(reportPath, 'utf8')).lexicon;
const fields = real.fields;

// The corpus's own populations, per field: the per-subject value counts, and
// the values weighted by how often they occur.
const counts = new Map();
const pool = new Map();
const truth = new Map();
for (const subject of real.subjects) {
  for (const field of fields) {
    const held = subject.terms[field] ?? [];
    let seen = counts.get(field);
    if (seen === undefined) counts.set(field, (seen = []));
    seen.push(held.length);
    let bag = pool.get(field);
    if (bag === undefined) pool.set(field, (bag = []));
    let seenAt = truth.get(field);
    if (seenAt === undefined) truth.set(field, (seenAt = new Map()));
    for (const value of held) {
      bag.push(value);
      seenAt.set(value, (seenAt.get(value) ?? 0) + 1);
    }
  }
}

// One deterministic stream, so the same sizes give the same bytes every run.
let seed = 0x9e3779b9;
const next = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
};

function synthesize(size) {
  const subjects = [];
  const drawn = new Map();
  for (let at = 0; at < size; at += 1) {
    const terms = {};
    for (const field of fields) {
      const howMany = counts.get(field)[Math.floor(next() * counts.get(field).length)];
      if (howMany === 0) continue;
      const bag = pool.get(field);
      if (bag.length === 0) continue;
      const held = new Set();
      for (let pick = 0; pick < howMany; pick += 1) {
        const value = bag[Math.floor(next() * bag.length)];
        held.add(value);
        let seenAt = drawn.get(field);
        if (seenAt === undefined) drawn.set(field, (seenAt = new Map()));
        seenAt.set(value, (seenAt.get(value) ?? 0) + 1);
      }
      terms[field] = [...held].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    }
    subjects.push({ subject: idOf(at), boundaries: 8 + Math.floor(next() * 80), terms });
  }
  return { report: { observations: [], lexicon: { version: 1, fields, subjects } }, drawn };
}

/**
 * An id built from the real ids' own words, because an id is searched at the
 * heaviest weight and a suite of ids sharing no vocabulary would make every
 * one of them unique — a cheaper index and an easier query than any real suite
 * offers. The ordinal keeps them distinct without adding a word.
 */
const idWords = [
  ...new Set(
    real.subjects.flatMap((subject) => subject.subject.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 1)),
  ),
];
function idOf(at) {
  const pick = () => idWords[Math.floor(next() * idWords.length)];
  return `story:${pick()}-${pick()}--${pick()}-${at}`;
}

/** Total variation distance between the drawn and the real value frequencies. */
function agreement(drawn) {
  const rows = [];
  for (const field of fields) {
    const left = truth.get(field);
    const right = drawn.get(field);
    if (left === undefined || left.size === 0 || right === undefined) continue;
    let leftTotal = 0;
    let rightTotal = 0;
    for (const n of left.values()) leftTotal += n;
    for (const n of right.values()) rightTotal += n;
    let distance = 0;
    for (const value of new Set([...left.keys(), ...right.keys()])) {
      distance += Math.abs((left.get(value) ?? 0) / leftTotal - (right.get(value) ?? 0) / rightTotal);
    }
    rows.push([field, (distance / 2) * 100]);
  }
  return rows;
}

/** The words the real corpus holds — what a person actually types. */
const askable = [
  ...new Set(
    [...pool.values()].flat().flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/i).filter((word) => word.length > 2)),
  ),
].sort();

console.log(`# drawn from ${reportPath}`);
console.log(`real corpus: ${real.subjects.length} subjects, fields ${fields.join(', ')}`);
console.log();
console.log('| subjects | lexicon JSON | index build | entries | tokens | heap held | median query | p90 query |');
console.log('|---:|---:|---:|---:|---:|---:|---:|---:|');

let lastAgreement;
for (const size of sizes) {
  global.gc?.();
  const { report, drawn } = synthesize(size);
  lastAgreement = agreement(drawn);

  const json = Buffer.byteLength(JSON.stringify(report.lexicon));
  const before = process.memoryUsage().heapUsed;
  const at = performance.now();
  const index = indexOf(report);
  const buildMs = performance.now() - at;
  const held = process.memoryUsage().heapUsed - before;

  // Asked in the real corpus's words. Sampling the synthetic dictionary would
  // mostly draw the ordinals that keep ids distinct, which match one entry each
  // and would report a query cost no reader will ever pay.
  const sample = askable.filter((_, n) => n % Math.max(1, Math.floor(askable.length / 300)) === 0);
  const spent = [];
  for (const token of sample) {
    const from = performance.now();
    locateSubjects(report, token);
    spent.push(performance.now() - from);
  }
  spent.sort((left, right) => left - right);

  console.log(
    `| ${size} | ${mb(json)} MB | ${buildMs.toFixed(0)} ms | ${index.entries.length} | ${index.tokens.length} ` +
      `| ${mb(held)} MB | ${spent[spent.length >> 1].toFixed(2)} ms | ${spent[Math.floor(spent.length * 0.9)].toFixed(2)} ms |`,
  );
}

console.log();
console.log('## agreement with the real corpus');
console.log('total variation distance between the drawn value frequencies and the real ones, per field');
console.log();
console.log('| field | distance |');
console.log('|---|---:|');
for (const [field, distance] of lastAgreement) console.log(`| \`${field}\` | ${distance.toFixed(2)}% |`);

function mb(value) {
  return (value / 1048576).toFixed(1);
}
