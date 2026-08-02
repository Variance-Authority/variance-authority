#!/usr/bin/env node
//
// Turn the run report into the comment body, using the CLI's own renderer.
//
// Nothing about the docket's shape is decided here. `renderComment` in
// `@variance-authority/cli` is a pure function from a report to a string and it
// is unit-tested against hand-built reports; a second renderer living in the
// action would drift from it, and the day it did, the comment on a pull request
// and the output of `variance report` would describe the same run differently
// with no way to tell which one had been fixed.
//
// ## The import is a deep one, and that is a known cost
//
// The CLI's package exports expose `.` only, so the renderer is reached by
// resolving the package's own entry point and walking to its sibling. That
// couples this file to `dist/commands/comment.js` existing at that path — a build
// layout, not a published contract. The honest fix is a `variance comment`
// subcommand, so the action would shell out exactly as it does for `run`; that
// was outside the scope this file was written under. Until then the failure is at
// least loud: a resolution miss prints what it tried and exits non-zero rather
// than posting a comment assembled by something else.
//
// `VARIANCE_COMMENT_MODULE` overrides the search with an explicit path, for a
// repository that vendors or bundles the CLI somewhere this cannot guess.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const options = parseArgs(process.argv.slice(2));

const { renderComment, COMMENT_MARKER } = await loadRenderer();

// The marker is emitted before anything can go wrong with the report, because the
// poster needs it even when there is no body: the "this run is clean" case is the
// one where it has to find a *previous* comment and can produce no marker of its
// own.
output('marker', COMMENT_MARKER);

let report;
try {
  report = JSON.parse(readFileSync(options.report, 'utf8'));
} catch (error) {
  fail(
    `cannot read the run report ${options.report}: ${messageOf(error)}. ` +
      'The run wrote no report, or the config names a different path than the one this ' +
      'action resolved.',
  );
}

const body = renderComment({
  report,
  ...(options.runUrl === undefined ? {} : { runUrl: options.runUrl }),
});

// An empty file, not a missing one. The poster distinguishes "nothing to review"
// from "the render never ran", and only the first of those is allowed to clear a
// previous docket.
writeFileSync(options.bodyFile, body, 'utf8');

process.stdout.write(
  body === ''
    ? 'variance: nothing needs review, so there is no comment body.\n'
    : `variance: comment body is ${body.length} character(s).\n`,
);

async function loadRenderer() {
  const explicit = process.env['VARIANCE_COMMENT_MODULE'];
  const attempts = [];

  if (explicit !== undefined && explicit !== '') {
    attempts.push(pathToFileURL(resolve(explicit)).href);
  } else {
    // Resolved from the working directory rather than from this file: the action
    // is checked out under `.github/`, and the CLI is a dependency of the project
    // being tested, not of the action.
    const require = createRequire(pathToFileURL(join(process.cwd(), 'package.json')));
    try {
      const entry = require.resolve('@variance-authority/cli');
      attempts.push(new URL('./commands/comment.js', pathToFileURL(entry)).href);
    } catch (error) {
      fail(
        `cannot resolve @variance-authority/cli from ${process.cwd()}: ${messageOf(error)}. ` +
          'Run this action from the directory where the CLI is installed, or set ' +
          'VARIANCE_COMMENT_MODULE to the built comment module.',
      );
    }
  }

  for (const candidate of attempts) {
    try {
      return await import(candidate);
    } catch (error) {
      fail(
        `cannot load the comment renderer from ${candidate}: ${messageOf(error)}. ` +
          'This action reaches into the CLI package layout; if that layout changed, set ' +
          'VARIANCE_COMMENT_MODULE to the built comment module.',
      );
    }
  }

  fail('no comment renderer was found and no error explained why, which is a defect here');
}

function parseArgs(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    // Unknown flags are refused rather than ignored, for the reason the CLI
    // refuses them: a misspelled flag that is silently dropped produces a run
    // that looks like the one the operator asked for and is not.
    if (!['--report', '--body-file', '--run-url'].includes(name)) {
      fail(`unknown argument \`${String(name)}\`; this takes --report, --body-file, --run-url`);
    }
    if (value === undefined) fail(`\`${name}\` needs a value`);
    values.set(name, value);
  }

  const report = values.get('--report');
  const bodyFile = values.get('--body-file');
  if (report === undefined || bodyFile === undefined) {
    fail('--report and --body-file are both required');
  }

  const runUrl = values.get('--run-url');
  return {
    report,
    bodyFile,
    ...(runUrl === undefined || runUrl === '' ? {} : { runUrl }),
  };
}

function output(key, value) {
  const file = process.env['GITHUB_OUTPUT'];
  if (file === undefined || file === '') return;
  if (value.includes('\n')) fail(`\`${key}\` contains a line break and cannot be a step output`);
  appendFileSync(file, `${key}=${value}\n`, 'utf8');
}

/** Annotations go to stdout; see the note in `post-comment.mjs`. */
function fail(message) {
  process.stdout.write(`::error::variance action: ${message}\n`);
  process.exit(2);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
