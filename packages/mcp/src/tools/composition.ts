import type {
  ComponentRecord,
  CompositionReport,
  DivergenceRecord,
  EchoRecord,
  MovementRecord,
} from '@variance-authority/report';
import { recall } from './recall.js';
import type { Tool } from './tool.js';

/**
 * `variance_composition` — the suite as one graph, and the flakes it shortlists.
 *
 * The other axis. Every other tool in this package answers about *one subject
 * against its baseline*: two revisions, one thing. This one answers about the
 * run's subjects compared to **each other**, at one commit, which is the
 * question a suite of examples has always implied and never written down:
 *
 * > A visual-regression example is a component built from components. The
 * > example *is* a component, at a boundary; the same component appears again,
 * > with the same or different props, inside larger examples.
 *
 * It earns a tool of its own rather than a paragraph in `variance_summary`
 * because it changes what an agent does next twice over. `variance_changes`
 * turns forty changed subjects into three decisions; this turns a decision into
 * the component and the caller behind it, and then says which movements
 * *nothing in the run explains* — the only place in this package where a flake
 * is named, and the only one that can name it, because naming one needs the
 * places the same component **held**.
 *
 * Not `variance_trace_component`, which reads the regions of changed subjects
 * and is therefore blind to every component that did not move. The control
 * group is the half of a flake report that makes the other half worth reading,
 * so this reads every boundary in every subject instead.
 */

/** Echoes printed before the list is cut. The rest are counted, never dropped in silence. */
const MAX_ECHOES_SHOWN = 10;

/**
 * The suite's graph: what it is built from, what repeats, and what moved.
 *
 * Ordered by what an agent acts on rather than by what is interesting.
 * Unexplained movements lead, because they are the only entries here that are a
 * *finding*; explained ones are folded to one line per cause, for the same
 * reason `variance_changes` refuses to list forty subjects; and the shared
 * renderings come last, because they change how a review is *sized* rather than
 * what it concludes.
 */
export const composition: Tool = {
  name: 'variance_composition',
  description:
    'The run’s subjects compared to each other at one commit rather than to their baselines: ' +
    'which components the suite is built from, which renderings appear in more than one subject ' +
    '(so two diffs are one thing to review), which components render two ways from one input, ' +
    'and — for everything that moved — whether an edited file, a moved token or an edited caller ' +
    'explains it. Movements nothing explains are named here: `flake` where the subject also ' +
    'failed to read the same way twice, `suspect` where nobody has read it twice yet. Pass ' +
    '`component` for one component’s census entry, the subjects it holds in, and the examples ' +
    'that watch it; pass `subject` for what one subject is made of — its boundaries as a tree, ' +
    'who mounted each, how many of each and in how many variants, and which of its renderings ' +
    'other subjects share. Ask this when a change has no obvious author, when you need the ' +
    'component behind a set of diffs, before calling anything flaky, or when `variance_locate` ' +
    'named a subject and you need to see inside it.',
  inputSchema: {
    type: 'object',
    properties: {
      component: {
        type: 'string',
        description: 'Optional. One component’s entry in the graph, instead of the whole suite.',
      },
      subject: {
        type: 'string',
        description:
          'Optional. One subject’s composition — its boundaries as a tree — instead of the whole suite.',
      },
    },
    additionalProperties: false,
  },

  run(report, input) {
    const composed = report.composition;
    if (composed === undefined) return ABSENT;

    const subject = typeof input?.['subject'] === 'string' ? input['subject'] : undefined;
    if (subject !== undefined) return recall(report, composed, subject);

    const wanted = typeof input?.['component'] === 'string' ? input['component'] : undefined;
    return wanted === undefined ? whole(composed) : one(composed, wanted);
  },
};

/**
 * The absence, said as an absence.
 *
 * `composition` is missing from a report whose collection produced no semantic
 * snapshots, and rendering that as an empty graph would answer *this suite
 * shares nothing* — a different claim, and a false one. Absent is not empty
 * here for the same reason it is not empty anywhere else in this system.
 */
const ABSENT =
  'This run composed nothing, which is not the same as it finding nothing. No subject supplied ' +
  'a semantic snapshot — a raster-only or ephemeral run compares images and never sees a ' +
  'component boundary — so there was nothing to join. Nothing here says the suite shares no ' +
  'components; it says this run cannot tell.';

