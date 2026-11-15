// Requires its module inside the test body, as a module compiled with SWC's
// `module.lazy` does on first use: Jest transforms it there, in the worker.
const { appendFileSync } = require('node:fs');

it('requires its module where it uses it', () => {
  appendFileSync(process.env.FIXTURE_TRANSFORM_LOG, `${process.pid} begin\n`);
  expect(require('../src/later').later('a')).toBe('A');
  appendFileSync(process.env.FIXTURE_TRANSFORM_LOG, `${process.pid} end\n`);
});
