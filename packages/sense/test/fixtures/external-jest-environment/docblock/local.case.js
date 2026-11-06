/**
 * @jest-environment <rootDir>/environment.ts
 */
test('runs in the environment its docblock names', () => {
  expect(global.environmentValue).toBe('host');
  expect(global.projectRuntime).toBe(process.env.FIXTURE_PROJECT_RUNTIME === undefined ? undefined : true);
});
