const { read } = require('../src/shared');
test('reads the value its environment required', () => {
  expect(global.environmentValue).toBe(process.env.FIXTURE_ENVIRONMENT_VALUE);
  expect(read('case')).toBe('test');
});
