/**
 * The `globalThis.__VA__` factory, in place before anything else runs in a test
 * file's sandbox.
 *
 * Named first in `setupFiles` by `withTestSelection`, ahead of the project's
 * own. A setup file that loads an instrumented module — a polyfill that pulls
 * in `src/`, a store seeded for every test — evaluates a header that resolves
 * this factory, and a factory installed after it is a `TypeError` in every
 * file. `setupFilesAfterEnv` is too late for that, and `@jest/globals` is not
 * available this early, which is why the journal writer in `jest-setup.cts` is
 * a second file. CommonJS on purpose: a file under `node_modules` is not
 * transformed, so an ES `import` here would be a syntax error in every project
 * that did not opt into ES modules.
 *
 * Installed once and kept. A module the registry drops and evaluates again —
 * `jest.resetModules`, `jest.isolateModules` — resolves the factory again, and
 * what it counted the first time is this file's still: fresh counters would
 * replace them with zeros and the test that entered a region before the reset
 * would be read as never having entered it. Under the same name and the same
 * block count it is the same module, and the counters carry on; a different
 * count is a different text. This file evaluated again keeps the factory that
 * is already there for the same reason.
 */

type Factory = ((file: string, count: number) => Uint32Array) & {
  readonly modules: ReadonlyMap<string, Uint32Array>;
};

function install(): Factory {
  const holder = globalThis as { __VA__?: Factory };
  if (holder.__VA__ !== undefined) return holder.__VA__;
  const modules = new Map<string, Uint32Array>();
  const factory = Object.assign(
    (file: string, count: number): Uint32Array => {
      let counters = modules.get(file);
      if (counters === undefined || counters.length !== count) {
        counters = new Uint32Array(count);
        modules.set(file, counters);
      }
      return counters;
    },
    { modules },
  );
  holder.__VA__ = factory;
  return factory;
}

install();

export = install;
