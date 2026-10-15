/** One step of the edit script: a run kept on both sides, removed from the left, or added on the right. */
export type Edit = readonly ['=', number, number] | readonly ['-', number] | readonly ['+', number];

/**
 * The edit script between two token columns.
 *
 * Myers' search finds the shortest one, and is bounded: past `limit` rounds it
 * stops, since its trace grows as the square of the rounds. One rewritten
 * section and a few lines that changed further down add up past it on a long
 * page, and the edit is still local, so the search giving up is no reason to
 * stop pairing the rows the edit only moved. The columns are then split where
 * they agree on a run that occurs once in each, as patience diff does: the
 * longest chain of such runs in the same order on both sides is kept, and each
 * stretch between two of them is diffed alone, where runs once repeated may
 * occur once. A stretch with no such run and no shortest edit within `limit` is
 * one band, every run of it removed and added, which `pairing` compares by
 * position within the band and `explainsMore` weighs against position.
 *
 * The split spends at most what the failed search could have: `limit` steps
 * for each run of the two columns, counting a diagonal Myers visits, a run it
 * compares, and a run the split counts. A stretch reached once that is spent is
 * one band, so no input costs more than twice the search alone, however deep
 * the stretches nest.
 */
export function edits(left: Float64Array, right: Float64Array, limit: number): Edit[] {
  const script: Edit[] = [];
  const budget = { left: limit * (left.length + right.length) };
  // Taken from the end: a stretch puts back what follows it before what it holds.
  const pending: Pending[] = [{ from: 0, to: left.length, at: 0, until: right.length }];
  for (let first = true; pending.length > 0; first = false) {
    const next = pending.pop()!;
    if ('edit' in next) script.push(next.edit);
    else stretch(left, right, next, limit, first ? { left: Infinity } : budget, script, pending);
  }
  return script;
}

type Pending = { readonly edit: Edit } | Stretch;

interface Stretch {
  readonly from: number;
  readonly to: number;
  readonly at: number;
  readonly until: number;
}

function stretch(
  left: Float64Array,
  right: Float64Array,
  { from: leftFrom, to: leftTo, at: rightFrom, until: rightTo }: Stretch,
  limit: number,
  budget: { left: number },
  script: Edit[],
  pending: Pending[],
): void {
  let head = 0;
  while (leftFrom + head < leftTo && rightFrom + head < rightTo && left[leftFrom + head] === right[rightFrom + head]) {
    script.push(['=', leftFrom + head, rightFrom + head]);
    head += 1;
  }
  let tail = 0;
  while (
    tail < leftTo - leftFrom - head &&
    tail < rightTo - rightFrom - head &&
    left[leftTo - 1 - tail] === right[rightTo - 1 - tail]
  ) {
    tail += 1;
  }
  for (let index = 1; index <= tail; index += 1) pending.push({ edit: ['=', leftTo - index, rightTo - index] });
  const [from, to, at, until] = [leftFrom + head, leftTo - tail, rightFrom + head, rightTo - tail];

  const shortest = myers(left, from, to, right, at, until, limit, budget);
  if (shortest !== undefined) {
    for (const edit of shortest) script.push(edit);
    return;
  }
  const chain = budget.left > 0 ? anchors(left, from, to, right, at, until, budget) : [];
  if (chain.length === 0) {
    for (let index = from; index < to; index += 1) script.push(['-', index]);
    for (let index = at; index < until; index += 1) script.push(['+', index]);
    return;
  }
  pending.push({ from: chain.at(-1)![0] + 1, to, at: chain.at(-1)![1] + 1, until });
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const [i, j] = chain[index]!;
    pending.push({ edit: ['=', i, j] });
    const [x, y] = index === 0 ? [from, at] : [chain[index - 1]![0] + 1, chain[index - 1]![1] + 1];
    pending.push({ from: x, to: i, at: y, until: j });
  }
}

/**
 * The runs that occur once in each range, as pairs of indices, longest chain
 * that keeps their order on both sides: patience sorting over the right index.
 */
function anchors(
  left: Float64Array,
  leftFrom: number,
  leftTo: number,
  right: Float64Array,
  rightFrom: number,
  rightTo: number,
  budget: { left: number },
): [number, number][] {
  budget.left -= leftTo - leftFrom + rightTo - rightFrom;
  const seen = new Map<number, { left: number; right: number; at: number; to: number }>();
  for (let i = leftFrom; i < leftTo; i += 1) {
    const entry = seen.get(left[i]!);
    if (entry === undefined) seen.set(left[i]!, { left: 1, right: 0, at: i, to: -1 });
    else entry.left += 1;
  }
  for (let j = rightFrom; j < rightTo; j += 1) {
    const entry = seen.get(right[j]!);
    if (entry === undefined) continue;
    entry.right += 1;
    entry.to = j;
  }
  // In order of `at` already: a map keeps the order its keys were first set in.
  const once = [...seen.values()].filter((entry) => entry.left === 1 && entry.right === 1);

  // `ends[k]` is the index in `once` of the smallest right end of a chain k + 1 long.
  const ends: number[] = [];
  const previous = new Int32Array(once.length).fill(-1);
  for (const [index, entry] of once.entries()) {
    let low = 0;
    let high = ends.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (once[ends[middle]!]!.to < entry.to) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = ends[low - 1]!;
    ends[low] = index;
  }
  const chain: [number, number][] = [];
  for (let index = ends.at(-1) ?? -1; index >= 0; index = previous[index]!) chain.push([once[index]!.at, once[index]!.to]);
  return chain.reverse();
}

/**
 * Myers' shortest edit script between `left[from, to)` and `right[at, until)`,
 * or `undefined` past `limit` rounds or once `budget` is spent. The trace
 * keeps, for each `d`, only the diagonals `-d..d` that round reached, which is
 * what makes D² memory rather than D·(N+M). The caller has taken the common
 * head off both ranges, so the first rows differ, the path leaves (0, 0) on an
 * edit, and the walk back ends there with no run of equal rows left before it.
 */
function myers(
  left: Float64Array,
  from: number,
  to: number,
  right: Float64Array,
  at: number,
  until: number,
  limit: number,
  budget: { left: number },
): Edit[] | undefined {
  const a = left.subarray(from, to);
  const b = right.subarray(at, until);
  const n = a.length;
  const m = b.length;
  const offset = n + m + 1;
  const v = new Int32Array(2 * offset + 1);
  const trace: Int32Array[] = [];
  let found = -1;

  for (let d = 0; d <= n + m && found < 0; d += 1) {
    if (d > limit) return undefined;
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      const start = x;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      budget.left -= 1 + x - start;
      if (budget.left < 0) return undefined;
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }

  const script: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const round = trace[d]!;
    const reached = (k: number): number => round[k + d]!;
    const k = x - y;
    const previous = k === -d || (k !== d && reached(k - 1) < reached(k + 1)) ? k + 1 : k - 1;
    const px = reached(previous);
    const py = px - previous;
    while (x > px && y > py) {
      x -= 1;
      y -= 1;
      script.push(['=', from + x, at + y]);
    }
    if (x === px) script.push(['+', at + py]);
    else script.push(['-', from + px]);
    x = px;
    y = py;
  }
  return script.reverse();
}
