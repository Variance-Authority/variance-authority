// A last-call cache in the shape of `memoize-one`. It sits outside `src`, so
// the recording does not instrument it, the same as a package in
// `node_modules`.
export function memoizeOne<T>(compute: (value: number) => T): (value: number) => T {
  let last: { value: number; result: T } | undefined;
  return (value) => {
    if (last !== undefined && last.value === value) return last.result;
    last = { value, result: compute(value) };
    return last.result;
  };
}
