#!/usr/bin/env node
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { digestString } from '@variance-authority/core/format';

/**
 * Asks a fixed question set of a workspace through a built CLI, keeps each
 * answer and how long it took, and compares two kept runs with the `Snapshot`
 * line masked: a change to how the name questions are stored keeps the answers
 * and cuts the times.
 *
 * `node tools/name-questions.mjs ask <set> --workspace <dir> --out <dir> [--runs <n>] [--bin <bin.js>]`
 * `node tools/name-questions.mjs digest <kept>` and `compare <kept|.out> <kept|.out>`
 */

const BUILT = resolve(import.meta.dirname, '../packages/cli/dist/bin.js');
const SNAPSHOT = /^Snapshot .*$/gm;
/**
 * Beside an answer, what later runs of the same build answered otherwise. With
 * `--runs`, each run is held against the first, and `compare` counts an answer
 * kept with one as not the same, on either side, kept or digested.
 */
const UNSTABLE = '.unstable';
/** An unstable answer's place in a digest, where its digest would be. */
const MOVED = 'unstable';
const ANSWERED_OTHERWISE = 'answered otherwise by another run of the same build';

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
    const moved = [];
    let first;
    let status = 0;
    for (let run = 0; run < runs; run++) {
      const started = process.hrtime.bigint();
      const answer = spawnSync(process.execPath, [bin, 'ask', ...question, '--just-answer'], { cwd: workspace, encoding: 'utf8', maxBuffer: 1 << 30 });
      times.push(Number(process.hrtime.bigint() - started) / 1e6);
      const text = `${answer.stdout}${answer.stderr === '' ? '' : `\n--- stderr\n${answer.stderr}`}`;
      status = answer.status ?? -1;
      if (first === undefined) first = text;
      else if (masked(text) !== masked(first)) moved.push(`--- run ${run + 1} of ${runs}\n${text}`);
    }
    const same = moved.length === 0;
    writeFileSync(join(out, fileOf(question, at)), first);
    if (!same) writeFileSync(join(out, `${fileOf(question, at)}${UNSTABLE}`), moved.join('\n'));
    rows.push([question.join(' '), runs, median(times).toFixed(1), Math.max(...times).toFixed(1), Buffer.byteLength(first), status, same].join('\t'));
    process.stderr.write(`${rows.at(-1)}\n`);
  });
  rows.push(`# ${execFileSync('uptime', { encoding: 'utf8' }).trim()}`);
  writeFileSync(join(out, 'timings.tsv'), `${rows.join('\n')}\n`);
}

const answersIn = (dir) => readdirSync(dir).filter((file) => file.endsWith('.txt')).sort();
const movedIn = (dir, name) => existsSync(join(dir, `${name}${UNSTABLE}`));

/**
 * A kept run's digest, its `.out`: one line per answer, its file, the `digestString` of its masked
 * text, bytes and lines, or `unstable` in their place for an answer another run gave otherwise.
 * A kept run is megabytes on a large workspace; its digest is small enough to check in beside
 * the set, and `compare` reads it by digest where two kept runs compare line for line.
 */
function digestOf(dir) {
  return answersIn(dir).map((name) => {
    if (movedIn(dir, name)) return [name, MOVED].join('\t');
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
    const differ = names.filter((name) => a.get(name) !== b.get(name) || a.get(name) === MOVED);
    for (const name of differ) {
      if (a.get(name) === MOVED || b.get(name) === MOVED) console.log(`${name}: ${ANSWERED_OTHERWISE}`);
      else console.log(`${name}: ${a.get(name) ?? 'kept on one side only'} and ${b.get(name) ?? 'kept on one side only'}`);
    }
    console.log(`${names.length - differ.length} of ${names.length} answers the same`);
    return differ.length === 0;
  }
  const names = [...new Set([...answersIn(left), ...answersIn(right)])].sort();
  let differ = 0;
  for (const name of names) {
    const read = (dir) => { try { return masked(readFileSync(join(dir, name), 'utf8')); } catch { return undefined; } };
    if (movedIn(left, name) || movedIn(right, name)) { differ++; console.log(`${name}: ${ANSWERED_OTHERWISE}`); continue; }
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

// Run as a command, not when a test imports `questionsOf` to read a set the same way.
// `VARIANCE_AUTHORITY_CACHE` passes through, so the index asked is the caller's; `--bin` asks another build, such as `main`'s.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