function whole(composed: CompositionReport): string {
  const unexplained = composed.movements.filter((movement) => movement.cause === 'unexplained');
  const explained = composed.movements.filter((movement) => movement.cause !== 'unexplained');

  return [
    headline(composed, unexplained.length),
    unexplainedSection(unexplained),
    explainedSection(explained),
    divergenceSection(composed.divergences),
    echoSection(composed),
    orphanSection(composed.components),
  ]
    .filter((section) => section !== '')
    .join('\n\n');
}

function one(composed: CompositionReport, wanted: string): string {
  const entry = composed.components.find((each) => each.component === wanted);
  if (entry === undefined) return missing(composed, wanted);

  const movements = composed.movements.filter((movement) => movement.component === wanted);

  return [
    census(entry),
    unexplainedSection(movements.filter((movement) => movement.cause === 'unexplained')),
    explainedSection(movements.filter((movement) => movement.cause !== 'unexplained')),
    divergenceSection(composed.divergences.filter((each) => each.component === wanted)),
    echoesFor(composed.echoes.filter((echo) => echo.component === wanted)),
  ]
    .filter((section) => section !== '')
    .join('\n\n');
}

/**
 * The census, or the one sentence that replaces it when there is nothing to count.
 *
 * A run whose subjects carry no component provenance — a fixture built with
 * `createElement`, a page served without source stamping — would otherwise get a
 * census of zeros and an empty `components:` list, which reads as a broken
 * report rather than as an answered question. Every other section here already
 * suppresses itself when empty; this one could not, because it is also the only
 * place the reader learns that attribution was unavailable rather than clean.
 */
function headline(composed: CompositionReport, unexplained: number): string {
  if (composed.components.length === 0) {
    return (
      `no component named in ${composed.subjects.length} subject(s) — these subjects carry no ` +
      'component provenance, so a change in them can be located in the image but not ' +
      'attributed to what rendered it'
    );
  }

  const echoes = composed.echoes.length + (composed.truncated?.echoes ?? 0);
  const movements =
    composed.movements.length === 0
      ? 'nothing moved'
      : `${composed.movements.length} movement(s), ${unexplained} of them unexplained`;

  return (
    `${composed.components.length} component(s) across ${composed.subjects.length} subject(s) — ` +
    `${echoes} shared rendering(s), ${composed.divergences.length} divergence(s), ${movements}\n` +
    `  components: ${preview(
      composed.components.map((entry) => entry.component),
      20,
    )}`
  );
}

/**
 * The finding, and the two things it is allowed to be called.
 *
 * `flake` and `suspect` are not degrees of confidence in the same claim. One is
 * a subject that disagreed with itself *and* has no explanation; the other is a
 * subject nobody has read twice, which is a shortlist entry — the scarce
 * resource a sweep spends, pointed somewhere better than plan order.
 */
function unexplainedSection(movements: readonly MovementRecord[]): string {
  if (movements.length === 0) return '';

  const flakes = movements.filter((movement) => movement.standing === 'flake').length;

  return [
    `unexplained (${movements.length}) — no edited file, moved token, edited caller or ` +
      'contradiction in this run accounts for these' +
      (flakes === 0 ? '' : `; ${flakes} in subjects already proven unstable`),
    '',
    ...movements.map(renderUnexplained),
  ].join('\n');
}

function renderUnexplained(movement: MovementRecord): string {
  const standing =
    movement.standing === 'flake'
      ? '  [flake] the subject also failed to read the same way twice in this run, so both ' +
        'halves of the sentence are present\n'
      : movement.standing === 'suspect'
        ? '  [suspect] nothing has read this subject twice, so this is a shortlist entry and ' +
          'not a verdict — `variance run --flakes` is what settles it\n'
        : '';

  const held =
    movement.held.length === 0
      ? '  no control: it renders nowhere else in this run with these inputs, which weakens ' +
        'this rather than strengthening it\n'
      : `  held in ${movement.held.length} other place(s): ${preview(movement.held)}\n`;

  return (
    `${movement.subject} · ${movement.component}${bands(movement.bands)}\n` +
    `  ${movement.because}\n` +
    standing +
    held +
    alsoIn(movement)
  );
}

