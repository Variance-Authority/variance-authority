import { digestString } from '@variance-authority/core/format';
import { checkoutPath } from '@variance-authority/sense';
import { closeSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { executeProgram } from './execute.mjs';
import { candidateCatalog } from './catalog.mjs';
import { openQuestions } from './questions.mjs';

/** Execute supplied research inputs and exclusively publish their receipt. */
export async function runExperiment(args) {
  const startedAt = performance.now();
  if (args.length !== 4) throw new Error('usage: node tools/orientation-runbook/run.mjs <root> <program.yaml> <request.yaml> <new-receipt.yaml>');
  const [suppliedRoot, programFile, requestFile, receiptFile] = args;
  const root = realpathSync(suppliedRoot);
  const output = resolve(realpathSync(dirname(resolve(receiptFile))), basename(receiptFile));
  if (!('outside' in checkoutPath(root, output))) {
    throw new Error('write the research receipt outside the queried checkout');
  }
  const receipt = openSync(output, 'wx');
  try {
    const programText = readFileSync(programFile, 'utf8');
    const requestText = readFileSync(requestFile, 'utf8');
    const context = await openQuestions(root);
    const result = await executeProgram(parse(programText), {
      ...context, request: parse(requestText), startedAt,
      provenance: { ...context.provenance, root,
        programBytesHash: digestString(programText), requestBytesHash: digestString(requestText),
      },
    });
    writeFileSync(receipt, stringify(result));
    const { halt, completion, calls, apiCalls, elapsedMs, answers, omittedAnswerBytes,
      omittedSteps, omittedBindings } = result;
    return { summary: { receipt: output, halt, completion, calls, apiCalls, elapsedMs,
      answers, omittedAnswerBytes, omittedSteps, omittedBindings,
      candidateCatalog: candidateCatalog(result.evidence, result.budgets.answerBytes) },
      exitCode: halt === 'binding-error' ? 2 : 0 };
  } catch (error) {
    writeFileSync(receipt, stringify({ status: 'failed',
      error: { name: error.name, message: error.message }, elapsedMs: performance.now() - startedAt }));
    throw error;
  } finally {
    closeSync(receipt);
  }
}
