// compass: variance-authority/runtime/attention
import type { AttemptAttention, Distillation, EnteredModule, Region, UpdatePhase } from './index.js';

/** Render a distillation for a person or agent. */
export function formatDistillation(result: Distillation): string {
  return [
    `${result.test.title} — ${result.test.file ?? 'file not supplied'} [${result.test.id}]`,
    ...attemptsLines(result.attempts),
    '',
    ...executionLines(result.execution),
    '',
    'Opportunity rule: a covered file with no addressed target attribution is a distillation ' +
      'opportunity only. The evidence does not establish that it is safe to mock, replace, or remove.',
  ].join('\n');
}

/**
 * Each attempt on its own, named. A retry that addressed something else is a
 * different reading, and folding the two would say neither.
 */
function attemptsLines(attempts: readonly AttemptAttention[] | undefined): readonly string[] {
  if (attempts === undefined) return ['Eyes attention: unavailable; the record keeps no Eyes journals.'];
  if (attempts.length === 0) return ['Eyes attention: unavailable; the record keeps no Eyes journal for this case.'];
  return attempts.flatMap((attention, at) => [
    ...(at === 0 ? [] : ['']),
    attention.complete
      ? `Eyes journal, attempt ${attention.attempt}: complete.`
      : `Eyes journal, attempt ${attention.attempt}: partial — ${attention.because}`,
    `${attention.targets} target snapshot(s); ${attention.withoutFiber} had no live React Fiber.`,
    '',
    ...(attention.phases.length === 0 ? ['Addressed surface: measured empty.'] : attention.phases.flatMap((phase) => [
      `${phase.phase}:`,
      `  components: ${values(phase.components, 'none attributed by Eyes')}`,
      `  source: ${values(phase.files, 'none attributed by Eyes')}`,
    ])),
    '',
    ...updateLines(attention.updates),
  ]);
}

function updateLines(updates: readonly UpdatePhase[]): readonly string[] {
  if (updates.length === 0) return ['React update initiators: unavailable; no commit evidence was recorded.'];
  return ['React update initiators:', ...updates.flatMap((phase) => [
    `  ${phase.phase}: ${phase.commits} commit(s)`,
    ...(phase.unavailable === 0 ? [] : [`    unavailable in ${phase.unavailable} commit(s)`]),
    ...(phase.inside.length === 0 ? [] : [`    inside addressed component paths: ${phase.inside.join('; ')}`]),
    ...(phase.outside.length === 0 ? [] : [`    outside addressed component paths: ${phase.outside.join('; ')}`]),
    ...(phase.inside.length === 0 && phase.outside.length === 0 && phase.unavailable < phase.commits
      ? ['    measured empty'] : []),
  ])];
}

function executionLines(execution: Distillation['execution']): readonly string[] {
  return [
    'Runtime phase attribution: unavailable; ExecutionIndex retains test crossings, not AAA intervals.',
    `Runtime journey: ${execution.entered.length} source file(s) covered by exact case id.`,
    ...(execution.entered.length === 0 ? ['  measured empty'] : execution.entered.map(({ file, distance }) =>
      `  depth ${distance} — ${file}`)),
    ...opportunityLines(execution),
    ...regionLines(execution.modules),
  ];
}

/**
 * The opportunity list, or what stopped it from being one.
 *
 * A withheld comparison prints in the place the list would have taken, and says
 * what the evidence could not establish. Printing nothing there would read as
 * "no opportunities", which is the same confident wrong answer in the other
 * direction.
 */
function opportunityLines(
  execution: NonNullable<Distillation['execution']>,
): readonly string[] {
  if (execution.opportunities === undefined) return [
    'Distillation opportunities: unavailable; ' +
      (execution.withheld ?? 'the record keeps no Eyes journals.'),
  ];
  const missing = execution.addressedNotEntered ?? [];
  return [
    `Covered with no addressed target attributed to the same file: ${execution.opportunities.length}.`,
    ...execution.opportunities.map(({ file, distance }) =>
      `  distillation opportunity at depth ${distance} — ${file}`),
    ...(missing.length === 0 ? [] : [
      `Addressed source this run never covered: ${missing.length}. ` +
        'Either the module is not instrumented, or the two sides are rooted differently.',
      ...missing.map((file) => `  addressed, not covered — ${file}`),
    ]),
  ];
}

/**
 * The part of the reading that survives having no Eyes journal and no addressed
 * surface: which regions of a covered file this test was actually inside.
 */
function regionLines(modules: readonly EnteredModule[]): readonly string[] {
  const loaded = modules.filter((module) => module.loadedOnly);
  const partial = modules.filter((module) => !module.loadedOnly && module.unentered.length > 0);
  return [
    '',
    `Loaded but not covered: ${loaded.length} module(s).`,
    ...(loaded.length === 0
      ? ['  measured empty']
      : loaded.flatMap((module) => [
          `  ${module.file} — the import ran its top level and this test covered nothing below it`,
          `    never covered: ${module.unentered.map(named).join(', ')}`,
          `    substitution to try: vi.mock('${module.file}') — jest.mock and sb.mock say the same thing`,
        ])),
    ...(partial.length === 0 ? [] : [
      `Covered in part: ${partial.length} module(s).`,
      ...partial.flatMap((module) => [
        `  ${module.file} — covered ${module.entered.map(named).join(', ')}`,
        `    never covered: ${module.unentered.map(named).join(', ')}`,
      ]),
    ]),
    'Substitution rule: a module loaded and not covered is a boundary this test may not ' +
      'need, not one it can safely lose. Mocking removes the top level too, and a top level ' +
      'with a side effect — a registration, a polyfill, a singleton — is one the test may be ' +
      'standing on. Make the substitution, rerun the exact test, and compare the witness.',
  ];
}

function named(region: Region): string {
  const name = region.name === '' ? region.path : region.name;
  return `${name} (lines ${region.startLine}-${region.endLine})`;
}
function values(found: readonly string[], empty: string): string {
  return found.length === 0 ? empty : found.join(', ');
}
