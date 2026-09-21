/**
 * What a distance reading looks like on a terminal.
 *
 * Separated from the tool because it is the half with no side effects: given a
 * reading it returns lines, and `test-since.mjs` decides what to do about them.
 * Both halves are printed on every run, whether or not a leg was asked for — the
 * table so a leg is never seen without the reading it came out of, and the
 * findings because neither of them needs a red test to be worth reading.
 */

/**
 * One line per distance, so the table a caller took a leg out of is always on
 * screen beside it.
 *
 * The hop count is the whole left column, because it is also what `--at-distance`
 * takes: a reader who sees `4 hops  12 file(s)` and wants those twelve knows the
 * flag without being told the mapping.
 */
export function distanceLines(groups) {
  return groups.map((group) => {
    const name = group.unplaced
      ? '  ·  unplaced'
      : `${`${group.hops}`.padStart(3)}  hop${group.hops === 1 ? '' : 's'}`;
    return `  ${name.padEnd(16)} ${`${group.tests.length}`.padStart(4)} file(s)`;
  });
}

/**
 * The two shapes worth reporting before anything has failed, and the one that
 * is not a shape at all.
 *
 * Neither finding needs a red test. A reach-through is a dependency somebody
 * took that the unit does not offer, and it is a defect the moment it is
 * written; an unexplained test is a route between two files that no import
 * describes. They are printed together because they are the same complaint at
 * two strengths — the change arrived somewhere the structure does not account
 * for.
 *
 * The third section is the opposite of a complaint and is printed under the
 * other two so it can never be read as one. In this repository it is mostly the
 * `dist` of a workspace package: `packages/cli` imports its neighbours through
 * their manifests, so what its tests entered is built output, and the scan reads
 * source. Nothing is wrong with those tests. Nothing is known about them either,
 * and saying so is the difference between a tool and an accusation.
 */
export function findingLines(reading) {
  const through = reading.flatMap((distance) =>
    (distance.through ?? []).map((hop) => ({ test: distance.test, hop })),
  );
  const unexplained = reading.filter((distance) => distance.bearing === 'unexplained');
  const unmeasured = [
    ...new Set(
      reading.filter((distance) => distance.bearing === 'unmeasured').map((distance) => distance.because),
    ),
  ].sort();
  if (through.length === 0 && unexplained.length === 0 && unmeasured.length === 0) return [];

  const seen = new Set();
  return [
    ...(through.length === 0
      ? []
      : [
          'Reached past a unit face:',
          ...through
            .filter(({ hop }) => {
              const key = `${hop.importer} → ${hop.reached}`;
              return seen.has(key) ? false : seen.add(key);
            })
            .map(({ hop }) =>
              `  ${hop.importer} imports ${hop.reached}; ${hop.unit}'s entry point is ${hop.entry}`,
            ),
          '',
        ]),
    ...(unexplained.length === 0
      ? []
      : [
          'Covered the change by no import route:',
          ...unexplained.map((distance) => `  ${distance.test}`),
          '',
        ]),
    ...(unmeasured.length === 0
      ? []
      : [
          'No distance was measurable for some of these, because:',
          ...unmeasured.map((because) => `  ${because}`),
          '',
        ]),
  ];
}

/**
 * What `test:since` offers, for a reader who did not open the tool.
 *
 * An agent reaching for a shorter run finds the flag here or does not find it at
 * all, and a power nothing announces is a power nobody has. The distances are
 * hop counts and so is the range: the table this prints and the flag it takes
 * are the same numbers.
 */
export function helpLines() {
  return [
    'test:since — run the tests a change reached, nearest first.',
    '',
    'usage: yarn test:since [<ref>] [--at-distance <range>] [--dry-run]',
    '',
    '  <ref>                 measure from the merge base with this ref.',
    '                        Defaults to the commit the snapshot was recorded at.',
    '  --at-distance <range> run only the tests this many imports from the change.',
    '                        `0-2`, `2`, or `3-`. Zero is a test whose own source',
    '                        you edited. Tests with no measurable distance ride',
    '                        with the leg that reaches the end.',
    '  --dry-run             print the reading and run nothing.',
    '  --help                this.',
    '',
    'The loop:',
    '',
    '  yarn test:since --at-distance 0-2   while the edit is still open',
    '  yarn test:since --at-distance 2-4   before handing the change over',
    '  yarn test                           the gate, and the only green that counts',
    '',
    'Every run prints the whole reading before the leg it took out of it, the',
    'files a leg left for later, and two findings that need no red test: imports',
    'that reached past a unit face, and tests the change covered by no route they',
    'imported.',
  ];
}

/** A range as the phrase the empty-leg sentence needs. */
export function describeRange(range) {
  if (range.to === Number.MAX_SAFE_INTEGER) return `${range.from} hop(s) or more`;
  if (range.from === range.to) return `${range.from} hop(s)`;
  return `${range.from}-${range.to} hops`;
}
