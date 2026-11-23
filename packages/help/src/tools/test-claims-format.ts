/**
 * The `docs_test_claims` answer as text: what one test says it does, what it
 * ran, what it adds to the suite, and what it passed by.
 *
 * The claims are its name and, when the run kept an Eyes journal, its steps
 * and assertions in the order it made them. Everything after them is regions
 * of the recording: a function or a branch, by its place and its name, never
 * by source text.
 */

// compass: variance-authority.report.agent-surface

import type { RecordedSteps } from '@variance-authority/mcp/recorded-steps';
import { cappedRows } from '@variance-authority/mcp/tools';
import type { JourneyCase, JourneyPiece, RanModule, RanRegion, TestComposition, TestRan } from '@variance-authority/sense';
import { regionPlace, spanOf, namedTest } from './test-composition-format.js';

/** Rows listed per part when the part is longer. */
const ROWS = 12;

/** Steps listed before the rest are counted: the claims are what this answer is read for. */
const STEPS = 40;

/** The claims of `test` beside what it ran; both answers are read from the same recording, and neither is a refusal. */
export function formatTestClaims(test: JourneyCase, composition: TestComposition, ran: TestRan, steps: RecordedSteps): string {
  return [
    `${test.file}  ${test.name}`,
    '',
    'Claims:',
    `  its name: ${test.name}`,
    ...claimed(steps),
    '',
    ...entered(ran),
    '',
    'Adds:',
    ...alike(composition.alike),
    `  pieces, smaller tests inside it: ${others(composition.pieces, 'the most shared')}`,
    `  wholes, larger tests holding it: ${others(composition.wholes, 'the smallest')}`,
    ...alone(ran.modules),
    '',
    ...passedBy(ran.modules),
  ].join('\n');
}

function claimed(steps: RecordedSteps): string[] {
  if ('unrecorded' in steps) {
    return [`  its steps and assertions are not recorded: ${steps.unrecorded}, which says nothing about whether the test makes any.`];
  }
  const from = steps.attempts > 1 ? `, from attempt ${steps.attempt} of ${steps.attempts}` : '';
  const partial = steps.partial === undefined ? [] : [`    the journal stops short: ${steps.partial}`];
  if (steps.steps.length === 0) return [`  its steps and assertions${from}: Eyes recorded none`, ...partial];
  return [`  its steps and assertions${from}:`, ...cappedRows(steps.steps, (step) => `    ${step}`, STEPS), ...partial];
}

/** The functions it entered, a row per file; structure, which more than half the suite entered, is only counted. */
function entered(ran: TestRan): string[] {
  const structure = (region: RanRegion) => region.structure;
  const files = ran.modules.flatMap(({ file, regions }) => {
    const functions = regions.filter((region) => region.kind === 'function' && region.source && region.entered && !structure(region));
    return functions.length === 0 ? [] : [{ file, functions }];
  });
  const shared = ran.modules.reduce(
    (count, { regions }) => count + regions.filter((region) => region.kind === 'function' && region.source && region.entered && structure(region)).length,
    0,
  );
  const majority = `run by more than half of the ${ran.suite} recorded tests`;
  const counted = `${shared} ${shared === 1 ? 'function' : 'functions'}`;
  if (files.length === 0) return ['Ran, the functions it entered:', shared === 0 ? '  none' : `  ${counted}, all structure, ${majority}`];
  return [
    'Ran, the functions it entered:',
    ...cappedRows(files, ({ file, functions }) => `  ${file}  ${functions.map(functionName).join(', ')}`, ROWS),
    ...(shared === 0 ? [] : [`  and ${counted} of structure, ${majority}`]),
  ];
}

function functionName(region: RanRegion): string {
  return region.function === undefined || region.function === null || region.function === ''
    ? `function at ${spanOf(region)}`
    : region.function;
}

function alike(cases: readonly JourneyCase[]): string[] {
  if (cases.length === 0) return ['  no other test runs the same regions, structure aside'];
  return [
    `  runs the same regions as ${cases.length} other ${cases.length === 1 ? 'test' : 'tests'}, structure aside:`,
    ...cappedRows(cases, (other) => `    ${namedTest(other)}`, ROWS),
  ];
}

function others(pieces: readonly JourneyPiece[], first: string): string {
  const [head] = pieces;
  if (head === undefined) return 'none';
  return pieces.length === 1 ? namedTest(head.case) : `${pieces.length}, ${first} ${namedTest(head.case)}`;
}

/** The source regions it entered that no other test enters. */
function alone(modules: readonly RanModule[]): string[] {
  const rows = modules.flatMap(({ file, regions }) =>
    regions.filter((region) => region.source && region.entered && region.others === 0).map((region) => regionPlace(file, region)));
  if (rows.length === 0) return ['  only this test enters: nothing'];
  return ['  only this test enters:', ...cappedRows(rows, (row) => `    ${row}`, ROWS)];
}

/**
 * What it did not take inside the functions it entered — a branch, a case, a
 * loop body, a handler, the code after an early exit — each with who takes it.
 * The record says which function each region is written in; a file whose
 * record does not is said to be not known, never to hold nothing.
 */
function passedBy(modules: readonly RanModule[]): string[] {
  const rows = modules.flatMap(({ file, ownersNamed, regions }) => ownersNamed
    ? regions
      .filter((region) => region.kind !== 'function' && region.source && !region.entered && region.functionEntered === true)
      .map((region) => `${regionPlace(file, region)}  ${takers(region)}`)
    : [`${file}: not known; the record names no owner for its regions, so which function holds each is not known`]);
  if (rows.length === 0) return ['Passed by: nothing; it took every region of the functions it entered.'];
  return ['Passed by, the regions of the functions it entered that it did not take:', ...cappedRows(rows, (row) => `  ${row}`, ROWS)];
}

function takers(region: RanRegion): string {
  const smallest = region.smallest ?? undefined;
  if (region.others === 0 || smallest === undefined) return 'no test takes it';
  if (region.others === 1) return `taken by 1 other test: ${namedTest(smallest)}`;
  return `taken by ${region.others} other tests, the smallest ${namedTest(smallest)}`;
}
