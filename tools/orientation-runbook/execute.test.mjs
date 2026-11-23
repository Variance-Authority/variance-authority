import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeProgram } from './execute.mjs';

const budgets = { calls: 8, milliseconds: 100, answerBytes: 1000 };
const program = (steps, limits = {}) => ({ version: 1, budgets: { ...budgets, ...limits }, steps });
const step = (id, extra = {}) => ({ id, question: 'find', input: {}, ...extra });
const observation = (files = [], extra = {}) => ({
  status: 'answered', answer: 'canonical answer', membershipStatus: 'complete',
  files: files.map(file => ({ file, lines: [1] })), apiCallCount: 2, ...extra,
});
const options = (extra = {}) => ({
  request: {}, provenance: { index: 'fixture-index', build: 'fixture-build' },
  validate: () => {}, drive: async () => observation(), ...extra,
});

test('branches on complete emptiness and binds follow-ups to observed files', async () => {
  const calls = [];
  const result = await executeProgram(program([
    step('seed', { request: { query: 'clue' } }),
    step('fallback', { when: { step: 'seed', is: 'empty' } }),
    step('follow', { fromFiles: { step: 'fallback', input: 'from' } }),
  ]), options({
    request: { clue: 'panel' },
    drive: async (question, input) => {
      calls.push({ question, input });
      return observation(calls.length === 2 ? ['src/Panel.ts'] : []);
    },
  }));
  assert.equal(result.halt, 'program-ended');
  assert.deepEqual(calls.map(call => call.input), [{ query: 'panel' }, {}, { from: ['src/Panel.ts'] }]);
  assert.equal(result.apiCalls, 6);
  assert.equal(result.provenance.build, 'fixture-build');
  assert.match(result.programHash, /^v1:[a-f0-9]{32}$/u);
});

test('unknown membership never takes the empty branch', async () => {
  const result = await executeProgram(program([
    step('seed'),
    step('wrong', { when: { step: 'seed', is: 'empty' } }),
    step('recover', { when: { step: 'seed', is: 'unknown' }, input: { query: 'other' } }),
  ]), options({ drive: async () => observation([], { membershipStatus: 'unknown' }) }));
  assert.deepEqual(result.trace.map(row => [row.step, row.state]), [
    ['seed', 'unknown'], ['wrong', 'condition-skipped'], ['recover', 'unknown'],
  ]);
});

test('per-observation completeness is not poisoned by earlier unknown evidence', async () => {
  let calls = 0;
  const result = await executeProgram(program([
    step('seed'), step('second', { input: { query: 'other' } }),
    step('third', { when: { step: 'second', is: 'nonempty' }, input: { query: 'third' } }),
  ]), options({ drive: async () => ++calls === 1
    ? observation([], { membershipStatus: 'unknown' }) : observation(['src/A.ts']) }));
  assert.equal(result.trace[2].state, 'nonempty');
  assert.equal(result.completion, 'unproved');
});

test('repeated canonical calls are suppressed even when object key order changes', async () => {
  const result = await executeProgram(program([
    step('one', { input: { a: 1, b: 2 } }), step('two', { input: { b: 2, a: 1 } }),
  ]), options());
  assert.equal(result.calls, 1);
  assert.equal(result.trace[1].state, 'repeated-call');
});

test('reusing a call reuses its facts for subsequent branches and bindings', async () => {
  const result = await executeProgram(program([
    step('seed'), step('same'), step('follow', {
      when: { step: 'same', is: 'nonempty' }, fromFiles: { step: 'same', input: 'from' },
    }),
  ]), options({ drive: async () => observation(['src/A.ts']) }));
  assert.equal(result.calls, 2);
  assert.deepEqual(result.evidence[1].input, { from: ['src/A.ts'] });
  assert.equal(result.trace[1].evidence, 0);
});

test('a complete empty child does not erase uncertainty in its parent bindings', async () => {
  for (const membershipStatus of ['incomplete', 'unknown']) {
    let calls = 0;
    const result = await executeProgram(program([
      step('seed'), step('child', { fromFiles: { step: 'seed', input: 'from' } }),
      step('wrong', { when: { step: 'child', is: 'empty' }, input: { query: 'wrong' } }),
    ]), options({ drive: async () => ++calls === 1
      ? observation(['src/A.ts'], { membershipStatus }) : observation() }));
    assert.equal(result.trace[1].state, 'empty'); // The reader itself was complete.
    assert.equal(result.trace[2].state, 'condition-skipped');
    assert.equal(result.calls, 2);
  }
});

test('one soft deadline spans every dispatch and includes the in-flight overrun', async () => {
  let now = 0;
  const result = await executeProgram(program([
    step('one'), step('two', { input: { query: 'next' } }),
  ], { milliseconds: 5 }), options({
    clock: () => now, drive: async () => { now += 6; return observation(); },
  }));
  assert.equal(result.halt, 'soft-time-budget');
  assert.equal(result.calls, 1);
  assert.equal(result.elapsedMs, 6);
});

