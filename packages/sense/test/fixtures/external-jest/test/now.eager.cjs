// Requires its module at the top, as an eager import does: Jest transforms it
// while the file loads, before any case, so a warm-up gains nothing from it.
const { appendFileSync } = require('node:fs');
const { now } = require('../src/now');

it('uses the module it required at the top', () => {
  appendFileSync(process.env.FIXTURE_TRANSFORM_LOG, `${process.pid} begin\n`);
  expect(now('a')).toBe('a!');
  appendFileSync(process.env.FIXTURE_TRANSFORM_LOG, `${process.pid} end\n`);
});
