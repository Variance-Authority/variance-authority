/**
 * Where a `variancePrecondition` call stands, for a runner whose hooks and
 * describes are reached only through the API that registered them, as source.
 *
 * Rstest announces no hook and hands no runner class to replace — the reasons
 * [`caseGlobalsSource`](./worker-source.ts) wraps its case registrars — so the
 * describe and hook registrars are wrapped beside them. Each hook captures, at
 * registration, how deep the describe it was registered under is: a describe's
 * callback runs with its own path current, whenever the runner chooses to call
 * it, so a hook registered inside it knows its depth whether the runner
 * collects eagerly or queues the callback for later.
 *
 * A hook runs inside the case scope's `within`. A `beforeEach` speaks for the
 * case the runner hands the same context, which keeps two concurrent cases
 * apart, and a case that never runs because its `beforeEach` threw leaves what
 * it said under a context no other case is handed. An `afterEach` reaches no
 * case, and a call in a `beforeAll` or an `afterAll` throws, because neither
 * runs for one case.
 *
 * @param holders Source for the objects that hold the registrars, as
 * `caseGlobalsSource` takes them.
 */
export function scopeGlobalsSource(holders: string): string {
  return `
const hookAt = (kind, path, given) =>
  kind === 'beforeEach'
    ? { kind: 'each', depth: path.length, token: given[0] }
    : kind === 'afterEach'
    ? { kind: 'after' }
    : { kind: 'outside', because: 'ran in ' + (kind === 'beforeAll' ? 'a beforeAll' : 'an afterAll') + ', which runs for no one case' };
let scopeCurrent = [];
const wrapDescribe = (api, depth) => {
  if (typeof api !== 'function' || depth > 4) return api;
  const out = function (...args) {
    const fn = args[1];
    if (typeof fn === 'function' && caseScope?.within !== undefined) {
      const path = [...scopeCurrent, String(args[0])];
      args[1] = function (...given) {
        const before = scopeCurrent;
        scopeCurrent = path;
        try {
          return fn.apply(this, given);
        } finally {
          scopeCurrent = before;
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
  const path = scopeCurrent;
  return api.call(this, function (...given) {
    return caseScope.within(hookAt(kind, path, given), () => fn.apply(this, given));
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
