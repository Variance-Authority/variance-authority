// The project's own setup file, which withTestSelection must leave in place.
globalThis.__FIXTURE_SETUP__ = 'composed';

const globals = require('@jest/globals');

// A project that freezes the test's clock before any case runs, as
// `jest.useFakeTimers({ now })` does, and only the clock.
globals.jest.useFakeTimers({
  now: 0,
  doNotFake: [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval',
    'clearInterval', 'setTimeout', 'clearTimeout',
  ],
});

// A hook of the project's that takes its time, as starting a server would: it
// runs with the cases, so its time is theirs, not the file's loading.
globals.beforeAll(() => {
  const until = performance.now() + 150;
  while (performance.now() < until);
});
