import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const { label } = createRequire(import.meta.url)('../src/label.cjs');

// `skip`, `only` and `todo` are members of what the module exports, so they stay callable.
describe.skip('skipped block', () => {
  it('never runs', () => assert.fail('a skipped block ran'));
});
describe('modifiers', () => {
  it.skip('is skipped', () => assert.fail('a skipped case ran'));
  it.todo('is a todo');
  it.only('runs under only', () => {
    assert.strictEqual(label('A'), 'took A');
  });
});
