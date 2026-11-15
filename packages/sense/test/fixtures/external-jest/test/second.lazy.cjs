// The second file, so the run has two to hand to two workers.
const { appendFileSync } = require('node:fs');

it('requires its module where it uses it', () => {
  appendFileSync(process.env.FIXTURE_TRANSFORM_LOG, `${process.pid} begin\n`);
  expect(require('../src/sooner').sooner('ab')).toBe(2);
  appendFileSync(process.env.FIXTURE_TRANSFORM_LOG, `${process.pid} end\n`);
});
