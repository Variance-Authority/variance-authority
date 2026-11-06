// The reset driver goes first: a module imported before it would register too early.
const { configureResetHandler } = require('@variance-authority/ioc/reset/setup');

configureResetHandler(beforeEach, afterEach);

const { isolateConcurrentTests } = require('@variance-authority/isolator/node');

isolateConcurrentTests(test);

const { isolateEnv, isolateGlobals, isolateListeners, isolateTimers } = require('@variance-authority/isolator');

isolateTimers();
isolateListeners();
isolateGlobals();
isolateEnv();

// What setup leaves runs before any test, so every test of every file finds it.
globalThis.fromSetup = 'kept';
process.env.VA_FROM_SETUP = 'kept';
globalThis.bus = new EventTarget();
globalThis.heard = [];
globalThis.bus.addEventListener('ping', () => globalThis.heard.push('setup'));
