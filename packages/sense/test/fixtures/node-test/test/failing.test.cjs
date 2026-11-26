const { it } = require('node:test');
const assert = require('node:assert');
const { label } = require('../src/label.cjs');

it('fails after reaching the label', () => {
  assert.strictEqual(label('A'), 'not what it returns');
});
