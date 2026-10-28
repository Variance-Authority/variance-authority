import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CASE_DIRECTORY_VARIABLE, CONTINUATIONS_VARIABLE, STORY_DIRECTORY_VARIABLE } from './jest.js';
import SelectionReporter from './jest-reporter.js';

const VARIABLES = [CASE_DIRECTORY_VARIABLE, CONTINUATIONS_VARIABLE, STORY_DIRECTORY_VARIABLE];
const before = VARIABLES.map((name) => process.env[name]);
const temporary: string[] = [];

afterEach(async () => {
  VARIABLES.forEach((name, at) => {
    if (before[at] === undefined) delete process.env[name];
    else process.env[name] = before[at];
  });
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('hands its workers no case scope of a run it was started inside, under the loads recipe', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-inherited-'));
  temporary.push(root);
  await writeFile(resolve(root, 'package.json'), '{"name":"fixture","private":true}\n');
  // What an outer Jest run recording cases leaves in the environment of a Jest it starts.
  process.env[CASE_DIRECTORY_VARIABLE] = resolve(root, 'outer-cases');
  process.env[CONTINUATIONS_VARIABLE] = '1';
  process.env[STORY_DIRECTORY_VARIABLE] = resolve(root, 'outer-stories');

  const reporter = new SelectionReporter(undefined, {
    root,
    coverageFile: resolve(root, 'coverage.bin'),
    preconditions: [],
    mode: 'loads',
  });
  reporter.onRunStart();

  expect(VARIABLES.map((name) => process.env[name])).toEqual([undefined, undefined, undefined]);
});
