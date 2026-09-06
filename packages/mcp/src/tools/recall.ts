import type { BoundaryRow, CompositionReport, RunReport } from '@variance-authority/report';

/**
 * One subject, read from the inside: the recall the run wrote down per subject.
 *
 * Structure first, because it is the answer to the question asked. The rows are
 * in document order, indented by depth, each with who mounted it and how many
 * boundaries it stands for. The echoes follow because they are what makes a
 * subject's composition worth knowing during a review: a rendering this subject
 * shares with the design-system story is a diff to read once, and the row that
 * holds it is the row to read it at.
 *
 * Three different absences, three sentences. A report from before the run
 * recorded structure has nothing per subject and says so; a subject the run did
 * not compose is named as planned-and-unobserved when the report knows that,
 * and as unknown when it does not.
 */
export function recall(report: RunReport, composed: CompositionReport, subject: string): string {
  const structure = composed.structure;
  if (structure === undefined) {
    return (
      'This report carries no per-subject structure: it was written by a run that recorded the ' +
      'census component-first and nothing subject-first. Re-run to get one. Meanwhile the census ' +
      `names ${composed.components.length} component(s) and which subjects each holds in.`
    );
  }

  const record = structure.find((each) => each.subject === subject);
  if (record === undefined) {
    const planned = report.notObserved?.find((each) => each.subject === subject);
    if (planned !== undefined) {
      return (
        `\`${subject}\` was planned and not observed in this run, so nothing was composed for ` +
        'it — `variance_explain_verdict` says why.'
      );
    }
    return (
      `\`${subject}\` is not among the ${composed.subjects.length} subject(s) this run composed: ` +
      `${preview(composed.subjects, 12)}. \`variance_locate\` finds one from a description.`
    );
  }

  const examples = composed.components
    .filter((entry) => entry.examples.includes(subject))
    .map((entry) => entry.component);
  const components = new Set(record.rows.map((row) => row.component));
  const boundaries = record.rows.reduce((sum, row) => sum + row.count, 0);

  const head =
    `${subject} — ${components.size} component(s), ${boundaries} boundar${boundaries === 1 ? 'y' : 'ies'}` +
    (examples.length === 0 ? '' : `; the example of ${examples.join(', ')}`);

  if (record.rows.length === 0) {
    return (
      `${head}\n  no attributed boundary: its nodes carry no component provenance, so a change in ` +
      'it can be located in the image but not attributed to what rendered it'
    );
  }

  const echoes = sharedWith(composed.echoes, subject);

  return [
    [head, ...record.rows.map(renderRow)].join('\n'),
    echoes.length === 0
      ? ''
      : [
          `shared with other subjects (${echoes.length}) — one diff to read, wherever it is read`,
          ...echoes.map(
            (echo) =>
              `  ${echo.component} @ ${echo.rendering} also in ${preview(echo.others)}` +
              (echo.example === undefined ? '' : ` (example ${echo.example})`),
          ),
        ].join('\n'),
  ]
    .filter((section) => section !== '')
    .join('\n\n');
}

interface Shared {
  readonly component: string;
  readonly rendering: string;
  readonly others: readonly string[];
  readonly example?: string;
}

/**
 * The renderings this subject shares, one row per rendering.
 *
 * The census keys an echo under the props class it was found in, so one
 * rendering reached from three props digests is three echo records with three
 * subject lists. Read from one subject, the question is only *who else holds
 * these bytes*, and the answer is the union: the digest is the identity, and
 * three rows carrying it would read as three findings.
 */
function sharedWith(echoes: CompositionReport['echoes'], subject: string): readonly Shared[] {
  const rows = new Map<
    string,
    { component: string; rendering: string; others: string[]; example?: string }
  >();
  for (const echo of echoes) {
    if (!echo.subjects.includes(subject)) continue;
    const key = `${echo.component} ${echo.rendering}`;
    let row = rows.get(key);
    if (row === undefined) {
      rows.set(
        key,
        (row = {
          component: echo.component,
          rendering: echo.rendering,
          others: [],
        }),
      );
    }
    for (const each of echo.subjects) {
      if (each !== subject && !row.others.includes(each)) row.others.push(each);
    }
    if (row.example === undefined && echo.example !== undefined) row.example = echo.example;
  }
  return [...rows.values()].map((row) => ({
    ...row,
    ...(row.example === undefined ? {} : { example: row.example }),
  }));
}

function renderRow(row: BoundaryRow): string {
  const count = row.count === 1 ? '' : ` ×${row.count}`;
  const variants = row.variants === 1 ? '' : ` (${row.variants} variants)`;
  const created = row.createdBy === undefined ? '' : ` · created by ${row.createdBy}`;
  return `${'  '.repeat(row.depth + 1)}${row.component}${count}${variants}${created}`;
}

/** The first few, because a reader wants examples and not a manifest. */
function preview(values: readonly string[], limit = 4): string {
  return values.length <= limit
    ? values.join(', ')
    : `${values.slice(0, limit).join(', ')}, and ${values.length - limit} more`;
}
