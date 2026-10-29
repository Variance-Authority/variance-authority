it('loads a module by a name it computes', async () => {
  const name = ['math'].join('');
  const math = (await import(`../src/${name}`)) as typeof import('../src/math');
  expect(math.add(1, 2)).toBe(3);
});
