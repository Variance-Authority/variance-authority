import Ajv from 'ajv';
import { canonicalize, digestValue } from '@variance-authority/core/format';

const reference = { type: 'string', minLength: 1 };
const schema = {
  type: 'object', additionalProperties: false, required: ['version', 'budgets', 'steps'],
  properties: {
    version: { const: 1 },
    budgets: {
      type: 'object', additionalProperties: false, required: ['calls', 'milliseconds', 'answerBytes'],
      properties: Object.fromEntries(['calls', 'milliseconds', 'answerBytes'].map(name =>
        [name, { type: 'integer', minimum: 0 }])),
    },
    steps: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['id', 'question', 'input'],
      properties: {
        id: reference, question: reference, input: { type: 'object' },
        request: { type: 'object', additionalProperties: reference },
        when: {
          type: 'object', additionalProperties: false, required: ['step', 'is'],
          properties: { step: reference, is: { enum: ['empty', 'nonempty', 'incomplete', 'unknown', 'error'] } },
        },
        fromFiles: {
          type: 'object', additionalProperties: false, required: ['step', 'input'],
          properties: { step: reference, input: reference },
        },
      },
    } },
  },
};
const validateProgram = new Ajv().compile(schema);

function checkProgram(program) {
  if (!validateProgram(program)) throw new TypeError(`invalid program: ${JSON.stringify(validateProgram.errors)}`);
  const previous = new Set();
  for (const step of program.steps) {
    if (previous.has(step.id)) throw new TypeError(`duplicate step: ${step.id}`);
    for (const dependency of [step.when?.step, step.fromFiles?.step].filter(Boolean)) {
      if (!previous.has(dependency)) throw new TypeError(`${step.id} must reference an earlier step: ${dependency}`);
    }
    const fields = [...Object.keys(step.input), ...Object.keys(step.request ?? {}),
      ...(step.fromFiles ? [step.fromFiles.input] : [])];
    if (new Set(fields).size !== fields.length) throw new TypeError(`input bound twice: ${step.id}`);
    previous.add(step.id);
  }
}

function summarize(observations, parent) {
  const files = [...new Set(observations.flatMap(row => (row.files ?? []).map(file => file.file)))];
  let state;
  if (!observations.length) state = parent?.state === 'condition-skipped' ? 'condition-skipped'
    : parent?.membershipStatus === 'complete' ? 'empty'
      : parent?.membershipStatus === 'incomplete' ? 'incomplete' : 'unknown';
  else if (observations.some(row => row.status === 'error')) state = 'error';
  else if (parent && parent.membershipStatus !== 'complete') state = parent.membershipStatus === 'incomplete' ? 'incomplete' : 'unknown';
  else if (observations.some(row => !['complete', 'incomplete'].includes(row.membershipStatus))) state = 'unknown';
  else if (observations.some(row => row.membershipStatus === 'incomplete')) state = 'incomplete';
  else state = files.length ? 'nonempty' : 'empty';
  return { state, files, membershipStatus: ['empty', 'nonempty'].includes(state) ? 'complete' : state };
}

/**
 * Execute an explicitly supplied research policy. This does not select a policy,
 * judge task completion, regenerate an index, or parse displayed answers.
 * The deadline is soft: an in-flight factual reader cannot be cancelled.
 */
export async function executeProgram(supplied, {
  request, provenance, drive, clock = () => performance.now(), startedAt,
}) {
  const started = startedAt ?? clock();
  const program = structuredClone(supplied);
  checkProgram(program);
  const results = new Map();
  const seen = new Map();
  const trace = [], evidence = [], answers = [];
  let calls = 0, apiCalls = 0, answerBytes = 0, omittedAnswerBytes = 0;
  const elapsed = () => Math.max(0, clock() - started);
  const finish = (halt, offset = program.steps.length, omittedBindings = 0) => ({
    version: 1, programHash: digestValue(program), budgets: { ...program.budgets },
    provenance, halt, completion: 'unproved', elapsedMs: elapsed(), calls, apiCalls,
    answerBytes, omittedAnswerBytes, omittedSteps: program.steps.slice(offset).map(step => step.id),
    omittedBindings, trace, evidence, answers,
  });
  const failure = (halt, index, error, input, omittedBindings = 0) => {
    const step = program.steps[index];
    trace.push({ step: step.id, state: halt, question: step.question, input });
    return { ...finish(halt, index, omittedBindings), error: {
      step: step.id, name: error.name, message: error.message,
    } };
  };
  for (let index = 0; index < program.steps.length; index++) {
    const step = program.steps[index];
    if (step.when && results.get(step.when.step).state !== step.when.is) {
      trace.push({ step: step.id, state: 'condition-skipped', when: step.when });
      results.set(step.id, { state: 'condition-skipped', files: [] });
      continue;
    }
    const input = structuredClone(step.input);
    try {
      for (const [field, key] of Object.entries(step.request ?? {})) {
        if (request == null || !Object.hasOwn(request, key)) throw new TypeError(`missing request value: ${key}`);
        input[field] = structuredClone(request[key]);
      }
    } catch (error) {
      return failure('binding-error', index, error, input);
    }
    const parent = step.fromFiles ? results.get(step.fromFiles.step) : undefined;
    const bindings = parent ? parent.files : [undefined];
    const observations = [];
    if (!bindings.length) trace.push({ step: step.id, state: 'no-observed-files',
      binding: { step: step.fromFiles.step, membershipStatus: parent.membershipStatus } });
    for (let position = 0; position < bindings.length; position++) {
      if (elapsed() >= program.budgets.milliseconds) return finish('soft-time-budget', index, bindings.length - position);
      const bound = structuredClone(input);
      const binding = step.fromFiles ? { step: step.fromFiles.step, file: bindings[position],
        membershipStatus: parent.membershipStatus } : undefined;
      if (binding) bound[step.fromFiles.input] = [binding.file];
      const identity = canonicalize({ question: step.question, input: bound });
      if (seen.has(identity)) {
        const cached = seen.get(identity);
        observations.push(cached.observation);
        trace.push({ step: step.id, state: 'repeated-call', question: step.question, input: bound,
          evidence: cached.evidence, binding });
        continue;
      }
      if (calls >= program.budgets.calls) return finish('call-budget', index, bindings.length - position);
      calls++;
      let observation;
      try {
        observation = await drive(step.question, bound);
      } catch (error) {
        observation = { status: 'error', error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        } };
      }
      apiCalls = apiCalls !== null && Number.isInteger(observation.apiCallCount)
        ? apiCalls + observation.apiCallCount : null;
      observations.push(observation);
      evidence.push({ step: step.id, question: step.question, input: bound, binding, observation });
      seen.set(identity, { observation, evidence: evidence.length - 1 });
      trace.push({ step: step.id, question: step.question, input: bound, binding,
        state: summarize([observation]).state, evidence: evidence.length - 1 });
      if (observation.status === 'answered') {
        const bytes = Buffer.byteLength(observation.answer);
        if (answerBytes + bytes > program.budgets.answerBytes) {
          omittedAnswerBytes += bytes;
        } else {
          answerBytes += bytes;
          answers.push({ step: step.id, evidence: evidence.length - 1, answer: observation.answer });
        }
      }
      if (elapsed() >= program.budgets.milliseconds) return finish('soft-time-budget', position + 1 < bindings.length ? index : index + 1, bindings.length - position - 1);
    }
    results.set(step.id, summarize(observations, parent));
  }
  return finish('program-ended');
}
