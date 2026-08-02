#!/usr/bin/env node
//
// Where this run put its report, and where its baselines live.
//
// The action needs two paths the operator already wrote down once, in their
// variance config: the report `variance run` produced, and the baseline store a
// commit-back would stage. Re-declaring them as action inputs would be worse than
// this file: two places to change, no error when they disagree, and a comment
// posted about a report from a previous run because the input still pointed at
// the old path. So the config is the single source, exactly as it is for the CLI.
//
// **This is a locator, not a parser.** It does not validate, default, or repair
// anything, and it must not start to — `parseConfig` in the CLI owns what a valid
// config is, and a second, more forgiving reader here would accept runs the real
// parser refuses. It is safe precisely because of when it runs: the action only
// reaches this step after the CLI exited 0 or 1, which means the CLI already read
// and accepted this file. If it exited 2, the config was refused and every step
// downstream of the run is skipped.
//
// Output is `key=value` lines for `$GITHUB_OUTPUT`. A path containing a newline
// is refused rather than written: `$GITHUB_OUTPUT` is line-oriented, so such a
// path would let a filename inject an arbitrary step output.

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/** The CLI's own default. Duplicated here because a locator cannot import from it. */
const DEFAULT_REPORT_PATH = '.variance/report.json';

const configPath = process.argv[2];
if (configPath === undefined) {
  fail('usage: locate-artifacts.mjs <path to variance config>');
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (error) {
  fail(`cannot read the variance config ${configPath}: ${messageOf(error)}`);
}

const baseDir = dirname(resolve(configPath));

const report = from(baseDir, typeof config.report === 'string' ? config.report : DEFAULT_REPORT_PATH);

// Absent for `ephemeral` retention, which stores nothing. Emitted as an empty
// value rather than omitted, so the commit-back step can tell "no store
// configured" from "this script did not run".
const baselines =
  config.baselines !== null &&
  typeof config.baselines === 'object' &&
  typeof config.baselines.root === 'string'
    ? from(baseDir, config.baselines.root)
    : '';

const retention = typeof config.retention === 'string' ? config.retention : '';

emit('report', report);
emit('baselines', baselines);
emit('retention', retention);

function from(base, value) {
  return isAbsolute(value) ? value : resolve(base, value);
}

function emit(key, value) {
  if (value.includes('\n') || value.includes('\r')) {
    fail(`\`${key}\` resolves to a path containing a line break, which cannot be a step output`);
  }
  process.stdout.write(`${key}=${value}\n`);
}

/**
 * The exception to the "annotations go to stdout" rule in `post-comment.mjs`.
 *
 * This script's stdout *is* `$GITHUB_OUTPUT` — the calling step redirects it — so
 * an annotation written there would be appended to the step's outputs as a
 * malformed line instead of being shown to anyone. Errors go to stderr, and the
 * non-zero exit is what stops the job.
 */
function fail(message) {
  process.stderr.write(`variance action: ${message}\n`);
  process.exit(2);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
