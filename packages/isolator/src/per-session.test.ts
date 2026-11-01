import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { isolateEnv, isolateGlobals } from './globals.js';
import { perSession } from './per-session.js';
import { endLoad, realm, startLoad, switchTo, testSession } from './realm.js';
import { nextSession } from './session.js';

const REALM = Symbol.for('@variance-authority/isolator');

/** A realm of the test's own, so a suite that runs this file through the isolator keeps its sessions. */
beforeEach(() => {
  const host = globalThis as Record<symbol, unknown>;
  const kept = host[REALM];
  delete host[REALM];
  onTestFinished(() => {
    host[REALM] = kept;
  });
  nextSession();
});

/** Enter a test of the current file, as ioc's driver does; the returned function leaves it. */
const enterTest = (): (() => void) => {
  const session = testSession();
  switchTo(session, undefined);
  return () => switchTo(realm().file, session);
};

/** Run `body` as a rewritten module's top level runs. */
const loading = (body: () => void) => {
  startLoad();
  try {
    body();
  } finally {
    endLoad();
  }
};

describe('perSession', () => {
  it('gives each test its own writes, starting from what its file wrote', () => {
    const registry = perSession<Record<string, unknown>>({ base: 1 });
    registry.file = 'set';
    const leave = enterTest();
    expect(registry.file).toBe('set');
    registry.test = 'mine';
    delete registry.base;
    expect(Object.keys(registry)).toEqual(['file', 'test']);
    leave();
    expect(registry).toEqual({ base: 1, file: 'set' });
    expect('test' in registry).toBe(false);
  });

  it('starts each file from the object, and leaves the object as it was', () => {
    const object: Record<string, unknown> = { base: 1 };
    const registry = perSession(object);
    registry.base = 2;
    nextSession();
    expect(registry.base).toBe(1);
    expect(object).toEqual({ base: 1 });
  });

  it('keeps what a module writes as it loads, in every session alive and every one to come', () => {
    const object: Record<string, unknown> = {};
    const registry = perSession(object);
    registry.file = true;
    const leave = enterTest();
    loading(() => {
      registry.loaded = { count: 1 };
    });
    expect(registry.loaded).toEqual({ count: 1 });
    leave();
    expect(registry).toEqual({ file: true, loaded: { count: 1 } });
    nextSession();
    expect(registry).toEqual({ loaded: { count: 1 } });
    expect(object.loaded).toEqual({ count: 1 });
  });

  it('stores a value as the object would store it', () => {
    const registry = perSession<Record<string, unknown>>({}, { store: String });
    registry.port = 3000;
    expect(registry.port).toBe('3000');
  });
});

describe('isolateEnv', () => {
  afterEach(() => {
    delete process.env.VA_ISOLATED;
  });

  it('drops what a test sets in process.env as the test ends, and keeps what its file set', () => {
    const undo = isolateEnv();
    onTestFinished(undo);
    process.env.VA_ISOLATED = 'file';
    const leave = enterTest();
    process.env.VA_ISOLATED = 'test';
    process.env.VA_TEST_ONLY = '1';
    leave();
    expect(process.env.VA_ISOLATED).toBe('file');
    expect(process.env.VA_TEST_ONLY).toBeUndefined();
    nextSession();
    expect(process.env.VA_ISOLATED).toBeUndefined();
  });

  it('writes TZ through to the environment Node reads, and puts it back as the test ends', () => {
    const before = process.env.TZ;
    onTestFinished(() => {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    });
    const undo = isolateEnv();
    onTestFinished(undo);
    const leave = enterTest();
    process.env.TZ = 'Asia/Tokyo';
    expect(new Date(0).getTimezoneOffset()).toBe(-540);
    leave();
    expect(process.env.TZ).toBe(before);
    process.env.TZ = 'UTC';
    expect(new Date(0).getTimezoneOffset()).toBe(0);
  });

  it('puts the environment object back when undone', () => {
    const real = process.env;
    isolateEnv()();
    expect(process.env).toBe(real);
  });
});

describe('isolateGlobals', () => {
  it('removes what a test adds and puts back what it replaced, as the test ends', () => {
    const target: Record<string, unknown> = { kept: 1 };
    onTestFinished(isolateGlobals(target));
    target.file = 'set';
    const leave = enterTest();
    target.added = true;
    target.kept = 2;
    delete target.file;
    leave();
    expect(target).toEqual({ kept: 1, file: 'set' });
    nextSession();
    expect(target).toEqual({ kept: 1 });
  });

  it('keeps what a module adds as it loads', () => {
    const target: Record<string, unknown> = {};
    onTestFinished(isolateGlobals(target));
    const leave = enterTest();
    loading(() => {
      target.polyfill = 'loaded';
    });
    leave();
    nextSession();
    expect(target).toEqual({ polyfill: 'loaded' });
  });

  it('leaves a property that cannot be configured', () => {
    const target: Record<string, unknown> = {};
    onTestFinished(isolateGlobals(target));
    const leave = enterTest();
    Object.defineProperty(target, 'fixed', { value: 1, enumerable: true });
    leave();
    expect(target.fixed).toBe(1);
  });

  it('stops when undone', () => {
    const target: Record<string, unknown> = {};
    isolateGlobals(target)();
    const leave = enterTest();
    target.added = true;
    leave();
    expect(target.added).toBe(true);
  });
});
