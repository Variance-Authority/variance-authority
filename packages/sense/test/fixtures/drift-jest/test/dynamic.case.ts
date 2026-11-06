// `FIXTURE_COMPUTED=off` skips the load, so a run with it off is the baseline
// one with it on grows from.
it('loads a module by a name it computes', async () => {
  if (process.env['FIXTURE_COMPUTED'] === 'off') return;
  const name = ['math'].join('');
  const math = (await import(`../src/${name}`)) as typeof import('../src/math');
  expect(math.add(1, 2)).toBe(3);
});
