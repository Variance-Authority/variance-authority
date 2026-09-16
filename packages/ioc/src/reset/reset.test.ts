import { describe, expect, it, beforeEach } from 'vitest';
import { registerResetHandler } from './index.js';
import { configureResetHandler } from './setup.js';

const REALM = Symbol.for('@variance-authority/ioc/reset');

/**
 * The registry is realm state, so these tests share one with each other.
 *
 * A runner gives each test file its own realm and never asks for a second, so
 * this is the one thing here that is not a fair model of a real suite.
 */
beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[REALM];
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
    configureResetHandler(driver.each);

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
    configureResetHandler(driver.each);

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
    configureResetHandler(driver.each);

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

    expect(() => configureResetHandler(capture().each)).toThrow(/registered before this setup ran/);
  });

  it('names the first early handler and counts the rest', () => {
    registerResetHandler(function resetTheCounter() {});
    registerResetHandler(() => {});

    expect(() => configureResetHandler(capture().each)).toThrow(/resetTheCounter/);
    expect(() => configureResetHandler(capture().each)).toThrow(/^.*2 handler\(s\)/s);
  });

  it('keeps the realm state where a module registry reset cannot reach it', () => {
    configureResetHandler(capture().each);
    expect((globalThis as Record<symbol, unknown>)[REALM]).toBeDefined();
  });

  it('runs every handler even when one throws, and reports the failure', () => {
    const driver = capture();
    configureResetHandler(driver.each);

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
    configureResetHandler(driver.each);

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
    configureResetHandler(first.each);
    configureResetHandler(second.each);

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
