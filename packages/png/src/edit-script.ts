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
 */
export function edits(left: Float64Array, right: Float64Array, limit: number): Edit[] {
  const script: Edit[] = [];
  editsBetween(left, 0, left.length, right, 0, right.length, limit, script);
  return script;
}

function editsBetween(
  left: Float64Array,
  leftFrom: number,
  leftTo: number,
  right: Float64Array,
  rightFrom: number,
  rightTo: number,
  limit: number,
  script: Edit[],
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
  const [from, to, at, until] = [leftFrom + head, leftTo - tail, rightFrom + head, rightTo - tail];

  const shortest = myers(left, from, to, right, at, until, limit);
  if (shortest !== undefined) for (const edit of shortest) script.push(edit);
  else {
    const chain = anchors(left, from, to, right, at, until);
    if (chain.length === 0) {
      for (let index = from; index < to; index += 1) script.push(['-', index]);
      for (let index = at; index < until; index += 1) script.push(['+', index]);
    }
    let [x, y] = [from, at];
    for (const [i, j] of chain) {
      editsBetween(left, x, i, right, y, j, limit, script);
      script.push(['=', i, j]);
      [x, y] = [i + 1, j + 1];
    }
    if (chain.length > 0) editsBetween(left, x, to, right, y, until, limit, script);
  }

  for (let index = tail; index > 0; index -= 1) script.push(['=', leftTo - index, rightTo - index]);
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
): [number, number][] {
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
  const once = [...seen.values()].filter((entry) => entry.left === 1 && entry.right === 1);
  once.sort((a, b) => a.at - b.at);

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
 * or `undefined` past `limit` rounds. The trace keeps, for each `d`, only the
 * diagonals `-d..d` that round reached, which is what makes D² memory rather
 * than D·(N+M).
 */
function myers(
  left: Float64Array,
  from: number,
  to: number,
  right: Float64Array,
  at: number,
  until: number,
  limit: number,
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
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
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
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    script.push(['=', from + x, at + y]);
  }
  return script.reverse();
}
