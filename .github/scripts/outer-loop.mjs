#!/usr/bin/env node
//
// The outer loop: a review flow driven end to end against the example that
// carries it, the way a consumer meets it — a pull request opened, a check gone
// red, a comment read, an accept made where the flow has one, a check gone
// green, the pull request closed. It never approves and never merges.
// `outer-loop.yml` runs it weekly, once per flow.
//
//   node .github/scripts/outer-loop.mjs run      drive OUTER_LOOP_FLOW
//   node .github/scripts/outer-loop.mjs settle   sweep, then open or close its issue
//
// `run` exits 1 with every broken promise as an `::error::`, and leaves them in
// `$RUNNER_TEMP/outer-loop-<flow>.txt` for `settle`, which reads
// OUTER_LOOP_OUTCOME (the run step's outcome) to decide what the issue says.

import { writeFileSync } from 'node:fs';

import { drive } from './outer-loop/drive.mjs';
import { failureFile, settle } from './outer-loop/settle.mjs';

const [command] = process.argv.slice(2);
const name = process.env.OUTER_LOOP_FLOW;

if (command === 'run') {
  try {
    await drive(name, process.env);
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    writeFileSync(failureFile(process.env, name), `${said}\n`);
    fail(said);
  }
} else if (command === 'settle') {
  const problems = await settle(name, process.env.OUTER_LOOP_OUTCOME, process.env);
  if (problems.length > 0) fail(problems.join('\n'));
} else {
  fail(`usage: outer-loop.mjs run|settle, with OUTER_LOOP_FLOW set; got '${command ?? ''}'`);
}

function fail(message) {
  for (const line of message.split('\n')) console.log(`::error::${line}`);
  process.exit(1);
}
