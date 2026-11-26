import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const { label } = createRequire(import.meta.url)('../src/label.cjs');

describe('label', () => {
  it('takes the alpha path', () => {
    assert.strictEqual(label('A'), 'took A');
  });
});
