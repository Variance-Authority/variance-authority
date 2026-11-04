import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { driverInstalled, registerResetHandler, registerTestScope } from './index.js';
import { configureResetHandler } from './setup.js';

const REALM = Symbol.for('@variance-authority/ioc/reset');

/**
 * The registry is realm state, so these tests share one with each other, and
 * the realm's own registry is put back when the file ends: a worker that keeps
 * its realm across files hands the next one the registry its setup configured,
 * not one holding the handlers these tests register.
 */
const realm = (globalThis as Record<symbol, unknown>)[REALM];
beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[REALM];
});
afterAll(() => {
  (globalThis as Record<symbol, unknown>)[REALM] = realm;
});

/** A registrar that records the driver instead of installing it in a runner. */
const capture = () => {
  const installed: Array<() => void> = [];
  return { each: (run: () => void) => installed.push(run), run: () => installed.forEach((f) => f()) };
};

describe('registerResetHandler', () => {
  it('registers nothing until a driver is installed', () => {
    let counter = 0;
    registerResetHandler(() => {
      counter = 0;
    });

    const driver = capture();
    counter = 5;
    // Nothing installed the handler, so nothing can run it. This is the shipped
    // application's path, and the assertion is that it costs nothing.
    expect(() => driver.run()).not.toThrow();
    expect(counter).toBe(5);
  });

  it('returns an undo that is safe to call when nothing was registered', () => {
    expect(() => registerResetHandler(() => {})()).not.toThrow();
  });

  it('runs a handler each time the driver fires', () => {
    const driver = capture();
    configureResetHandler(driver.each, () => {});

    let counter = 0;
    registerResetHandler(() => {
      counter = 0;
    });

    counter = 3;
    driver.run();
    expect(counter).toBe(0);

    counter = 7;
    driver.run();
    expect(counter).toBe(0);
  });

  it('picks up a handler registered after the driver, as a late import would', () => {
    const driver = capture();
    configureResetHandler(driver.each, () => {});

    // The driver was installed before this module existed; the set is read at
    // reset time, so the seventh test file's imports still reset.
    let late = 9;
    registerResetHandler(() => {
      late = 0;
    });

    driver.run();
    expect(late).toBe(0);
  });

  it('stops running a handler that has been unregistered', () => {
    const driver = capture();
    configureResetHandler(driver.each, () => {});

    let counter = 4;
    const undo = registerResetHandler(() => {
      counter = 0;
    });

    undo();
    driver.run();
    expect(counter).toBe(4);
  });
});

describe('configureResetHandler', () => {
  it('refuses a setup that runs after a module has already registered', () => {
    registerResetHandler(function resetTheCounter() {
      // registered by a module imported before the setup file
    });

    expect(() => configureResetHandler(capture().each, () => {})).toThrow(/registered before this setup ran/);
  });

  it('names the first early handler and counts the rest', () => {
    registerResetHandler(function resetTheCounter() {});
    registerResetHandler(() => {});

    expect(() => configureResetHandler(capture().each, () => {})).toThrow(/resetTheCounter/);
    expect(() => configureResetHandler(capture().each, () => {})).toThrow(/^.*2 handler\(s\)/s);
  });

  it('keeps the realm state where a module registry reset cannot reach it', () => {
    configureResetHandler(capture().each, () => {});
    expect((globalThis as Record<symbol, unknown>)[REALM]).toBeDefined();
  });

  it('runs every handler even when one throws, and reports the failure', () => {
    const driver = capture();
    configureResetHandler(driver.each, () => {});

    let after = 6;
    registerResetHandler(() => {
      throw new Error('a broken reset');
    });
    registerResetHandler(() => {
      after = 0;
    });

    expect(() => driver.run()).toThrow('a broken reset');
    // The handler behind the failure still ran: skipping it would leave the
    // order-dependent state this package exists to clear.
    expect(after).toBe(0);
  });

  it('reports several failures together', () => {
    const driver = capture();
    configureResetHandler(driver.each, () => {});

    registerResetHandler(() => {
      throw new Error('first');
    });
    registerResetHandler(() => {
      throw new Error('second');
    });

    expect(() => driver.run()).toThrow(AggregateError);
  });

  it('honours a second driver rather than guessing which one is a duplicate', () => {
    const first = capture();
    const second = capture();
    configureResetHandler(first.each, () => {});
    configureResetHandler(second.each, () => {});

    let runs = 0;
    registerResetHandler(() => {
      runs += 1;
    });

    first.run();
    second.run();
    // Twice, which is why a handler has to be idempotent: the alternative is
    // guessing that the second call is a duplicate, and dropping every reset
    // for a test file whose setup legitimately ran again.
    expect(runs).toBe(2);
  });
});

describe('registerTestScope', () => {
  /** A scope that writes down what the driver told it, in order. */
  const recording = (heard: string[], name = '') => ({
    enterFile: () => heard.push(`${name}file`),
    enterTest: () => heard.push(`${name}test`),
    leaveTest: () => heard.push(`${name}tested`),
  });

  it('enters a file when the driver installs, each test before its handlers, and leaves it after', () => {
    const heard: string[] = [];
    const before = capture();
    const after = capture();
    configureResetHandler(before.each, () => {});
    registerTestScope(recording(heard));
    registerResetHandler(() => heard.push('handler'));
    configureResetHandler(before.each, after.each);

    before.run();
    after.run();
    // The first driver was installed before the scope existed, so only the
    // second one entered a file; both entered the test.
    expect(heard).toEqual(['file', 'test', 'handler', 'test', 'handler', 'tested']);
  });

  it('refuses the driver after a scope registered early, as a handler is refused', () => {
    registerTestScope(recording([]));
    expect(() => configureResetHandler(capture().each, () => {})).toThrow('1 handler(s) registered before this setup ran');
  });

  it('takes no driver without the hook that ends a test', () => {
    // A driver that never heard a test end would leave a nested `describe`'s `beforeAll` writing into the test before it.
    // @ts-expect-error the runner's `afterEach` is required
    expect(() => configureResetHandler(capture().each)).toThrow(TypeError);
  });

  it('tells a scope registering whether a driver is installed, since none tells it the file it joined has started', () => {
    expect(driverInstalled()).toBe(false);
    configureResetHandler(capture().each, () => {});
    expect(driverInstalled()).toBe(true);
  });

  it('stops entering a scope once it is unregistered', () => {
    const heard: string[] = [];
    const driver = capture();
    configureResetHandler(driver.each, () => {});
    registerTestScope(recording(heard))();
    driver.run();
    expect(heard).toEqual([]);
  });
});
