import { digestString } from '@variance-authority/core/format';
import { closeSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';
import { executeProgram } from './execute.mjs';
import { openQuestions } from './questions.mjs';

const startedAt = performance.now();
const args = process.argv.slice(2);
if (args.length !== 5) throw new Error('usage: node tools/orientation-runbook/run.mjs <root> <program.yaml> <request.yaml> <new-receipt.yaml> <build-id>');
const [suppliedRoot, programFile, requestFile, receiptFile, buildDeclared] = args;
const root = realpathSync(suppliedRoot);
const output = resolve(realpathSync(dirname(resolve(receiptFile))), basename(receiptFile));
const inside = relative(root, output);
if (inside === '' || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) {
  throw new Error('write the research receipt outside the queried checkout');
}
// Reserve before any questions run; an existing receipt is never overwritten.
const receipt = openSync(output, 'wx');
try {
  const programText = readFileSync(programFile, 'utf8');
  const requestText = readFileSync(requestFile, 'utf8');
  const context = await openQuestions(root);
  const result = await executeProgram(parse(programText), {
    ...context, request: parse(requestText), startedAt,
    provenance: { ...context.provenance, root, buildDeclared,
      programBytesHash: digestString(programText),
      requestBytesHash: digestString(requestText),
    },
  });
  writeFileSync(receipt, stringify(result));
  // Full canonical answers and membership remain in the receipt. Only the
  // answer text in this summary is charged to the program's answerBytes budget.
  const { halt, completion, calls, apiCalls, elapsedMs, answers, omittedAnswerBytes,
    omittedSteps, omittedBindings } = result;
  console.log(stringify({ receipt: output, halt, completion, calls, apiCalls, elapsedMs,
    answers, omittedAnswerBytes, omittedSteps, omittedBindings }));
  if (['binding-error', 'invalid-input'].includes(halt)) process.exitCode = 2;
} catch (error) {
  writeFileSync(receipt, stringify({ status: 'failed', buildDeclared,
    error: { name: error.name, message: error.message }, elapsedMs: performance.now() - startedAt }));
  throw error;
} finally {
  closeSync(receipt);
}
