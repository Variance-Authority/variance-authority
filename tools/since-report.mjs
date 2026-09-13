/**
 * What a distance reading looks like on a terminal.
 *
 * Separated from the tool because it is the half with no side effects: given a
 * reading it returns lines, and `test-since.mjs` decides what to do about them.
 * Both halves are printed on every run, banded or not — the table so that a
 * slice is never seen without the thing it was cut from, and the findings
 * because neither of them needs a red test to be worth reading.
 */

/** One line per ring, so the table a caller slices is always on screen. */
export function bandLines(bands) {
  return bands.map((ring, at) => {
    const name = ring.unplaced
      ? '  ·  unplaced'
      : `${`${at + 1}`.padStart(3)}  ${ring.hops} hop${ring.hops === 1 ? ' ' : 's'}`;
    return `  ${name.padEnd(16)} ${`${ring.tests.length}`.padStart(4)} file(s)`;
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
              `  ${hop.importer} imports ${hop.reached}; ${hop.unit} is entered at ${hop.entry}`,
            ),
          '',
        ]),
    ...(unexplained.length === 0
      ? []
      : [
          'Entered the change by no route they imported:',
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
