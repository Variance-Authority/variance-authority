const globals = globalThis as unknown as { bus: EventTarget; heard: string[]; fromSetup: string; leftover?: string };
let ticks = 0;

test('leaves an interval, a listener, a global and an environment variable behind', () => {
  setInterval(() => void ticks++, 1);
  globals.bus.addEventListener('ping', () => globals.heard.push('test'));
  globals.leftover = 'left';
  process.env.VA_LEFTOVER = 'left';
  globals.fromSetup = 'overwritten';
  process.env.VA_FROM_SETUP = 'overwritten';
});

test('finds none of them, and what setup left as setup left it', async () => {
  const counted = ticks;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(ticks).toBe(counted);
  globals.heard.length = 0;
  globals.bus.dispatchEvent(new Event('ping'));
  expect(globals.heard).toEqual(['setup']);
  expect(globals.leftover).toBeUndefined();
  expect(process.env.VA_LEFTOVER).toBeUndefined();
  expect(globals.fromSetup).toBe('kept');
  expect(process.env.VA_FROM_SETUP).toBe('kept');
});
