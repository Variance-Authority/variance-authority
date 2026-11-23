import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'vitest';
import { parse, stringify } from 'yaml';
import { openQuestions } from './questions.mjs';
import { executeProgram } from './execute.mjs';

test('published-index execution follows component, example and mock relations on distinct branches', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'runbook-index-')));
  const artifacts = mkdtempSync(join(tmpdir(), 'runbook-receipt-'));
  const cli = resolve('packages/cli/dist/bin.js');
  const write = (file, source) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  };
  try {
    write('package.json', '{"name":"runbook-fixture","private":true}');
    write('src/Panel.ts', 'export function Panel() { return "panel"; }');
    write('src/Panel.examples.ts', "import { Panel } from './Panel';\nimport { mockState } from './state.mock';\nexport const example = () => [Panel(), mockState];");
    write('src/state.mock.ts', 'export const mockState = { enabled: true };');
    execFileSync('git', ['init', '--quiet', root]);
    execFileSync(process.execPath, [cli, 'index', '--wait'], { cwd: root, stdio: 'pipe' });
    const context = await openQuestions(root);
    const step = (id, question, input, extra = {}) => ({ id, question, input, ...extra });
    const run = async name => executeProgram({ version: 1,
      budgets: { calls: 8, milliseconds: 30000, answerBytes: 50000 },
      steps: [
        step('seed', 'discover', {}, { request: { declares: 'name' } }),
        step('fallback', 'symbol', { name: 'Panel' }, { when: { step: 'seed', is: 'empty' } }),
        step('examples', 'discover', { path: 'examples' }, {
          fromFiles: { step: name === 'Panel' ? 'seed' : 'fallback', input: 'to' },
        }),
        step('mocks', 'discover', { path: 'mock' }, { fromFiles: { step: 'examples', input: 'from' } }),
      ],
    }, { ...context, request: { name }, provenance: { ...context.provenance, build: 'fixture' } });
    const direct = await run('Panel');
    const fallback = await run('AbsentPanel');
    for (const result of [direct, fallback]) {
      assert.equal(result.halt, 'program-ended');
      const last = result.evidence.at(-1);
      assert.equal(last.step, 'mocks', JSON.stringify(result));
      assert.deepEqual(last.observation.files.map(row => row.file), ['src/state.mock.ts']);
      assert.match(last.observation.answer, /src\/state.mock.ts/u);
      assert.equal(last.binding.file, 'src/Panel.examples.ts');
      assert.ok(result.provenance.generation);
    }
    assert.equal(direct.trace.find(row => row.step === 'fallback').state, 'condition-skipped');
    assert.equal(fallback.trace.find(row => row.step === 'fallback').state, 'nonempty');
    assert.equal(direct.calls, 3);
    assert.equal(fallback.calls, 4);
    assert.equal(context.validate, undefined, 'tool input is judged by the canonical reader');
    for (const [question, input, flags] of [
      ['orient', { files: ['src/Panel.ts'] }, ['--files', 'src/Panel.ts']],
      ['classify', { query: 'Panel' }, ['--query', 'Panel']],
    ]) {
      const expected = execFileSync(process.execPath, [cli, 'ask', question, ...flags], { cwd: root, encoding: 'utf8' });
      const factual = await context.drive(question, input);
      assert.equal(factual.answer, expected);
      assert.equal(factual.status, 'answered');
      assert.equal(factual.membershipStatus, 'unknown');
      assert.equal(factual.files, undefined);
      assert.equal(factual.membershipError, undefined);
      assert.equal(factual.apiCallCount, 1);
      assert.deepEqual(factual.apiCalls.map(call => call.api), ['Tool.run']);
    }
    const factualBranches = await executeProgram({ version: 1,
      budgets: { calls: 4, milliseconds: 30000, answerBytes: 50000 },
      steps: [
        step('factual', 'orient', { files: ['src/Panel.ts'] }),
        step('fanout', 'discover', {}, { fromFiles: { step: 'factual', input: 'from' } }),
        step('wrong', 'symbol', { name: 'Panel' }, { when: { step: 'fanout', is: 'empty' } }),
        step('recover', 'classify', { query: 'Panel' }, { when: { step: 'fanout', is: 'unknown' } }),
      ],
    }, { ...context, request: {} });
    assert.equal(factualBranches.calls, 2);
    assert.equal(factualBranches.apiCalls, 2);
    assert.deepEqual(factualBranches.evidence.map(row => row.step), ['factual', 'recover']);
    assert.equal(factualBranches.trace.find(row => row.step === 'fanout').state, 'no-observed-files');
    assert.equal(factualBranches.trace.find(row => row.step === 'wrong').state, 'condition-skipped');
    assert.equal(factualBranches.trace.find(row => row.step === 'recover').state, 'unknown');
    assert.equal(factualBranches.completion, 'unproved');
    const factualRefusal = await context.drive('classify', {});
    assert.equal(factualRefusal.status, 'error');
    assert.match(factualRefusal.error.message, /query/u);
    assert.equal(factualRefusal.membershipStatus, 'unknown');
    assert.deepEqual(factualRefusal.apiCalls.map(call => call.api), ['Tool.run']);
    const canonical = execFileSync(process.execPath, [cli, 'ask', 'symbol', '--name', 'Panel'], { cwd: root, encoding: 'utf8' });
    assert.equal((await context.drive('symbol', { name: 'Panel' })).answer, canonical);
    for (const [question, input, flags] of [
      ['discover', { declares: 'Panel' }, ['--declares', 'Panel']],
      ['search', { query: 'Panel' }, ['--query', 'Panel']],
    ]) {
      const expected = execFileSync(process.execPath, [cli, 'ask', question, ...flags], { cwd: root, encoding: 'utf8' });
      assert.equal((await context.drive(question, input)).answer, expected);
    }
    write('src/Panel.ts', 'export function Panel() { return "liveOnly"; }');
    const live = await context.drive('grep', { query: 'liveOnly', from: ['src/Panel.ts'] });
    assert.equal(live.membershipStatus, 'complete');
    assert.deepEqual(live.files.map(row => row.file), ['src/Panel.ts']);
    assert.match(context.provenance.sourceText, /live checkout/u);
    const missing = await context.drive('symbol', { name: 'AbsentPanel' });
    assert.equal(missing.status, 'answered');
    assert.equal(missing.membershipStatus, 'unknown');
    assert.equal(missing.files, undefined);
    const refused = await context.drive('grep', {});
    assert.equal(refused.status, 'error');
    assert.match(refused.error.message, /query/u);
    const programFile = join(artifacts, 'program.yaml');
    const requestFile = join(artifacts, 'request.yaml');
    const receiptFile = join(artifacts, 'receipt.yaml');
    writeFileSync(programFile, readFileSync('tools/orientation-runbook/example.yaml', 'utf8'));
    writeFileSync(requestFile, stringify({ name: 'Panel' }));
    // A fresh process must use the published snapshot even when the live source
    // has gone. Neither the caller nor this runner rebuilds the fixture here.
    rmSync(join(root, 'src'), { recursive: true });
    const command = [resolve('tools/orientation-runbook/run.mjs'), root, programFile,
      requestFile, receiptFile];
    const summary = parse(execFileSync(process.execPath, command, { encoding: 'utf8' }));
    assert.ok(summary.candidateCatalog.payload.files.some(row => row.file === 'src/Panel.ts'));
    assert.equal(summary.candidateCatalog.payloadBytes,
      Buffer.byteLength(stringify(summary.candidateCatalog.payload)));
    const receipt = parse(readFileSync(receiptFile, 'utf8'));
    assert.equal(receipt.provenance.generation, context.provenance.generation);
    assert.ok(receipt.evidence[0].observation.files.some(row => row.file === 'src/Panel.ts'));
    assert.equal(receipt.evidence.at(-1).step, 'mocks');
    assert.throws(() => execFileSync(process.execPath, command, { stdio: 'pipe' }), /Command failed/u);
    const insideReceipt = join(root, 'forbidden-receipt.yaml');
    const insideCommand = [...command];
    insideCommand[4] = insideReceipt;
    assert.throws(() => execFileSync(process.execPath, insideCommand, { stdio: 'pipe' }),
      error => /outside the queried checkout/u.test(error.stderr.toString()));
    assert.equal(existsSync(insideReceipt), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  }
});
