/**
 * Where a `variancePrecondition` call stands, for a runner whose hooks and
 * describes are reached only through the API that registered them, as source.
 *
 * Rstest announces no hook and hands no runner class to replace — the reasons
 * [`caseGlobalsSource`](./worker-source.ts) wraps its case registrars — so the
 * describe and hook registrars are wrapped beside them. Each one captures, at
 * registration, the describe path it was registered under: a describe's
 * callback runs with its own path current, whenever the runner chooses to call
 * it, so a nested describe or a hook registered inside it knows its scope
 * whether the runner collects eagerly or queues the callback for later.
 *
 * A hook runs inside the case scope's `within`: a `beforeAll` reaches every
 * case of its describe, a `beforeEach` the next case entered, which is the case
 * it runs for in a runner that runs one case's hooks at a time, and an
 * `afterEach` or `afterAll` reaches none. A describe callback is the scope of
 * its describe for as long as it runs.
 *
 * @param separator How the runner joins a describe path into the case name it
 * reports, which is what a scope's prefix is matched against.
 * @param holders Source for the objects that hold the registrars, as
 * `caseGlobalsSource` takes them.
 */
export function scopeGlobalsSource(separator: string, holders: string): string {
  return `
const scopePath = [];
const scopeAt = (path) => ({
  kind: 'scope',
  depth: path.length,
  prefix: path.length === 0 ? '' : path.join(${JSON.stringify(separator)}) + ${JSON.stringify(separator)},
});
const hookAt = (kind, path) =>
  kind === 'beforeAll' ? scopeAt(path) : kind === 'beforeEach' ? { kind: 'each', depth: path.length } : { kind: 'after' };
let scopeCurrent = scopePath;
const wrapDescribe = (api, depth) => {
  if (typeof api !== 'function' || depth > 4) return api;
  const out = function (...args) {
    const fn = args[1];
    if (typeof fn === 'function' && caseScope?.phase !== undefined) {
      const path = [...scopeCurrent, String(args[0])];
      args[1] = function (...given) {
        const before = scopeCurrent;
        scopeCurrent = path;
        caseScope.phase(scopeAt(path));
        try {
          return fn.apply(this, given);
        } finally {
          scopeCurrent = before;
          caseScope.phase(before.length === 0 ? undefined : scopeAt(before));
        }
      };
    }
    const answered = api.apply(this, args);
    return typeof answered === 'function' ? wrapDescribe(answered, depth + 1) : answered;
  };
  for (const key of Object.keys(api)) out[key] = wrapDescribe(api[key], depth + 1);
  return out;
};
const wrapHook = (kind, api) => function (fn, ...rest) {
  if (typeof fn !== 'function' || caseScope?.within === undefined) return api.call(this, fn, ...rest);
  const at = hookAt(kind, scopeCurrent);
  return api.call(this, function (...given) {
    return caseScope.within(at, () => fn.apply(this, given));
  }, ...rest);
};
for (const holder of [${holders}]) {
  if (holder === undefined || holder === null) continue;
  if (typeof holder.describe === 'function') holder.describe = wrapDescribe(holder.describe, 0);
  for (const kind of ['beforeAll', 'beforeEach', 'afterEach', 'afterAll']) {
    if (typeof holder[kind] === 'function') holder[kind] = wrapHook(kind, holder[kind]);
  }
}
`;
}
