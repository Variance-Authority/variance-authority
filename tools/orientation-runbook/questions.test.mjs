import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { FoundNothing } from '@variance-authority/help';
import { parse, stringify } from 'yaml';
import { createQuestionDriver, openQuestions } from './questions.mjs';
import { executeProgram } from './execute.mjs';

test('canonical answers survive unavailable membership and report the separate API failure', async () => {
  const tool = { inputSchema: { type: 'object', additionalProperties: false },
    run: () => 'the canonical answer', files: () => { throw new Error('no membership'); } };
  const driver = createQuestionDriver({ resolve: () => tool, help: {}, invocation: {} });
  const result = await driver.drive('fixture', {});
  assert.equal(result.status, 'answered');
  assert.equal(result.answer, 'the canonical answer');
  assert.equal(result.membershipStatus, 'unknown');
  assert.equal(result.files, undefined);
  assert.equal(result.apiCallCount, 2);
  assert.match(result.membershipError.message, /no membership/u);
  assert.throws(() => driver.validate('fixture', { invented: true }), /input/u);
});

test('a factual not-found answer remains answered without inferring complete membership', async () => {
  const tool = { inputSchema: { type: 'object' },
    run: () => { throw new FoundNothing('not declared in the available evidence'); },
    files: () => { throw new FoundNothing('not declared in the available evidence'); } };
  const driver = createQuestionDriver({ resolve: () => tool, help: {}, invocation: {} });
  const result = await driver.drive('fixture', {});
  assert.equal(result.status, 'answered');
  assert.equal(result.membershipStatus, 'unknown');
  assert.match(result.answer, /not declared/u);
});

test('published-index execution follows component, example and mock relations on distinct branches', async () => {
  const root = mkdtempSync(join(tmpdir(), 'runbook-index-'));
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
    assert.throws(() => context.validate('summary', {}), /membership/u);
    assert.throws(() => context.validate('discover', { to: 'not-an-array' }), /input/u);
    const programFile = join(artifacts, 'program.yaml');
    const requestFile = join(artifacts, 'request.yaml');
    const receiptFile = join(artifacts, 'receipt.yaml');
    writeFileSync(programFile, readFileSync('tools/orientation-runbook/example.yaml', 'utf8'));
    writeFileSync(requestFile, stringify({ name: 'Panel' }));
    // A fresh process must use the published snapshot even when the live source
    // has gone. Neither the caller nor this runner rebuilds the fixture here.
    rmSync(join(root, 'src'), { recursive: true });
    const command = [resolve('tools/orientation-runbook/run.mjs'), root, programFile,
      requestFile, receiptFile, 'fixture-build'];
    execFileSync(process.execPath, command, { stdio: 'pipe' });
    const receipt = parse(readFileSync(receiptFile, 'utf8'));
    assert.equal(receipt.provenance.generation, context.provenance.generation);
    assert.equal(receipt.provenance.buildDeclared, 'fixture-build');
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
