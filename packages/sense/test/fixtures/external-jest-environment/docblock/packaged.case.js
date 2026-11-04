/**
 * @jest-environment <rootDir>/packaged-environment.cjs
 */
test('runs in the environment its docblock names, whose input an installed package loaded', () => {
  expect(global.environmentValue).toBe('packaged');
  expect(global.projectRuntime).toBe(process.env.FIXTURE_PROJECT_RUNTIME === undefined ? undefined : true);
});
