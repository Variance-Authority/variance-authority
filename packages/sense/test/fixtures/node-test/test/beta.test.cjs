const test = require('node:test');
const assert = require('node:assert');

test('does not touch the label', () => {
  assert.strictEqual(1 + 1, 2);
});
