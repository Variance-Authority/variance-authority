/**
 * Ask the record about the text an editor holds.
 *
 * The extension computes nothing about coverage. The CLI owns the record, the
 * frame and the one state every range is painted as, and this module only
 * carries the buffer to it on standard input and the answer back. A second
 * reading of the record in here would be a second implementation of `stateOf`,
 * and two editors could then paint one range differently.
 */

'use strict';

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

/**
 * The CLI this workspace installed, or the one a setting names, or the one on
 * `PATH`. The workspace's own comes first because it reads the recording the
 * workspace's own suite wrote.
 */
function commandFor(root, configured) {
  if (configured) return configured;
  const local = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'variance.cmd' : 'variance');
  return existsSync(local) ? local : 'variance';
}

/**
 * One question about one file, answered as the CLI's JSON. `text` is the
 * buffer, saved or not; `line` narrows the question to one line of it.
 *
 * Resolves to `{ answer }` or `{ refusal }`: a refusal is the CLI's own
 * sentence, shown to the person as it was written. `quiet` marks a refusal
 * that holds for the whole workspace until a run changes it: no CLI to start,
 * or nothing recorded. `cancel` stops the process
 * when a newer edit has made the question stale.
 */
function ask({ root, file, text, line, command }) {
  const argv = ['covering', '--file', file, '--root', root, '--text', '-', '--format', 'json'];
  if (line !== undefined) argv.push('--line', String(line));

  let child;
  const answer = new Promise((resolve) => {
    child = spawn(commandFor(root, command), argv, {
      cwd: root,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (error) => resolve({ refusal: `variance could not be started: ${error.message}`, quiet: true }));
    child.on('close', (code, signal) => {
      if (signal !== null) return resolve({ cancelled: true });
      if (code !== 0) {
        const refusal = firstParagraph(Buffer.concat(err).toString('utf8'));
        return resolve(unrecorded(Buffer.concat(out).toString('utf8')) ? { refusal, quiet: true } : { refusal });
      }
      try {
        resolve({ answer: JSON.parse(Buffer.concat(out).toString('utf8')) });
      } catch (error) {
        resolve({ refusal: `variance answered with something other than JSON: ${error.message}` });
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  });
  return { answer, cancel: () => child.kill() };
}

/** Whether a refusal says nothing is recorded, by its kind and never by its words. */
function unrecorded(stdout) {
  try {
    return JSON.parse(stdout).refused === 'unrecorded';
  } catch {
    return false;
  }
}

/** A refusal's first paragraph is the sentence; the rest routes a terminal reader. */
function firstParagraph(text) {
  return text.trim().split(/\n\s*\n/)[0] || 'variance stopped without saying why.';
}

/**
 * Every suite's answer, in the order the CLI gave them, nearest kind first. A
 * repository that declares suites answers each under `suites`, with its own
 * `suite`, `kind` and `frame`, or with `refused` and `reason` when its record
 * could not answer. One that declares none answers once, as a suite without a
 * name.
 */
function suitesOf(answer) {
  if (answer === undefined) return [];
  return Array.isArray(answer.suites) ? answer.suites : [answer];
}

/**
 * The runs of lines to paint, each with its one state. Under `suites` the CLI
 * has already read every suite's ranges into one mark per run (`marks`); a
 * repository that declares none paints its ranges as they are. A stale record
 * gives no ranges, so it paints nothing.
 */
function marksOf(answer) {
  if (answer === undefined) return [];
  return Array.isArray(answer.suites) ? answer.marks ?? [] : answer.ranges ?? [];
}

/**
 * What every suite says about one line: the range each placed over it, nearest
 * suite first, and the suites that could not answer about the file at all.
 */
function atLine(answer, line) {
  const answered = [];
  const refused = [];
  for (const one of suitesOf(answer)) {
    if (one.reason !== undefined) {
      refused.push(one);
      continue;
    }
    const range = (one.ranges ?? []).find((range) => range.startLine <= line && line <= range.endLine);
    if (range !== undefined) answered.push({ suite: one.suite, kind: one.kind, range });
  }
  return { answered, refused };
}

module.exports = { ask, atLine, commandFor, marksOf, suitesOf };
