#!/usr/bin/env node
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Asks a fixed question set of a workspace through the built CLI, keeps each
 * answer and how long it took, and compares two kept runs line for line, with
 * only the `Snapshot` line masked. A change to how the name questions are
 * stored is judged by it: the answers stay the same and the times fall.
 *
 * `node tools/name-questions.mjs ask <set> --workspace <dir> --out <dir> [--runs <n>]`
 * `node tools/name-questions.mjs compare <kept> <kept>`
 *
 * `VARIANCE_AUTHORITY_CACHE` passes through, so the index asked is the caller's.
 */

const BIN = resolve(import.meta.dirname, '../packages/cli/dist/bin.js');
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

function asked(set, workspace, out, runs) {
  mkdirSync(out, { recursive: true });
  const rows = [`# ${execFileSync('uptime', { encoding: 'utf8' }).trim()}`, ['question', 'runs', 'median_ms', 'worst_ms', 'bytes', 'exit', 'same'].join('\t')];
  questionsOf(readFileSync(set, 'utf8')).forEach((question, at) => {
    const times = [];
    let first;
    let same = true;
    let status = 0;
    for (let run = 0; run < runs; run++) {
      const started = process.hrtime.bigint();
      const answer = spawnSync(process.execPath, [BIN, 'ask', ...question, '--just-answer'], { cwd: workspace, encoding: 'utf8', maxBuffer: 1 << 30 });
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

function compared(left, right) {
  const files = (dir) => readdirSync(dir).filter((file) => file.endsWith('.txt'));
  const names = [...new Set([...files(left), ...files(right)])].sort();
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

function option(args, flag, fallback) {
  const at = args.indexOf(flag);
  if (at !== -1) return args[at + 1];
  if (fallback === undefined) throw new Error(`\`${flag}\` is required`);
  return fallback;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'ask') asked(resolve(args[0]), resolve(option(args, '--workspace')), resolve(option(args, '--out')), Number(option(args, '--runs', '1')));
else if (command === 'compare') process.exitCode = compared(resolve(args[0]), resolve(args[1])) ? 0 : 1;
else if (command !== undefined) throw new Error(`name-questions takes \`ask\` or \`compare\`, not \`${command}\``);
