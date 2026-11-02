test('runs in the configured environment', () => {
  expect(global.environmentValue).toBeUndefined();
  expect(global.projectRuntime).toBe(process.env.FIXTURE_PROJECT_RUNTIME === undefined ? undefined : true);
});