test('empty incomplete bindings remain incomplete through another follow-up', async () => {
  const result = await executeProgram(program([
    step('seed'),
    step('child', { fromFiles: { step: 'seed', input: 'from' } }),
    step('recover', { when: { step: 'child', is: 'incomplete' }, input: { query: 'recover' } }),
    step('skipped', { when: { step: 'seed', is: 'empty' } }),
    step('unrelated', { when: { step: 'skipped', is: 'incomplete' } }),
  ]), options({ drive: async () => observation([], { membershipStatus: 'incomplete' }) }));
  assert.equal(result.calls, 2);
  assert.equal(result.trace.find(row => row.step === 'recover').state, 'incomplete');
  assert.equal(result.trace.find(row => row.step === 'unrelated').state, 'condition-skipped');
});

test('every execution receipt carries an independent copy of its configured budgets', async () => {
  for (const limits of [{}, { calls: 0 }, { milliseconds: 0 }, { answerBytes: 0 }]) {
    const supplied = program([step('one')], limits);
    const expected = { ...supplied.budgets };
    const result = await executeProgram(supplied, options());
    assert.deepEqual(result.budgets, expected);
    supplied.budgets.calls++;
    assert.deepEqual(result.budgets, expected);
  }
});

test('the invocation deadline includes time already spent opening the published index', async () => {
  const result = await executeProgram(program([step('one')], { milliseconds: 5 }), options({
    startedAt: 0, clock: () => 6,
  }));
  assert.equal(result.halt, 'soft-time-budget');
  assert.equal(result.calls, 0);
});

test('call and output limits disclose omissions without losing full evidence', async () => {
  const steps = [step('one'), step('two', { input: { query: 'next' } })];
  const capped = await executeProgram(program(steps, { calls: 1 }), options());
  assert.equal(capped.halt, 'call-budget');
  assert.deepEqual(capped.omittedSteps, ['two']);
  const oversized = await executeProgram(program(steps, { answerBytes: 3 }), options());
  assert.equal(oversized.halt, 'answer-budget');
  assert.deepEqual(oversized.answers, []);
  assert.equal(oversized.evidence[0].observation.answer, 'canonical answer');
  assert.equal(oversized.omittedAnswerBytes, Buffer.byteLength('canonical answer'));
});

test('every bound call is schema-validated before dispatch', async () => {
  let calls = 0;
  const result = await executeProgram(program([
    step('seed', { request: { query: 'clue' } }),
  ]), options({
    request: { clue: 42 }, validate: (_question, input) => {
      assert.equal(typeof input.query, 'string', 'query must be a string');
    }, drive: async () => { calls++; return observation(); },
  }));
  assert.equal(result.halt, 'invalid-input');
  assert.match(result.error.message, /query must be a string/u);
  assert.equal(calls, 0);
});

test('invalid programs, missing request values and forward references are rejected', async () => {
  await assert.rejects(() => executeProgram({ version: 2 }, options()), /program/u);
  await assert.rejects(() => executeProgram(program([step('a'), step('a')]), options()), /duplicate/u);
  await assert.rejects(() => executeProgram(program([
    step('a', { fromFiles: { step: 'future', input: 'from' } }),
  ]), options()), /earlier/u);
  const missing = await executeProgram(program([
    step('a', { request: { query: 'missing' } }),
  ]), options());
  assert.equal(missing.halt, 'binding-error');
  assert.match(missing.error.message, /missing request/u);
});

test('a later validation failure preserves earlier calls, provenance and evidence', async () => {
  const result = await executeProgram(program([
    step('seed'), step('bad', { input: { query: 42 } }), step('never'),
  ]), options({ validate: (_question, input) => {
    if (input.query === 42) throw new TypeError('invalid query');
  } }));
  assert.equal(result.halt, 'invalid-input');
  assert.equal(result.calls, 1);
  assert.equal(result.apiCalls, 2);
  assert.equal(result.evidence[0].observation.answer, 'canonical answer');
  assert.equal(result.provenance.build, 'fixture-build');
  assert.equal(result.error.step, 'bad');
  assert.deepEqual(result.omittedSteps, ['bad', 'never']);
});

test('binding over partial membership preserves its qualification', async () => {
  let calls = 0;
  const result = await executeProgram(program([
    step('seed'), step('next', { fromFiles: { step: 'seed', input: 'from' } }),
  ]), options({ drive: async () => ++calls === 1
    ? observation(['src/A.ts'], { membershipStatus: 'incomplete', unread: ['unresolved import'] })
    : observation() }));
  assert.equal(result.trace[0].state, 'incomplete');
  assert.equal(result.trace[1].binding.membershipStatus, 'incomplete');
  assert.equal(result.evidence[0].observation.unread[0], 'unresolved import');
});

test('reader failure has its own branch and does not imply empty membership', async () => {
  let calls = 0;
  const result = await executeProgram(program([
    step('seed'), step('retry', { when: { step: 'seed', is: 'error' }, input: { query: 'other' } }),
  ]), options({ drive: async () => ++calls === 1
    ? { status: 'error', error: { message: 'unavailable' }, apiCallCount: 1 }
    : observation() }));
  assert.equal(result.trace[0].state, 'error');
  assert.equal(result.trace[1].state, 'empty');
  assert.equal(result.apiCalls, 3);
});
