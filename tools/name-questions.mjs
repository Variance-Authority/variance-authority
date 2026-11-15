#!/usr/bin/env node
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { digestString } from '@variance-authority/core/format';

/**
 * Asks a fixed question set of a workspace through the built CLI, keeps each
 * answer and how long it took, and compares two kept runs line for line, with
 * only the `Snapshot` line masked. A change to how the name questions are
 * stored is judged by it: the answers stay the same and the times fall.
 *
 * `node tools/name-questions.mjs ask <set> --workspace <dir> --out <dir> [--runs <n>] [--bin <bin.js>]`
 * `node tools/name-questions.mjs digest <kept>` prints a kept run as one line per answer
 * `node tools/name-questions.mjs compare <kept|.out> <kept|.out>`
 *
 * A kept run is a folder of whole answers, megabytes on a large workspace; a
 * `.out` file is its digest, one line per answer — the file, the
 * `digestString` of its text with the `Snapshot` line masked, its bytes and its lines — small enough to check
 * in beside the set. Two kept runs compare line for line; a `.out` on either
 * side compares by digest and names the answers that differ.
 *
 * `VARIANCE_AUTHORITY_CACHE` passes through, so the index asked is the caller's.
 * `--bin` asks another build, such as a checkout of `main`, the same questions.
 */

const BUILT = resolve(import.meta.dirname, '../packages/cli/dist/bin.js');
const SNAPSHOT = /^Snapshot .*$/gm;

/** The questions in a set, each as the `ask` arguments it is put with. */
export function questionsOf(text) {
  return text.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#')).flatMap((line) => {
    const [kind, ...rest] = line.split(/\s+/);
    if (kind === 'name') {
      const name = rest[1];
      return [['symbol', '--name', name], ['uses', '--name', name]];
    }
    if (kind === 'search') return [['search', '--query', rest.join(' ')]];
    if (kind === 'entrypoint') return [['entrypoint', '--package', rest[0]]];
    if (kind === 'packages' || kind === 'gaps') return [[kind]];
    throw new Error(`a question set takes name, search, entrypoint, packages and gaps lines, not \`${line}\``);
  });
}

/** The file an answer is kept in: its place in the set, then its arguments. */
function fileOf(question, at) {
  const words = [question[0], ...question.slice(2)].join('-').replace(/[^A-Za-z0-9.@-]+/g, '-');
  return `${String(at).padStart(3, '0')}-${words}.txt`;
}

const masked = (text) => text.replace(SNAPSHOT, 'Snapshot <masked>');
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function asked(set, workspace, out, runs, bin) {
  mkdirSync(out, { recursive: true });
  const rows = [`# ${execFileSync('uptime', { encoding: 'utf8' }).trim()}`, ['question', 'runs', 'median_ms', 'worst_ms', 'bytes', 'exit', 'same'].join('\t')];
  questionsOf(readFileSync(set, 'utf8')).forEach((question, at) => {
    const times = [];
    let first;
    let same = true;
    let status = 0;
    for (let run = 0; run < runs; run++) {
      const started = process.hrtime.bigint();
      const answer = spawnSync(process.execPath, [bin, 'ask', ...question, '--just-answer'], { cwd: workspace, encoding: 'utf8', maxBuffer: 1 << 30 });
      times.push(Number(process.hrtime.bigint() - started) / 1e6);
      const text = `${answer.stdout}${answer.stderr === '' ? '' : `\n--- stderr\n${answer.stderr}`}`;
      status = answer.status ?? -1;
      if (first === undefined) first = text;
      else if (masked(text) !== masked(first)) same = false;
    }
    writeFileSync(join(out, fileOf(question, at)), first);
    rows.push([question.join(' '), runs, median(times).toFixed(1), Math.max(...times).toFixed(1), Buffer.byteLength(first), status, same].join('\t'));
    process.stderr.write(`${rows.at(-1)}\n`);
  });
  rows.push(`# ${execFileSync('uptime', { encoding: 'utf8' }).trim()}`);
  writeFileSync(join(out, 'timings.tsv'), `${rows.join('\n')}\n`);
}

const answersIn = (dir) => readdirSync(dir).filter((file) => file.endsWith('.txt')).sort();

/** A kept run's digest: one line per answer, its file, the digest of its masked text, bytes and lines. */
function digestOf(dir) {
  return answersIn(dir).map((name) => {
    const text = masked(readFileSync(join(dir, name), 'utf8'));
    return [name, digestString(text), Buffer.byteLength(text), text.split('\n').length].join('\t');
  });
}

/** The digest of either a kept run or a `.out` file, keyed by the answer's file. */
function digestsOf(path) {
  const lines = statSync(path).isDirectory() ? digestOf(path) : readFileSync(path, 'utf8').split('\n').filter((line) => line !== '' && !line.startsWith('#'));
  return new Map(lines.map((line) => [line.split('\t')[0], line.split('\t').slice(1).join('\t')]));
}

function compared(left, right) {
  if (!statSync(left).isDirectory() || !statSync(right).isDirectory()) {
    const [a, b] = [digestsOf(left), digestsOf(right)];
    const names = [...new Set([...a.keys(), ...b.keys()])].sort();
    const differ = names.filter((name) => a.get(name) !== b.get(name));
    for (const name of differ) console.log(`${name}: ${a.get(name) ?? 'kept on one side only'} and ${b.get(name) ?? 'kept on one side only'}`);
    console.log(`${names.length - differ.length} of ${names.length} answers the same`);
    return differ.length === 0;
  }
  const names = [...new Set([...answersIn(left), ...answersIn(right)])].sort();
  let differ = 0;
  for (const name of names) {
    const read = (dir) => { try { return masked(readFileSync(join(dir, name), 'utf8')); } catch { return undefined; } };
    const [a, b] = [read(left), read(right)];
    if (a === b) continue;
    differ++;
    if (a === undefined || b === undefined) { console.log(`${name}: kept on one side only`); continue; }
    const [la, lb] = [a.split('\n'), b.split('\n')];
    const line = la.findIndex((text, at) => text !== lb[at]);
    const first = line === -1 ? la.length : line;
    console.log(`${name}: differs from line ${first + 1} (${la.length} and ${lb.length} lines)\n  < ${la[first] ?? ''}\n  > ${lb[first] ?? ''}`);
  }
  console.log(`${names.length - differ} of ${names.length} answers the same`);
  return differ === 0;
}

const { positionals: [command, ...paths], values } = parseArgs({
  allowPositionals: true,
  options: { workspace: { type: 'string' }, out: { type: 'string' }, runs: { type: 'string', default: '1' }, bin: { type: 'string', default: BUILT } },
});
if (command === 'ask') {
  if (values.workspace === undefined || values.out === undefined) throw new Error('`ask` takes `--workspace` and `--out`');
  asked(resolve(paths[0]), resolve(values.workspace), resolve(values.out), Number(values.runs), resolve(values.bin));
}
else if (command === 'digest') process.stdout.write(`${digestOf(resolve(paths[0])).join('\n')}\n`);
else if (command === 'compare') process.exitCode = compared(resolve(paths[0]), resolve(paths[1])) ? 0 : 1;
else if (command !== undefined) throw new Error(`name-questions takes \`ask\`, \`digest\` or \`compare\`, not \`${command}\``);