/**
 * One line per cause, not one per subject.
 *
 * A token edit reaching eleven subjects is eleven movement records carrying one
 * sentence between them, and printing all eleven is the failure
 * `variance_changes` exists to prevent, arrived at from the other direction.
 * Grouped on the `because`, which names the evidence, so two movements share a
 * line only when they share the actual reason.
 */
function explainedSection(movements: readonly MovementRecord[]): string {
  if (movements.length === 0) return '';

  const groups = new Map<string, { readonly head: string; readonly subjects: string[] }>();
  for (const movement of movements) {
    const head = `${movement.component} [${movement.cause}] — ${movement.because}`;
    const group = groups.get(head);
    if (group === undefined) groups.set(head, { head, subjects: [movement.subject] });
    else group.subjects.push(movement.subject);
  }

  return [
    `explained (${groups.size} cause(s) across ${movements.length} movement(s))`,
    '',
    ...[...groups.values()].map(
      (group) => `${group.head}\n  ${group.subjects.length} subject(s): ${preview(group.subjects)}`,
    ),
  ].join('\n');
}

function divergenceSection(divergences: readonly DivergenceRecord[]): string {
  if (divergences.length === 0) return '';

  return [
    `diverging at this commit (${divergences.length}) — one input, more than one rendering. Not ` +
      'a regression: there is no baseline anywhere in this. Either something outside the props ' +
      'decides part of the output — a token, a theme, an ancestor’s cascade — or the reading is ' +
      'not repeatable.',
    '',
    ...divergences.map(
      (divergence) =>
        `${divergence.component}${bands(divergence.bands)} — ${divergence.renderings.length} ` +
        `rendering(s) from one props digest\n` +
        // One line per rendering, widest first. The split is the finding: the
        // subjects on the short line are the ones that disagree with the rest,
        // and they are what a reader opens. A single flat list of every subject
        // involved says a divergence happened and refuses to say where.
        divergence.renderings
          .map(
            (subjects, index) =>
              `  ${subjects.length} subject(s): ${preview(subjects)}` +
              // The parting, indented under the rendering it explains. This is
              // the answer to the question the rest of the section only poses —
              // an agent reading this has the moved input by name and never has
              // to fetch two subjects and diff them.
              partingLines(divergence, index),
          )
          .join('\n'),
    ),
  ].join('\n');
}

/**
 * The parting for one rendering, indented, or nothing.
 *
 * Nothing when the run kept no documents — silence rather than a line saying so,
 * because this section is already explicit that a divergence has two possible
 * causes, and a per-rendering "not read" under every row would be the same
 * caveat repeated once per subject.
 */
function partingLines(divergence: DivergenceRecord, rendering: number): string {
  const parting = divergence.partings?.find((entry) => entry.rendering === rendering);
  if (parting === undefined) return '';
  return parting.lines.map((line) => `\n    ${line}`).join('');
}

function echoSection(composed: CompositionReport): string {
  const dropped = composed.truncated?.echoes ?? 0;
  const total = composed.echoes.length + dropped;
  if (total === 0) return '';

  const shown = composed.echoes.slice(0, MAX_ECHOES_SHOWN);
  const hidden = composed.echoes.length - shown.length;

  return [
    `shared renderings (${total}) — the same component producing the same output in more than ` +
      'one subject. Two diffs over one of these are one thing to review, and an example among ' +
      'them is the narrow subject to review it in.',
    '',
    ...shown.map(renderEcho),
    ...(hidden === 0
      ? []
      : [`${hidden} more are in the report; ask with \`component\` to see one component’s.`]),
    ...(dropped === 0
      ? []
      : [
          `${dropped} more were never written to the report: the run caps this list, and what ` +
            'the cap left out is counted here rather than passed off as coverage.',
        ]),
  ].join('\n');
}

function echoesFor(echoes: readonly EchoRecord[]): string {
  if (echoes.length === 0) return '';
  return [`shared renderings (${echoes.length})`, '', ...echoes.map(renderEcho)].join('\n');
}

function renderEcho(echo: EchoRecord): string {
  const example =
    echo.example === undefined
      ? '  no example among them: every subject sharing this rendering is a larger one'
      : `  example: ${echo.example}`;

  return (
    `${echo.component} · ${echo.subjects.length} subject(s), ${echo.sites} site(s)\n` +
    `${example}\n` +
    `  ${preview(echo.subjects)}`
  );
}

/**
 * The components the suite watches only through something else.
 *
 * The gap a reviewer is usually looking for, and it is a list rather than a
 * count because the names are the work: a component with no narrow example is
 * reviewed through whatever page happens to contain it, and a change to it that
 * the page's own noise absorbs is a change nothing in the suite would catch.
 */
function orphanSection(components: readonly ComponentRecord[]): string {
  const orphans = components.filter((entry) => entry.examples.length === 0);
  if (orphans.length === 0) return '';

  return (
    `no example of their own (${orphans.length}): ` +
    `${preview(
      orphans.map((entry) => entry.component),
      12,
    )}\n` +
    '  These appear only inside larger subjects, so a change to one is reviewed through ' +
    'whatever page happens to contain it.'
  );
}

function census(entry: ComponentRecord): string {
  const shape =
    entry.renderings === entry.variants
      ? `${entry.variants} input(s), ${entry.renderings} rendering(s): here, its output is a ` +
        'function of its props'
      : entry.renderings > entry.variants
        ? `${entry.variants} input(s) produced ${entry.renderings} rendering(s): its output is ` +
          'not a function of its props alone'
        : `${entry.variants} input(s) produced ${entry.renderings} rendering(s): some of those ` +
          'inputs make no difference to what it renders';

  return [
    `${entry.component} — ${entry.instances} boundary(ies) in ${entry.subjects.length} subject(s)`,
    entry.examples.length === 0
      ? '  no example of its own: it appears only inside larger subjects'
      : `  example(s): ${entry.examples.join(', ')}`,
    `  within: ${list(entry.within)}`,
    // Two upward edges because they answer different questions. `within` is
    // where the boundary sits, which is often a presentational wrapper that
    // knows nothing about it; `created by` is who wrote the element, which is
    // the file whose edit changed this component's inputs.
    `  created by: ${list(entry.createdBy)}${
      entry.createdBy.length === 0
        ? ' — either nothing mounted it, or this was a production build, where the owner is gone'
        : ''
    }`,
    `  renders: ${list(entry.renders)}`,
    `  tokens: ${list(entry.tokens)}`,
    `  ${shape}`,
    ...(entry.renderings === entry.variants
      ? []
      : [
          '  (an input here is a props digest, which excludes `children` — a pair that the ' +
            'children could explain is refused rather than reported)',
        ]),
    `  subjects: ${preview(entry.subjects, 8)}`,
  ].join('\n');
}

/**
 * A name with no census entry, and the two very different reasons for that.
 *
 * A component that renders nothing but other components owns no DOM node, is a
 * boundary nowhere, and has no entry — while being exactly the file a reviewer
 * has to open, because it is where the props are written. A wrapper that only
 * forwards to a design-system primitive is the ordinary case. Answering that
 * with "no such component" would send an agent looking for a typo in the one
 * name that would have explained the run.
 */
function missing(composed: CompositionReport, wanted: string): string {
  const mounted = composed.components
    .filter((entry) => entry.createdBy.includes(wanted))
    .map((entry) => entry.component);

  if (mounted.length > 0) {
    return (
      `\`${wanted}\` is a boundary nowhere in this suite, so it has no census entry: it renders ` +
      'other components and authors no DOM node of its own. It is still in the graph, as the ' +
      `component that mounted ${mounted.length}: ${preview(mounted, 12)} — and it is usually ` +
      'the file to open, because it is where their props are written.'
    );
  }

  const names = composed.components.map((entry) => entry.component);
  return (
    `This run composed no component named \`${wanted}\`, and nothing it did compose names it as ` +
    `a creator. It has ${names.length}: ${preview(names, 20)}`
  );
}

/** Empty means *not known* — a name-only comparison — never *no band*. */
function bands(bands: readonly string[]): string {
  return bands.length === 0 ? '' : ` (${bands.join(', ')})`;
}

function alsoIn(movement: MovementRecord): string {
  return movement.alsoIn.length === 0
    ? ''
    : `  also moved in ${movement.alsoIn.length}: ${preview(movement.alsoIn)}\n`;
}

function list(values: readonly string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ');
}

/** The first few, because a reader wants examples and not a manifest. */
function preview(values: readonly string[], limit = 4): string {
  return values.length <= limit
    ? values.join(', ')
    : `${values.slice(0, limit).join(', ')}, and ${values.length - limit} more`;
}
